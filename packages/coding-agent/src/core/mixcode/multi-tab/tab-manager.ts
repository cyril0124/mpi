/**
 * Runtime-aware multi-tab manager.
 *
 * Holds one `AgentSessionRuntime` per open tab so several agent sessions run
 * concurrently in one interactive instance.
 *
 * The active tab's session is rendered by `InteractiveMode`; every tab,
 * including background ones, is subscribed here so the tab bar keeps showing
 * live status and unread completions.
 */
import type { AgentSessionEvent } from "../../agent-session.ts";
import {
	type AgentSessionRuntime,
	type CreateAgentSessionRuntimeFactory,
	createAgentSessionRuntime,
} from "../../agent-session-runtime.ts";
import { SessionManager } from "../../session-manager.ts";
import { deleteSessionFile } from "../session-delete.ts";
import type { ToastNotification } from "../toast/toast.ts";
import { createVimTabState, transferVimMode, type VimTabState } from "../vim/vim-mode.ts";
import { setTabStatus } from "./tab-state.ts";
import { nextAvailableAgentTitle, TAB_COLOR_NAMES, type TabColorName, type TabStatus, uniquifyTitle } from "./types.ts";

export interface AgentTab {
	readonly id: string;
	title: string;
	color?: TabColorName;
	status: TabStatus;
	/** True when a background tab finished a turn the user has not viewed yet. */
	unread: boolean;
	/** Non-persisted: when this tab last took focus, starting its title shimmer. */
	activatedAt?: number;
	workingStartedAt?: string;
	lastWorkedDurationSeconds?: number;
	/** When the tab last left a working status; drives the Home card's relative age. */
	lastWorkedAt?: string;
	/** Editor text preserved for this tab while another tab is focused. */
	draftInput: string;
	/** Vim-mode modal state; at most one tab is active at a time. */
	vim: VimTabState;
	/** Transient toast shown over this tab's transcript; at most one at a time. */
	toast?: ToastNotification;

	readonly runtime: AgentSessionRuntime;
	unsubscribe: () => void;
}

/**
 * Why a tab must not be closed or deleted right now, or undefined when it can
 * be: its session file is still being written and its runtime would be torn
 * down mid-turn.
 */
export function tabBusyPhrase(tab: AgentTab): string | undefined {
	const session = tab.runtime.session;
	if (session.isStreaming) return "the agent is streaming";
	if (session.isCompacting) return "compaction is running";
	return undefined;
}

export function tabBusyReason(tab: AgentTab): string | undefined {
	const phrase = tabBusyPhrase(tab);
	return phrase ? `${tab.title} (${phrase})` : undefined;
}

function assertTabIdle(tab: AgentTab, action: "close" | "delete"): void {
	const session = tab.runtime.session;
	if (session.isStreaming) throw new Error(`Cannot ${action} a session while the agent is streaming`);
	if (session.isCompacting) throw new Error(`Cannot ${action} a session while compaction is running`);
}

export interface TabManagerOptions {
	initialRuntime: AgentSessionRuntime;
	initialTitle: string;
	createRuntime: CreateAgentSessionRuntimeFactory;
	agentDir: string;
	/** Called after any tab/status mutation so the UI can re-render the bar. */
	onTabsChanged: () => void;
	/** Called only when the tab set/order/title/color changes (not on status changes). */
	onLayoutChanged?: () => void;
	/** Attach host callbacks (rebind/invalidate) to each newly attached runtime. */
	configureRuntime: (runtime: AgentSessionRuntime) => void;
	/** Called when a tab the user is not looking at finishes a turn. */
	onBackgroundCompletion?: () => void;
	/** Called after a tab was removed, with its id and the index it occupied. */
	onTabClosed?: (tabId: string, removedIndex: number) => void;
}

export class TabManager {
	private readonly createRuntime: CreateAgentSessionRuntimeFactory;
	private readonly agentDir: string;
	private readonly onTabsChanged: () => void;
	private readonly onLayoutChanged: (() => void) | undefined;
	private readonly configureRuntime: (runtime: AgentSessionRuntime) => void;
	private readonly onBackgroundCompletion: (() => void) | undefined;
	private readonly onTabClosed: ((tabId: string, removedIndex: number) => void) | undefined;
	private readonly tabs: AgentTab[] = [];
	private activeId: string;
	/** Most-recently-activated tab ids (MRU-first, capped). */
	private readonly recentIds: string[] = [];

	constructor(options: TabManagerOptions) {
		this.createRuntime = options.createRuntime;
		this.agentDir = options.agentDir;
		this.onTabsChanged = options.onTabsChanged;
		this.onLayoutChanged = options.onLayoutChanged;
		this.configureRuntime = options.configureRuntime;
		this.onBackgroundCompletion = options.onBackgroundCompletion;
		this.onTabClosed = options.onTabClosed;
		const tab = this.attachTab(options.initialTitle, options.initialRuntime);
		this.activeId = tab.id;
		tab.activatedAt = Date.now();
	}

	get size(): number {
		return this.tabs.length;
	}

	list(): readonly AgentTab[] {
		return this.tabs;
	}

	get(id: string): AgentTab | undefined {
		return this.tabs.find((tab) => tab.id === id);
	}

	/**
	 * The focused tab, or undefined when the manager holds no tabs. A periodic
	 * caller takes this read: `dispose` empties the list before its runtimes have
	 * finished tearing down, so the focused tab can be gone between two ticks.
	 */
	activeTab(): AgentTab | undefined {
		return this.get(this.activeId);
	}

	getActive(): AgentTab {
		const tab = this.activeTab();
		if (!tab) throw new Error(`No active tab: ${this.activeId}`);
		return tab;
	}

	/**
	 * Focus a tab, clearing its unread badge and a `done` status. An error status
	 * survives focus so the failure stays visible until the next run.
	 */
	activate(id: string): AgentTab {
		const tab = this.get(id);
		if (!tab) throw new Error(`Unknown tab: ${id}`);
		const previous = this.get(this.activeId);
		this.setActive(tab);
		tab.unread = false;
		if (tab.status === "done") tab.status = "idle";
		// Vim mode is a per-tab modal surface and follows focus to the tab being shown.
		if (previous && previous !== tab) transferVimMode(previous.vim, tab.vim);
		this.noteRecent(id);
		this.notifyLayoutChanged();
		this.onTabsChanged();
		return tab;
	}

	/** Cycle by `delta` positions (wraps). Returns the newly active tab. */
	next(delta: number): AgentTab {
		const index = this.tabs.findIndex((tab) => tab.id === this.activeId);
		const nextIndex = (index + delta + this.tabs.length) % this.tabs.length;
		return this.activate(this.tabs[nextIndex]!.id);
	}

	/** Create a fresh session in a new tab. */
	async createTab(options: { title?: string; workdir?: string } = {}): Promise<AgentTab> {
		const active = this.getActive();
		const cwd = options.workdir ?? active.runtime.cwd;
		const sessionDir = active.runtime.session.sessionManager.getSessionDir();
		const sessionManager = SessionManager.create(cwd, sessionDir);
		const runtime = await createAgentSessionRuntime(this.createRuntime, {
			cwd,
			agentDir: this.agentDir,
			sessionManager,
			sessionStartEvent: { type: "session_start", reason: "new" },
		});
		const title = options.title?.trim()
			? uniquifyTitle(
					options.title.trim(),
					this.tabs.map((tab) => tab.title),
				)
			: nextAvailableAgentTitle(this.tabs.map((tab) => tab.title));
		const tab = this.attachTab(title, runtime);
		this.setActive(tab);
		this.notifyLayoutChanged();
		this.onTabsChanged();
		return tab;
	}

	/** Open an existing session file in a new tab (`/restore-workspace`). */
	async openSessionTab(sessionPath: string, options: { title?: string; workdir?: string } = {}): Promise<AgentTab> {
		const active = this.getActive();
		const sessionDir = active.runtime.session.sessionManager.getSessionDir();
		const sessionManager = SessionManager.open(sessionPath, sessionDir, options.workdir);
		const runtime = await createAgentSessionRuntime(this.createRuntime, {
			cwd: sessionManager.getCwd(),
			agentDir: this.agentDir,
			sessionManager,
			sessionStartEvent: { type: "session_start", reason: "resume" },
		});
		const title = options.title?.trim()
			? uniquifyTitle(
					options.title.trim(),
					this.tabs.map((tab) => tab.title),
				)
			: nextAvailableAgentTitle(this.tabs.map((tab) => tab.title));
		const tab = this.attachTab(title, runtime);
		this.setActive(tab);
		this.notifyLayoutChanged();
		this.onTabsChanged();
		return tab;
	}

	/**
	 * Close a tab and dispose its runtime. Refuses to close the last remaining
	 * tab; returns false in that case.
	 */
	async closeTab(id: string): Promise<boolean> {
		if (this.tabs.length <= 1) return false;
		const index = this.tabs.findIndex((tab) => tab.id === id);
		if (index < 0) throw new Error(`Unknown tab: ${id}`);
		assertTabIdle(this.tabs[index]!, "close");
		const [tab] = this.tabs.splice(index, 1);
		tab!.unsubscribe();
		this.forgetRecent(id);
		this.onTabClosed?.(id, index);
		const wasActive = this.activeId === id;
		if (wasActive) this.setActive(this.tabs[Math.min(index, this.tabs.length - 1)]!);
		this.notifyLayoutChanged();
		this.onTabsChanged();
		await tab!.runtime.dispose();
		return true;
	}

	/**
	 * Close a tab and permanently delete its session file. Refuses the last tab.
	 */
	async deleteTab(id: string): Promise<{ ok: boolean; removed: boolean; path?: string; error?: string }> {
		const tab = this.get(id);
		if (!tab) throw new Error(`Unknown tab: ${id}`);
		assertTabIdle(tab, "delete");
		const sessionPath = tab.runtime.session.sessionFile;
		const closed = await this.closeTab(id);
		if (!closed) return { ok: false, removed: false, error: "Cannot delete the last tab." };
		if (!sessionPath) return { ok: true, removed: false };
		const result = await deleteSessionFile(sessionPath);
		return { ok: result.ok, removed: result.removed, path: sessionPath, error: result.error };
	}

	rename(id: string, title: string): void {
		const tab = this.get(id);
		if (!tab) throw new Error(`Unknown tab: ${id}`);
		const clean = title.trim();
		if (!clean) throw new Error("Tab title cannot be empty");
		if (this.tabs.some((item) => item.id !== id && item.title === clean)) {
			throw new Error(`Tab title already in use: ${clean}`);
		}
		tab.title = clean;
		this.notifyLayoutChanged();
		this.onTabsChanged();
	}

	setDraft(id: string, text: string): void {
		const tab = this.get(id);
		if (tab) tab.draftInput = text;
	}

	/** Set or clear (`undefined`) a tab's color chip. */
	setColor(id: string, color: TabColorName | undefined): void {
		const tab = this.get(id);
		if (!tab) throw new Error(`Unknown tab: ${id}`);
		tab.color = color;
		this.notifyLayoutChanged();
		this.onTabsChanged();
	}

	/** Reorder by color: colored tabs first in palette order, then uncolored; stable. */
	groupByColor(): void {
		const rank = (tab: AgentTab) => (tab.color ? TAB_COLOR_NAMES.indexOf(tab.color) : TAB_COLOR_NAMES.length);
		this.tabs.sort((a, b) => rank(a) - rank(b));
		this.notifyLayoutChanged();
		this.onTabsChanged();
	}

	/** Flag a tab as finished: `done` status plus the unread badge. */
	markDone(id: string): void {
		const tab = this.get(id);
		if (!tab) throw new Error(`Unknown tab: ${id}`);
		if (tab.status === "running" || tab.status === "thinking") {
			throw new Error("Agent is still working; /mark-done is only allowed when idle");
		}
		tab.status = "done";
		tab.unread = true;
		this.onTabsChanged();
	}

	/** Force a tab's exact title, bypassing the duplicate check (restore normalization). */
	restoreTitle(id: string, title: string): void {
		const tab = this.get(id);
		if (!tab) return;
		const clean = title.trim();
		if (!clean || clean === tab.title) return;
		tab.title = clean;
		this.notifyLayoutChanged();
		this.onTabsChanged();
	}

	/** Set the unread completion badge (restored from persisted state). */
	setUnread(id: string, unread: boolean): void {
		const tab = this.get(id);
		if (!tab) return;
		tab.unread = unread;
		this.onTabsChanged();
	}

	/** MRU rank of an open tab (0 = most recent), or -1 when not recently used. */
	recentRank(id: string): number {
		return this.liveRecentIds().indexOf(id);
	}

	/** Dispose every tab runtime. */
	async dispose(): Promise<void> {
		const tabs = [...this.tabs];
		this.tabs.length = 0;
		for (const tab of tabs) {
			tab.unsubscribe();
			await tab.runtime.dispose();
		}
	}

	/** Point focus at `tab` and restart its title shimmer. */
	private setActive(tab: AgentTab): void {
		this.activeId = tab.id;
		tab.activatedAt = Date.now();
	}

	private noteRecent(id: string): void {
		const index = this.recentIds.indexOf(id);
		if (index >= 0) this.recentIds.splice(index, 1);
		this.recentIds.unshift(id);
		if (this.recentIds.length > 3) this.recentIds.length = 3;
	}

	private forgetRecent(id: string): void {
		const index = this.recentIds.indexOf(id);
		if (index >= 0) this.recentIds.splice(index, 1);
	}

	/** Recent ids that still name an open tab, so a closed tab cannot keep a rank. */
	private liveRecentIds(): string[] {
		return this.recentIds.filter((id) => this.tabs.some((tab) => tab.id === id));
	}

	private attachTab(title: string, runtime: AgentSessionRuntime): AgentTab {
		// A session that already carries a name (resume, `/name`, auto-rename) owns
		// the tab title; otherwise fall back to the caller-provided default.
		const sessionName = runtime.session.sessionManager.getSessionName()?.trim();
		const resolved = uniquifyTitle(
			sessionName || title,
			this.tabs.map((tab) => tab.title),
		);
		const tab: AgentTab = {
			id: crypto.randomUUID(),
			title: resolved,
			status: "idle",
			unread: false,
			draftInput: "",
			vim: createVimTabState(),
			toast: undefined,
			runtime,
			unsubscribe: () => {},
		};
		const unsubscribe = runtime.session.subscribe((event) => this.handleTabEvent(tab, event));
		tab.unsubscribe = unsubscribe;
		this.configureRuntime(runtime);
		this.tabs.push(tab);
		return tab;
	}

	/**
	 * Re-subscribe a tab after its runtime replaced its session (e.g. `/clear`,
	 * `/resume`), since the old subscription died with the old session object.
	 */
	rebind(runtime: AgentSessionRuntime): void {
		const tab = this.tabs.find((item) => item.runtime === runtime);
		if (!tab) return;
		tab.unsubscribe();
		tab.unsubscribe = runtime.session.subscribe((event) => this.handleTabEvent(tab, event));
		const sessionName = runtime.session.sessionManager.getSessionName()?.trim();
		if (sessionName) this.applySessionTitle(tab, sessionName);
	}

	/** Adopt a session name as the tab title, uniquified against the other tabs. */
	private applySessionTitle(tab: AgentTab, name: string): void {
		const others = this.tabs.filter((item) => item.id !== tab.id).map((item) => item.title);
		tab.title = uniquifyTitle(name, others);
		this.notifyLayoutChanged();
		this.onTabsChanged();
	}

	private notifyLayoutChanged(): void {
		this.onLayoutChanged?.();
	}

	private handleTabEvent(tab: AgentTab, event: AgentSessionEvent): void {
		switch (event.type) {
			case "agent_start":
				setTabStatus(tab, "running", { restart: true });
				break;
			case "turn_start":
				setTabStatus(tab, "running");
				break;
			case "message_update": {
				// Only flip when the phase actually changes; deltas arrive every token.
				const next = event.assistantMessageEvent.type === "thinking_delta" ? "thinking" : "running";
				if (tab.status === next) return;
				setTabStatus(tab, next);
				break;
			}
			case "message_end":
				if (event.message.role === "assistant" && event.message.stopReason === "error") {
					setTabStatus(tab, "error");
				}
				break;
			case "agent_settled": {
				const isActive = tab.id === this.activeId;
				// A terminal error survives settling; only a clean finish becomes done/idle.
				if (tab.status !== "error") setTabStatus(tab, isActive ? "idle" : "done");
				if (!isActive) this.onBackgroundCompletion?.();
				tab.unread = !isActive;
				break;
			}
			case "session_info_changed": {
				const name = event.name?.trim();
				if (!name) return;
				this.applySessionTitle(tab, name);
				return;
			}
			default:
				return;
		}
		this.onTabsChanged();
	}
}
