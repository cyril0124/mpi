import type { AssistantMessage } from "@earendil-works/pi-ai/compat";
import { type Component, Container, type TUI } from "@earendil-works/pi-tui";
import type { AgentSession } from "../../../../core/agent-session.ts";
import type { AgentSessionRuntime } from "../../../../core/agent-session-runtime.ts";
import type { ExtensionRunner } from "../../../../core/extensions/index.ts";
import type { AgentTab, TabManager } from "../../../../core/mixcode/multi-tab/tab-manager.ts";
import { applySessionCopiedSettings } from "../../../../core/mixcode/settings-tab-sync.ts";
import type { SessionEntry } from "../../../../core/session-manager.ts";
import type { AssistantMessageComponent } from "../../components/assistant-message.ts";
import type { ToolExecutionComponent } from "../../components/tool-execution.ts";
import { setRegisteredThemes } from "../../theme/theme.ts";
import type { ExtensionUiController } from "../extensions/extension-ui-controller.ts";
import { chronologicalTranscriptEntries } from "./transcript-entries.ts";

/** Session and subscription replacements are read through these live ports. */
export interface TabUiRuntimePort {
	current: AgentSessionRuntime;
	unsubscribe: (() => void) | undefined;
	applySettings(): void;
	subscribe(): void;
}

/** Shared transcript surfaces; rendering and queue projection remain host responsibilities. */
export interface TabUiTranscriptPort {
	readonly chat: Container;
	readonly loaded: Container;
	readonly pending: Container;
	readonly pendingTools: Map<string, ToolExecutionComponent>;
	streamingComponent: AssistantMessageComponent | undefined;
	streamingMessage: AssistantMessage | undefined;
	beforeCapture(): void;
	rebuild(): void;
	showCompactionHistory(): void;
	renderEntries(entries: SessionEntry[], options: { updateFooter: false }): void;
	resyncQueues(): void;
	updatePending(): void;
}

/** A switch drops the previous session's interrupt window and visible-run markers. */
export interface TabUiTurnPort {
	endInterruptArm(): void;
	resetRunMarkers(): void;
}

/** Extension chrome has one authoritative mounted id, owned by its existing controller. */
export interface TabUiExtensionPort {
	readonly controller: Pick<
		ExtensionUiController,
		"activeTabIdForUi" | "tabUi" | "detachTabUi" | "attachTabUi" | "focusTabInteractions"
	>;
	bind(runtime: AgentSessionRuntime, backgroundTabId: string): Promise<void>;
	setupShortcuts(runner: ExtensionRunner): void;
	showResources(): void;
}

/** Live composer and chrome actions that complete the incoming tab's frame. */
export interface TabUiViewPort {
	readonly ui: TUI;
	readonly homeActive: boolean;
	hiddenThinkingLabel: string | undefined;
	leaveHome(): void;
	showWorking(): void;
	showCompaction(reason: "manual" | "threshold" | "overflow"): void;
	clearWorking(): void;
	setDraft(text: string): void;
	updateProviderCount(): void;
	updateBorder(): void;
	updateTitle(): void;
	syncToast(): void;
	hidePreview(): void;
	showError(message: string): void;
}

/** Grouped live collaborators, with no dependency on the InteractiveMode host class. */
export interface TabUiHandoverPorts {
	readonly tabs: { readonly manager: Pick<TabManager, "get" | "list" | "markLoaded"> | undefined };
	readonly runtime: TabUiRuntimePort;
	readonly transcript: TabUiTranscriptPort;
	readonly turn: TabUiTurnPort;
	readonly extensions: TabUiExtensionPort;
	readonly view: TabUiViewPort;
}

interface CachedTranscript {
	readonly signature: string;
	readonly chat: readonly Component[];
	readonly loaded: readonly Component[];
}

/** Own transcript reuse, serialized tab transitions and session-scoped background binding. */
export class TabUiHandover {
	private readonly ports: TabUiHandoverPorts;
	private readonly transcripts = new Map<string, CachedTranscript>();
	readonly boundSessions = new WeakSet<AgentSession>();
	private readonly bindingSessions = new Map<AgentSession, Promise<void>>();
	private readonly pendingTabBinds = new Map<AgentSession, AgentTab>();
	/** Tabs whose startup resources block is still to be painted on their next focus. */
	private readonly pendingResourceBlocks = new Set<string>();
	/** Sessions already left once, so their compaction history is not reported again. */
	private readonly departedSessions = new Set<string>();
	private bindWorkerRunning = false;
	private switchQueue: Promise<void> = Promise.resolve();

	constructor(ports: TabUiHandoverPorts) {
		this.ports = ports;
	}

	/** Serialize surface changes and report failures without poisoning the next transition. */
	enqueueTabSwitch(run: () => Promise<void>): Promise<void> {
		const next = this.switchQueue.then(run, run).catch((error: unknown) => {
			this.ports.view.showError(`Tab switch failed: ${error instanceof Error ? error.message : String(error)}`);
		});
		this.switchQueue = next;
		return next;
	}

	/** Swap a tab's UI in the host's existing queue, painting before any first bind begins. */
	async switchActiveTab(tab: AgentTab): Promise<void> {
		const { runtime, transcript, turn, extensions, view } = this.ports;
		const controller = extensions.controller;
		view.leaveHome();
		const outgoingId = controller.activeTabIdForUi;
		if (outgoingId && outgoingId !== tab.id) {
			this.departedSessions.add(runtime.current.session.sessionManager.getSessionId());
			this.captureTranscript(outgoingId);
			controller.detachTabUi(outgoingId);
		}
		runtime.unsubscribe?.();
		runtime.unsubscribe = undefined;
		runtime.current = tab.runtime;
		controller.activeTabIdForUi = tab.id;
		// Plain writes avoid invalidating every thinking block on a quiet cache restore.
		view.hiddenThinkingLabel = controller.tabUi.get(tab.id)?.hiddenThinkingLabel;

		await runtime.current.session.settingsManager.reload();
		applySessionCopiedSettings(runtime.current.session);
		runtime.applySettings();
		if (!this.restoreTranscript(tab.id)) {
			transcript.rebuild();
		}
		// A tab's first view reports its compaction history; coming back to one does not.
		if (!this.departedSessions.has(tab.runtime.session.sessionManager.getSessionId())) {
			transcript.showCompactionHistory();
		}
		turn.endInterruptArm();
		turn.resetRunMarkers();
		runtime.subscribe();
		controller.attachTabUi(tab.id);
		if (this.pendingResourceBlocks.delete(tab.id)) {
			setRegisteredThemes(tab.runtime.session.resourceLoader.getThemes().themes);
			extensions.showResources();
		}

		const session = runtime.current.session;
		if (session.isCompacting && tab.compactionReason) view.showCompaction(tab.compactionReason);
		else if (session.isStreaming || session.isCompacting) view.showWorking();
		else view.clearWorking();
		view.setDraft(tab.draftInput);
		view.updateProviderCount();
		view.updateBorder();
		view.updateTitle();
		view.syncToast();
		view.hidePreview();
		controller.focusTabInteractions(tab.id);
		view.ui.requestRender();
		this.ensureSessionBound(tab);
	}

	/** Signature follows the active branch and rejects partially streamed transcripts. */
	transcriptSignature(): string {
		const session = this.ports.runtime.current.session;
		const branch = session.sessionManager.getBranch();
		const last = branch[branch.length - 1]?.id ?? "";
		return `${branch.length}:${last}:${session.isStreaming ? "s" : ""}`;
	}

	/** Park component instances without disposing their rendered rows. */
	captureTranscript(tabId: string): void {
		const { transcript } = this.ports;
		transcript.beforeCapture();
		this.transcripts.set(tabId, {
			signature: this.transcriptSignature(),
			chat: [...transcript.chat.children],
			loaded: [...transcript.loaded.children],
		});
		transcript.chat.clear();
		transcript.loaded.clear();
	}

	/** Restore a current, idle transcript and resync queues consumed while it was backgrounded. */
	restoreTranscript(tabId: string): boolean {
		const session = this.ports.runtime.current.session;
		const cached = this.transcripts.get(tabId);
		if (session.isStreaming || !cached || cached.signature !== this.transcriptSignature()) return false;
		const { transcript } = this.ports;
		transcript.chat.clear();
		for (const child of cached.chat) transcript.chat.addChild(child);
		transcript.loaded.clear();
		for (const child of cached.loaded) transcript.loaded.addChild(child);
		transcript.pending.clear();
		transcript.pendingTools.clear();
		transcript.streamingComponent = undefined;
		transcript.streamingMessage = undefined;
		transcript.resyncQueues();
		transcript.updatePending();
		return true;
	}

	/** Warm parked blocks only on Home; failed builds stay cold and always restore live identity. */
	warmTabTranscript(tab: AgentTab): void {
		const { runtime, transcript, extensions, view } = this.ports;
		if (!view.homeActive) return;
		const previousRuntime = runtime.current;
		const previousId = extensions.controller.activeTabIdForUi;
		const previousLabel = view.hiddenThinkingLabel;
		try {
			runtime.current = tab.runtime;
			extensions.controller.activeTabIdForUi = tab.id;
			view.hiddenThinkingLabel = extensions.controller.tabUi.get(tab.id)?.hiddenThinkingLabel;
			const manager = runtime.current.session.sessionManager;
			transcript.renderEntries(chronologicalTranscriptEntries(manager.buildContextEntries(), manager.getBranch()), {
				updateFooter: false,
			});
			const width = Math.max(1, view.ui.terminal.columns);
			for (const block of transcript.chat.children) block.render(width);
			this.captureTranscript(tab.id);
		} catch {
			// Warming is best effort; focus rebuilds a transcript that could not be prepared.
		} finally {
			runtime.current = previousRuntime;
			extensions.controller.activeTabIdForUi = previousId;
			view.hiddenThinkingLabel = previousLabel;
		}
	}

	/** Record a successful foreground rebind and clear its tab's loading state. */
	markSessionBound(session: AgentSession): void {
		this.boundSessions.add(session);
		this.markTabReady(session);
	}

	/** Query session identity, so a replaced session never inherits another bind's readiness. */
	isSessionBound(session: AgentSession): boolean {
		return this.boundSessions.has(session);
	}

	/** Reapply shortcuts for a ready session, or queue its first background bind. */
	ensureSessionBound(tab: AgentTab): void {
		const session = tab.runtime.session;
		if (this.boundSessions.has(session)) {
			this.ports.extensions.setupShortcuts(session.extensionRunner);
			this.markTabReady(session);
			return;
		}
		this.queueTabBind(tab);
	}

	/** Queue each session once; the serial worker skips tabs closed before their bind starts. */
	queueTabBind(tab: AgentTab): void {
		const session = tab.runtime.session;
		if (this.boundSessions.has(session) || this.bindingSessions.has(session)) return;
		if (!this.pendingTabBinds.has(session)) this.pendingTabBinds.set(session, tab);
		if (this.bindWorkerRunning) return;
		this.bindWorkerRunning = true;
		void this.runTabBindWorker();
	}

	/** Drain background requests in arrival order without parallel filesystem walks. */
	private async runTabBindWorker(): Promise<void> {
		try {
			for (;;) {
				const next = this.pendingTabBinds.entries().next();
				if (next.done) break;
				const [session, tab] = next.value;
				this.pendingTabBinds.delete(session);
				if (!this.ports.tabs.manager?.get(tab.id)) continue;
				await this.bindTabExtensions(tab);
			}
		} finally {
			this.bindWorkerRunning = false;
		}
	}

	/** Share an in-flight bind; paint the queued frame first and leave failures retryable. */
	bindTabExtensions(tab: AgentTab): Promise<void> {
		const session = tab.runtime.session;
		if (this.boundSessions.has(session)) return Promise.resolve();
		const existing = this.bindingSessions.get(session);
		if (existing) return existing;
		const bind = new Promise<void>((resolve) => {
			// TUI renders on nextTick; a timer registered there lets that frame precede the walk.
			process.nextTick(() => setTimeout(resolve, 0));
		})
			.then(() => this.ports.extensions.bind(tab.runtime, tab.id))
			.then(
				() => {
					this.bindingSessions.delete(session);
					this.boundSessions.add(session);
					this.mountBoundTabChrome(tab);
					this.markTabReady(session);
				},
				() => {
					this.bindingSessions.delete(session);
					if (this.ports.tabs.manager?.get(tab.id)) {
						tab.loading = false;
						tab.loadingPhase = undefined;
						tab.status = "error";
						this.ports.view.ui.requestRender();
					}
				},
			);
		this.bindingSessions.set(session, bind);
		return bind;
	}

	/** Clear loading for the roster entry that holds this exact session. */
	private markTabReady(session: AgentSession): void {
		const manager = this.ports.tabs.manager;
		const tab = manager?.list().find((item) => item.runtime.session === session);
		if (tab) manager?.markLoaded(tab.id);
	}

	/** Mount a finished bind on its mounted tab; defer background resources until its next switch. */
	mountBoundTabChrome(tab: AgentTab): void {
		const { runtime, extensions, view } = this.ports;
		if (extensions.controller.activeTabIdForUi !== tab.id) {
			this.pendingResourceBlocks.add(tab.id);
			return;
		}
		extensions.controller.attachTabUi(tab.id);
		setRegisteredThemes(tab.runtime.session.resourceLoader.getThemes().themes);
		extensions.setupShortcuts(tab.runtime.session.extensionRunner);
		runtime.applySettings();
		extensions.showResources();
		extensions.controller.focusTabInteractions(tab.id);
		view.ui.requestRender();
	}

	/** Drop parked transcripts after settings change; their next focus rebuilds them. */
	clearTranscripts(): void {
		this.transcripts.clear();
	}

	/** Invalidate live and parked descendants after deferred syntax grammars become available. */
	flushTranscriptRenderCaches(): void {
		const flush = (component: Component): void => {
			component.invalidate?.();
			if (component instanceof Container) {
				for (const child of component.children) flush(child);
			}
		};
		flush(this.ports.transcript.chat);
		for (const cached of this.transcripts.values()) {
			for (const block of cached.chat) flush(block);
			for (const block of cached.loaded) flush(block);
		}
	}

	/** Forget a closed tab's parked transcript and its owed resources block; a bind already in flight still runs. */
	disposeTabUi(tabId: string): void {
		this.transcripts.delete(tabId);
		this.pendingResourceBlocks.delete(tabId);
	}
}
