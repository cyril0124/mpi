/** Own the fork's tab-manager and shared-layout lifecycle for InteractiveMode. */
import type { AgentSessionRuntime, CreateAgentSessionRuntimeFactory } from "../../../../core/agent-session-runtime.ts";
import { SharedTabLayout } from "../../../../core/mixcode/multi-tab/shared-tab-layout.ts";
import { type AgentTab, TabManager } from "../../../../core/mixcode/multi-tab/tab-manager.ts";
import {
	handleCloseTab,
	handleNewTab,
	handleResumeIntoTab,
	type ResumeTabHost,
	type TabLifecycleHost,
} from "./tab-lifecycle.ts";
import {
	handleCloseAllSessions,
	handleCloseSession,
	handleDeleteAllSessions,
	handleDeleteSession,
	type SessionActionHost,
} from "./tab-session-actions.ts";

export interface TabControllerOptions {
	readonly runtimeHost: AgentSessionRuntime;
	readonly createRuntime: CreateAgentSessionRuntimeFactory | undefined;
	readonly initialTitle: string;
	readonly agentDir: string;
	readonly workdir: string;
	readonly sessionDir: string;
	readonly onTabsChanged: () => void;
	readonly onLayoutChanged: () => void;
	readonly onTabClosed: (tabId: string, removedIndex: number) => void;
	readonly onBackgroundCompletion: () => void;
	/** Called when a tab the user is not looking at ends a failed turn. */
	readonly onBackgroundRunFailed?: (tabId: string) => void;
	readonly onCompactionEnd: (tabId: string, willRetry: boolean) => void;
	readonly configureRuntime: (runtime: AgentSessionRuntime) => void;
	readonly enqueueTabSwitch: (operation: () => Promise<void>) => Promise<void>;
	readonly refreshActiveTab: () => Promise<void>;
	readonly disposeTabUi: (tabId: string) => void;
	readonly onTabOpened: (tab: AgentTab) => void;
	readonly onError: (error: unknown) => void;
}

/** Own the fork's tab manager and shared-layout lifecycle without owning tab UI state. */
export class TabController {
	readonly manager: TabManager | undefined;
	readonly sharedLayout: SharedTabLayout | undefined;
	private readonly onTabOpened: (tab: AgentTab) => void;

	constructor(options: TabControllerOptions) {
		this.manager = undefined;
		this.sharedLayout = undefined;
		this.onTabOpened = options.onTabOpened;
		if (!options.createRuntime) return;

		this.manager = new TabManager({
			initialRuntime: options.runtimeHost,
			initialTitle: options.initialTitle,
			createRuntime: options.createRuntime,
			agentDir: options.agentDir,
			onTabsChanged: options.onTabsChanged,
			onLayoutChanged: options.onLayoutChanged,
			onTabClosed: options.onTabClosed,
			onBackgroundCompletion: options.onBackgroundCompletion,
			onBackgroundRunFailed: options.onBackgroundRunFailed,
			onCompactionEnd: options.onCompactionEnd,
			configureRuntime: options.configureRuntime,
		});
		this.sharedLayout = new SharedTabLayout({
			manager: this.manager,
			workdir: options.workdir,
			sessionDir: options.sessionDir,
			enqueue: options.enqueueTabSwitch,
			refreshActiveTab: options.refreshActiveTab,
			disposeTabUi: options.disposeTabUi,
			onTabOpened: options.onTabOpened,
			onError: options.onError,
		});
	}

	/** Start shared layout publication after startup restore has settled. */
	start(): void {
		this.sharedLayout?.start();
	}

	/** Publish local tab metadata when startup restore permits it. */
	publish(): void {
		this.sharedLayout?.publish();
	}

	/** Stop peer synchronization and dispose all runtimes. */
	async dispose(fallbackRuntime: AgentSessionRuntime): Promise<void> {
		this.sharedLayout?.dispose();
		if (this.manager) await this.manager.dispose();
		else await fallbackRuntime.dispose();
	}

	/** Run a tab lifecycle command against this controller's owned tab set. */
	async createTab(host: TabLifecycleHost, title?: string, focus = true): Promise<void> {
		const tab = await handleNewTab(host, title, focus);
		// Locally created tabs queue the same background bind a peer-opened tab gets. A tab created
		// without focus is never switched to, so nothing else would load its extensions.
		if (tab) this.onTabOpened(tab);
	}

	/** Close the active tab through the shared tab-switch queue. */
	async closeTab(host: TabLifecycleHost): Promise<void> {
		await handleCloseTab(host);
	}

	/** Open a saved session in its own tab when multi-tab mode is active. */
	async resumeTab(host: ResumeTabHost, sessionPath: string): Promise<void> {
		await handleResumeIntoTab(host, sessionPath);
	}

	/** Run the active-tab session action. */
	async closeSession(host: SessionActionHost, args: string): Promise<void> {
		await handleCloseSession(host, args);
	}

	/** Run the active-tab delete action. */
	async deleteSession(host: SessionActionHost, args: string): Promise<void> {
		await handleDeleteSession(host, args);
	}

	/** Close every tab except the active tab. */
	async closeAllSessions(host: SessionActionHost): Promise<void> {
		await handleCloseAllSessions(host);
	}

	/** Delete every tab's session file and keep one fresh tab. */
	async deleteAllSessions(host: SessionActionHost): Promise<void> {
		await handleDeleteAllSessions(host);
	}
}
