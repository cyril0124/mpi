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
import { existsSync } from "node:fs";
import { unlink } from "node:fs/promises";
import type { AgentSessionEvent } from "../../agent-session.ts";
import {
	type AgentSessionRuntime,
	type CreateAgentSessionRuntimeFactory,
	createAgentSessionRuntime,
} from "../../agent-session-runtime.ts";
import { SessionManager } from "../../session-manager.ts";
import { type ContextLimitOverride, reconcileContextLimit } from "../context-limit.ts";
import { deleteSessionFile } from "../session-delete.ts";
import type { ToastNotification } from "../toast/toast.ts";
import { createVimTabState, transferVimMode, type VimTabState } from "../vim/vim-mode.ts";
import { setTabStatus } from "./tab-state.ts";
import {
	isWorkingStatus,
	nextAvailableAgentTitle,
	TAB_COLOR_NAMES,
	type TabColorName,
	type TabLoadingPhase,
	type TabStatus,
	uniquifyTitle,
} from "./types.ts";

/**
 * How many recently focused tabs the manager remembers. Past this depth the bar
 * paints every tab the same, so a longer list would only cost lookups.
 */
const RECENT_TAB_MEMORY = 3;

export interface AgentTab {
	readonly id: string;
	title: string;
	/** True while `title` is a generated `Agent-NN`; cleared once a caller picks a name. */
	autoTitle?: boolean;
	/** True when a batch request owns the title across session replacement events. */
	titleLocked?: boolean;
	color?: TabColorName;
	status: TabStatus;
	/** True when a background tab finished a turn the user has not viewed yet. */
	unread: boolean;
	/**
	 * True from the moment the tab exists until its runtime is bound and it can run a
	 * turn. The chip shows a spinner while it holds, and `status` is left untouched.
	 */
	loading: boolean;
	/** What the tab is still doing while `loading` holds; drives the Home chip label. */
	loadingPhase?: TabLoadingPhase;
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
	/**
	 * Zen focus mode: the tab bar hides and only its separator stays, and it
	 * follows focus like vim. Feature note: at most one tab owns it and it is
	 * never persisted, so it never reaches the tab layout on disk.
	 */
	zenMode: boolean;
	/** Transient toast shown over this tab's transcript; at most one at a time. */
	toast?: ToastNotification;
	/** Live `/context-limit` override, or undefined when the model's own window applies. */
	contextLimit?: ContextLimitOverride;

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

/** `<title> (<why>)` for a notice that names the tab, or undefined when the tab is idle. */
export function tabBusyReason(tab: AgentTab): string | undefined {
	const phrase = tabBusyPhrase(tab);
	return phrase ? `${tab.title} (${phrase})` : undefined;
}

/** Refuse a close or delete while the tab is busy: its runtime would be torn down mid-turn. */
function assertTabIdle(tab: AgentTab, action: "close" | "delete"): void {
	const phrase = tabBusyPhrase(tab);
	if (phrase) throw new Error(`Cannot ${action} a session while ${phrase}`);
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
	 * survives focus so the failure stays visible until the next run. Focus is not a
	 * layout change, so the persisted layout is left to the callers that alter it;
	 * clearing a badge is the exception, because `unread` is persisted state that a
	 * peer poll would otherwise restore from disk.
	 */
	activate(id: string): AgentTab {
		const tab = this.get(id);
		if (!tab) throw new Error(`Unknown tab: ${id}`);
		const previous = this.get(this.activeId);
		this.setActive(tab);
		const wasUnread = tab.unread;
		tab.unread = false;
		if (tab.status === "done") tab.status = "idle";
		// Vim mode is a per-tab modal surface and follows focus to the tab being shown.
		if (previous && previous !== tab) transferVimMode(previous.vim, tab.vim);
		if (previous) this.transferZenMode(previous, tab);
		this.noteRecent(id);
		if (wasUnread) this.notifyLayoutChanged();
		this.onTabsChanged();
		return tab;
	}

	/** Cycle by `delta` positions (wraps). Returns the newly active tab. */
	next(delta: number): AgentTab {
		const index = this.tabs.findIndex((tab) => tab.id === this.activeId);
		const nextIndex = (index + delta + this.tabs.length) % this.tabs.length;
		return this.activate(this.tabs[nextIndex]!.id);
	}

	/** Fork before a user message into an independent tab without replacing the source. */
	async forkTab(
		sourceId: string,
		entryId: string,
	): Promise<{ cancelled: boolean; tab?: AgentTab; selectedText?: string }> {
		const sourceTab = this.get(sourceId);
		if (!sourceTab) throw new Error(`Unknown tab: ${sourceId}`);
		const sourceSession = sourceTab.runtime.session;
		const runner = sourceSession.extensionRunner;
		if (runner.hasHandlers("session_before_fork")) {
			const result = await runner.emit({ type: "session_before_fork", entryId, position: "before" });
			if (result?.cancel) return { cancelled: true };
		}

		const sourceManager = sourceSession.sessionManager;
		const selectedEntry = sourceManager.getEntry(entryId);
		if (!selectedEntry || selectedEntry.type !== "message" || selectedEntry.message.role !== "user") {
			throw new Error("Invalid entry ID for forking");
		}

		const selectedText =
			sourceSession.getUserMessagesForForking().find((message) => message.entryId === entryId)?.text ?? "";
		const sourceFile = sourceManager.getSessionFile();
		const cwd = sourceManager.getCwd();
		const priorEntries = selectedEntry.parentId ? sourceManager.getBranch(selectedEntry.parentId) : [];
		const hasPriorConversation = priorEntries.some((entry) => {
			if (entry.type === "custom_message") return entry.display;
			return entry.type === "message" && entry.message.role !== "system";
		});

		let sessionManager: SessionManager;
		if (!hasPriorConversation) {
			sessionManager = sourceManager.isPersisted()
				? SessionManager.create(cwd, sourceManager.getSessionDir(), { parentSession: sourceFile })
				: SessionManager.inMemory(cwd);
		} else {
			if (sourceManager.isPersisted()) {
				if (!sourceFile || !existsSync(sourceFile)) {
					throw new Error(
						"This session has not been saved yet. Wait for the first assistant response before forking it.",
					);
				}
				sessionManager = SessionManager.open(sourceFile, sourceManager.getSessionDir());
			} else {
				const header = sourceManager.getHeader();
				if (!header) throw new Error("Session is missing its header");
				sessionManager = SessionManager.inMemory(cwd, undefined, [header, ...sourceManager.getEntries()]);
			}
			if (!selectedEntry.parentId) throw new Error("Invalid fork target");
			// Forks without assistant messages may not have a file yet; use the populated manager.
			sessionManager.createBranchedSession(selectedEntry.parentId);
		}

		const forkSessionFile = sessionManager.getSessionFile();
		let runtime: AgentSessionRuntime;
		try {
			runtime = await createAgentSessionRuntime(this.createRuntime, {
				cwd,
				agentDir: this.agentDir,
				sessionManager,
				sessionStartEvent: { type: "session_start", reason: "fork", previousSessionFile: sourceFile },
			});
		} catch (error) {
			if (forkSessionFile) {
				try {
					await unlink(forkSessionFile);
				} catch (cleanupError) {
					if ((cleanupError as NodeJS.ErrnoException).code !== "ENOENT") {
						throw new AggregateError([error, cleanupError], "Fork startup and session cleanup failed");
					}
				}
			}
			throw error;
		}

		const title = this.resolveTabTitle(`${sourceTab.title}-fork`);
		runtime.session.setSessionName(title);
		const tab = this.addRuntime(runtime, title, sourceTab.id);
		tab.draftInput = selectedText;
		return { cancelled: false, tab, selectedText };
	}

	/**
	 * Create a fresh session in a new tab.
	 *
	 * `id` names the tab up front, which a restore needs: the tab bar lists every
	 * persisted tab before its runtime exists, and the chip has to be the same one
	 * once it does. `sessionId` names the new session itself; a restore of a
	 * recorded tab whose session file is gone passes the recorded id, so the tab's
	 * session id matches the persisted membership instead of appending a second id
	 * that the next start would restore as an extra tab.
	 */
	async createTab(
		options: { title?: string; workdir?: string; id?: string; sessionId?: string } = {},
	): Promise<AgentTab> {
		const active = this.getActive();
		const cwd = options.workdir ?? active.runtime.cwd;
		const sessionDir = active.runtime.session.sessionManager.getSessionDir();
		const sessionManager = SessionManager.create(cwd, sessionDir, { id: options.sessionId });
		const runtime = await createAgentSessionRuntime(this.createRuntime, {
			cwd,
			agentDir: this.agentDir,
			sessionManager,
			sessionStartEvent: { type: "session_start", reason: "new" },
		});
		const title = this.resolveTabTitle(options.title);
		const tab = this.attachTab(title, runtime, options.id);
		const previous = this.getActive();
		this.setActive(tab);
		this.transferZenMode(previous, tab);
		this.notifyLayoutChanged();
		this.onTabsChanged();
		return tab;
	}

	/** Open an existing session file in a new tab (`/restore-workspace`). `id` as in `createTab`. */
	async openSessionTab(
		sessionPath: string,
		options: { title?: string; workdir?: string; id?: string } = {},
	): Promise<AgentTab> {
		const active = this.getActive();
		const sessionDir = active.runtime.session.sessionManager.getSessionDir();
		const sessionManager = SessionManager.open(sessionPath, sessionDir, options.workdir);
		const runtime = await createAgentSessionRuntime(this.createRuntime, {
			cwd: sessionManager.getCwd(),
			agentDir: this.agentDir,
			sessionManager,
			sessionStartEvent: { type: "session_start", reason: "resume" },
		});
		const title = this.resolveTabTitle(options.title);
		const tab = this.attachTab(title, runtime, options.id);
		const previous = this.getActive();
		this.setActive(tab);
		this.transferZenMode(previous, tab);
		this.notifyLayoutChanged();
		this.onTabsChanged();
		return tab;
	}

	/** Attach a new runtime, optionally placing it after an existing tab. */
	private addRuntime(runtime: AgentSessionRuntime, title: string | undefined, afterTabId?: string): AgentTab {
		const previous = this.getActive();
		const resolved = this.resolveTabTitle(title);
		const tab = this.attachTab(resolved, runtime);
		if (afterTabId) {
			const sourceIndex = this.tabs.findIndex((item) => item.id === afterTabId);
			const attachedIndex = this.tabs.indexOf(tab);
			if (sourceIndex >= 0 && attachedIndex !== sourceIndex + 1) {
				this.tabs.splice(attachedIndex, 1);
				this.tabs.splice(sourceIndex + 1, 0, tab);
			}
		}
		this.setActive(tab);
		this.transferZenMode(previous, tab);
		this.notifyLayoutChanged();
		this.onTabsChanged();
		return tab;
	}

	/**
	 * Title for a new tab: the caller's title made unique, or the next free
	 * `Agent-NN` when the caller has none.
	 */
	private resolveTabTitle(title: string | undefined): string {
		const used = this.tabs.map((tab) => tab.title);
		const wanted = title?.trim();
		return wanted ? uniquifyTitle(wanted, used) : nextAvailableAgentTitle(used);
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
		const result = await deleteSessionFile(sessionPath, { title: tab.title });
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
		tab.autoTitle = false;
		this.notifyLayoutChanged();
		this.onTabsChanged();
	}

	/** Mark a title as owned by a batch request across session replacement events. */
	lockTitle(id: string, title: string): void {
		this.rename(id, title);
		const tab = this.get(id);
		if (tab) tab.titleLocked = true;
	}
	/**
	 * Stash a tab's editor text. An unknown id is ignored: a draft save can race
	 * a tab closing, and losing the draft of a gone tab is harmless.
	 */
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

	/** Apply a shared tab order, leaving tabs the order does not name at the end. */
	reorder(orderedIds: readonly string[]): void {
		const ordered = orderedIds.flatMap((id) => {
			const tab = this.get(id);
			return tab ? [tab] : [];
		});
		const unique = [...new Set(ordered)];
		const next = [...unique, ...this.tabs.filter((tab) => !unique.includes(tab))];
		if (next.every((tab, index) => tab === this.tabs[index])) return;
		this.tabs.splice(0, this.tabs.length, ...next);
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

	/** Flip a tab's zen focus mode and repaint. Returns the new value. */
	toggleZenMode(id: string): boolean {
		const tab = this.get(id);
		if (!tab) throw new Error(`Unknown tab: ${id}`);
		const enabled = !tab.zenMode;
		// At most one tab holds zen, whatever tab the caller names.
		for (const other of this.tabs) other.zenMode = false;
		tab.zenMode = enabled;
		this.onTabsChanged();
		return tab.zenMode;
	}

	/** Flag a tab as finished: `done` status plus the unread badge. */
	markDone(id: string): void {
		const tab = this.get(id);
		if (!tab) throw new Error(`Unknown tab: ${id}`);
		if (tab.loading) {
			throw new Error("Tab is still loading; /mark-done is only allowed once it is ready");
		}
		if (isWorkingStatus(tab.status)) {
			throw new Error("Agent is still working; /mark-done is only allowed when idle");
		}
		setTabStatus(tab, "done");
		tab.unread = true;
		this.notifyLayoutChanged();
		this.onTabsChanged();
	}

	/**
	 * Force a tab's exact title, bypassing the duplicate check (restore
	 * normalization). Passing `autoTitle` re-marks the title as generated rather
	 * than chosen. An unknown id is ignored: the restore pass also names tabs
	 * that have since closed.
	 */
	restoreTitle(id: string, title: string, options: { autoTitle?: boolean; titleLocked?: boolean } = {}): void {
		const tab = this.get(id);
		if (!tab) return;
		const clean = title.trim();
		if (!clean) return;
		tab.autoTitle = options.autoTitle ?? false;
		tab.titleLocked = options.titleLocked ?? false;
		if (clean === tab.title) return;
		tab.title = clean;
		this.notifyLayoutChanged();
		this.onTabsChanged();
	}

	/**
	 * Set the unread completion badge (restored from persisted state). An unknown
	 * id is ignored: badges restore from state written before some tabs closed.
	 */
	setUnread(id: string, unread: boolean): void {
		const tab = this.get(id);
		if (!tab) return;
		tab.unread = unread;
		this.onTabsChanged();
	}

	/**
	 * Clear a tab's loading state once its runtime is bound, so its chip shows the
	 * real status again. Returns whether it changed.
	 */
	markLoaded(id: string): boolean {
		const tab = this.get(id);
		if (!tab?.loading) return false;
		tab.loading = false;
		tab.loadingPhase = undefined;
		this.onTabsChanged();
		return true;
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

	/**
	 * Move zen from the tab being left to the tab now in front. `activate`,
	 * `createTab` and `openSessionTab` call it; `closeTab` deliberately does not,
	 * so closing the holder ends zen instead of handing it to the successor.
	 */
	private transferZenMode(previous: AgentTab, next: AgentTab): void {
		if (previous === next || !previous.zenMode) return;
		previous.zenMode = false;
		next.zenMode = true;
	}

	private noteRecent(id: string): void {
		const index = this.recentIds.indexOf(id);
		if (index >= 0) this.recentIds.splice(index, 1);
		this.recentIds.unshift(id);
		if (this.recentIds.length > RECENT_TAB_MEMORY) this.recentIds.length = RECENT_TAB_MEMORY;
	}

	private forgetRecent(id: string): void {
		const index = this.recentIds.indexOf(id);
		if (index >= 0) this.recentIds.splice(index, 1);
	}

	/** Recent ids that still name an open tab, so a closed tab cannot keep a rank. */
	private liveRecentIds(): string[] {
		return this.recentIds.filter((id) => this.tabs.some((tab) => tab.id === id));
	}

	private attachTab(title: string, runtime: AgentSessionRuntime, id?: string): AgentTab {
		// A session that already carries a name (resume, `/name`, auto-rename) owns
		// the tab title; otherwise fall back to the caller-provided default.
		const sessionName = runtime.session.sessionManager.getSessionName()?.trim();
		const resolved = uniquifyTitle(
			sessionName || title,
			this.tabs.map((tab) => tab.title),
		);
		const tab: AgentTab = {
			id: id ?? crypto.randomUUID(),
			title: resolved,
			autoTitle: !sessionName,
			status: "idle",
			unread: false,
			loading: true,
			draftInput: "",
			vim: createVimTabState(),
			zenMode: false,
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
	 * The replacement also drops a `/context-limit` override: it belonged to the
	 * outgoing session's model and settings manager, both now discarded. A custom
	 * title is dropped too: it named the conversation that just went away.
	 */
	rebind(runtime: AgentSessionRuntime): void {
		const tab = this.tabs.find((item) => item.runtime === runtime);
		if (!tab) return;
		tab.contextLimit = undefined;
		tab.unsubscribe();
		tab.unsubscribe = runtime.session.subscribe((event) => this.handleTabEvent(tab, event));
		const sessionName = runtime.session.sessionManager.getSessionName()?.trim();
		if (sessionName && !tab.titleLocked) this.applySessionTitle(tab, sessionName);
		else if (!tab.titleLocked) this.resetToGeneratedTitle(tab);
	}

	/** Adopt a session name as the tab title, uniquified against the other tabs. */
	private applySessionTitle(tab: AgentTab, name: string): void {
		const others = this.tabs.filter((item) => item.id !== tab.id).map((item) => item.title);
		tab.title = uniquifyTitle(name, others);
		tab.autoTitle = false;
		this.notifyLayoutChanged();
		this.onTabsChanged();
	}

	/**
	 * Give a tab back its generated title when the replacement session carries no
	 * name (`/new`, `/resume` onto a session nobody named). `/rename` keeps the
	 * title and the session name in step, so a kept title would claim a name the
	 * session no longer has. An existing `Agent-NN` stays put.
	 */
	private resetToGeneratedTitle(tab: AgentTab): void {
		if (tab.autoTitle) return;
		const others = this.tabs.filter((item) => item.id !== tab.id).map((item) => item.title);
		tab.title = nextAvailableAgentTitle(others);
		tab.autoTitle = true;
		this.notifyLayoutChanged();
		this.onTabsChanged();
	}

	private notifyLayoutChanged(): void {
		this.onLayoutChanged?.();
	}

	private handleTabEvent(tab: AgentTab, event: AgentSessionEvent): void {
		switch (event.type) {
			case "agent_start":
				// A settings write or a model swap can invalidate the override between
				// commands; the budgets matter again for the turn that starts here.
				reconcileContextLimit(tab, tab.runtime.session);
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
				if (tab.titleLocked || !tab.autoTitle) return;
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
