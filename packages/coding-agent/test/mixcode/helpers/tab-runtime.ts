import {
	type CreateAgentSessionRuntimeFactory,
	createAgentSessionFromServices,
	createAgentSessionRuntime,
} from "../../../src/core/agent-session-runtime.ts";
import { SharedTabLayout } from "../../../src/core/mixcode/multi-tab/shared-tab-layout.ts";
import { type AgentTab, TabManager } from "../../../src/core/mixcode/multi-tab/tab-manager.ts";
import { SessionManager } from "../../../src/core/session-manager.ts";
import type { Harness } from "../../suite/harness.ts";

/** A real session/runtime/tab manager with only terminal painting replaced by observable callbacks. */
export async function createTabClient(options: {
	harness: Harness;
	workdir: string;
	sessionDir: string;
	agentDir: string;
	sessionPath?: string;
	start?: boolean;
}) {
	const { harness, workdir, sessionDir, agentDir } = options;
	const factory: CreateAgentSessionRuntimeFactory = async ({ cwd, sessionManager, sessionStartEvent }) => {
		const services = {
			cwd,
			agentDir,
			modelRuntime: harness.session.modelRuntime,
			settingsManager: harness.settingsManager,
			resourceLoader: harness.session.resourceLoader,
			diagnostics: [],
		};
		return {
			...(await createAgentSessionFromServices({
				services,
				sessionManager,
				sessionStartEvent,
				model: harness.getModel(),
				noTools: "all",
			})),
			services,
			diagnostics: [],
		};
	};
	const initialRuntime = await createAgentSessionRuntime(factory, {
		cwd: workdir,
		agentDir,
		sessionManager: options.sessionPath
			? SessionManager.open(options.sessionPath, sessionDir)
			: SessionManager.create(workdir, sessionDir),
	});
	let shared: SharedTabLayout | undefined;
	let manager: TabManager;
	manager = new TabManager({
		initialRuntime,
		initialTitle: "Agent-01",
		createRuntime: factory,
		agentDir,
		onTabsChanged: () => {},
		onLayoutChanged: () => shared?.publish(),
		configureRuntime: (runtime) =>
			runtime.setRebindSession(async () => {
				manager.rebind(runtime);
				shared?.publish();
			}),
	});
	const errors: unknown[] = [];
	const closedUi: string[] = [];
	const status: string[] = [];
	let displayedTabId = manager.getActive().id;
	let queue = Promise.resolve();
	const enqueue = (operation: () => Promise<void>): Promise<void> => {
		const next = queue.then(operation);
		queue = next.catch(() => {});
		return next;
	};
	const switchActiveTab = async (tab: AgentTab): Promise<void> => {
		displayedTabId = tab.id;
	};
	const disposeTabUi = (id: string): void => {
		closedUi.push(id);
	};
	shared = new SharedTabLayout({
		manager,
		workdir,
		sessionDir,
		enqueue,
		refreshActiveTab: async () => switchActiveTab(manager.getActive()),
		disposeTabUi,
		onError: (error) => {
			errors.push(error);
		},
	});
	if (options.start !== false) shared.start();
	return {
		manager,
		shared,
		errors,
		closedUi,
		status,
		enqueue,
		switchActiveTab,
		disposeTabUi,
		get displayedTabId() {
			return displayedTabId;
		},
		host: {
			tabManager: manager,
			sharedTabLayout: shared,
			tabsWorkdir: workdir,
			get session() {
				return manager.getActive().runtime.session;
			},
			enqueueTabSwitch: enqueue,
			switchActiveTab,
			disposeTabUi,
			queueRestoredTabBinds: () => {},
			showError: (message: string) => {
				errors.push(message);
			},
			showWarning: (message: string) => {
				errors.push(message);
			},
			showStatus: (message: string) => {
				status.push(message);
			},
			showExtensionConfirm: async () => true,
			editorText: () => "draft",
			subscribeToAgent: () => {},
			unsubscribeFromAgent: () => {},
		},
	};
}
