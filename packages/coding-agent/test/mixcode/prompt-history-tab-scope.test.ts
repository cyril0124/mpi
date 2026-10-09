import { Container, Editor, getKeybindings, setKeybindings, TuiMainScreen } from "@earendil-works/pi-tui";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { VirtualTerminal } from "../../../tui/test/virtual-terminal.ts";
import type { AgentSessionRuntime, CreateAgentSessionRuntimeResult } from "../../src/core/agent-session-runtime.ts";
import type { EditorFactory } from "../../src/core/extensions/index.ts";
import { KeybindingsManager } from "../../src/core/keybindings.ts";
import { createHomeSelection, type HomeSelectionState } from "../../src/core/mixcode/home/home-state.ts";
import { type AgentTab, TabManager } from "../../src/core/mixcode/multi-tab/tab-manager.ts";
import { CustomEditor } from "../../src/modes/interactive/components/custom-editor.ts";
import { MixcodePromptEditor } from "../../src/modes/interactive/components/mixcode/input-dock/prompt-editor.ts";
import { InteractiveMode } from "../../src/modes/interactive/interactive-mode.ts";
import type { TabExtensionUi } from "../../src/modes/interactive/mixcode/extensions/extension-ui-controller.ts";
import { getEditorTheme, initTheme } from "../../src/modes/interactive/theme/theme.ts";
import { createHarness, type Harness } from "../suite/harness.ts";

interface HistoryHost {
	ui: TuiMainScreen;
	editor: Editor;
	defaultEditor: MixcodePromptEditor;
	editorContainer: Container;
	tabManager: TabManager;
	runtimeHost: AgentSessionRuntime;
	activeTabIdForUi: string | undefined;
	tabUi: Map<string, TabExtensionUi>;
	promptHistory: Map<string, string[]>;
	homeSelection: HomeSelectionState;
	compactionQueues: Map<string, Array<{ text: string; mode: "steer" | "followUp" }>>;
	setupEditorSubmitHandler(): void;
	submitHomeCommand(text: string): Promise<void>;
	isExtensionCommandFor(session: Harness["session"], text: string): boolean;
	syncEditorHistory(): void;
	switchActiveTab(tab: AgentTab): Promise<void>;
	activateTab(tab: AgentTab): Promise<void>;
	mountBoundTabChrome(tab: AgentTab): void;
	createTabScopedExtensionUIContext(tabId: string): { setEditorComponent(factory: EditorFactory): void };
	ensureSessionBoundForSubmit(): Promise<void>;
	showError(message: string): void;
	handleNameCommand(text: string): void;
	handleBashCommand(command: string, excluded: boolean): Promise<void>;
}

interface HistoryFixture {
	host: HistoryHost;
	terminal: VirtualTerminal;
	tabA: AgentTab;
	tabB: AgentTab;
	sessionA: Harness["session"];
	sessionB: Harness["session"];
	inputs: Array<{ owner: string; text: string }>;
	focus(tab: AgentTab): Promise<void>;
	submit(text: string): Promise<void>;
}

const harnesses: Harness[] = [];
const screens: TuiMainScreen[] = [];
let previousKeybindings: ReturnType<typeof getKeybindings>;

beforeAll(() => initTheme("dark"));
beforeEach(() => {
	previousKeybindings = getKeybindings();
	setKeybindings(new KeybindingsManager());
});
afterEach(() => {
	for (const ui of screens.splice(0)) ui.stop();
	for (const harness of harnesses.splice(0)) harness.cleanup();
	vi.restoreAllMocks();
	setKeybindings(previousKeybindings);
});

/** An explicit gate makes the bind and rejection races independent of wall-clock timing. */
function deferred(): { promise: Promise<void>; resolve(): void; reject(error: Error): void } {
	let resolve!: () => void;
	let reject!: (error: Error) => void;
	const promise = new Promise<void>((done, fail) => {
		resolve = done;
		reject = fail;
	});
	return { promise, resolve, reject };
}

/** Drain the submit handler's detached prompt completion without timing-dependent polling. */
async function settleSubmission(): Promise<void> {
	await new Promise<void>((resolve) => setImmediate(resolve));
}

/** Resolve inputs locally so handled prompts leave no session entry that could seed history. */
async function createFixture(): Promise<HistoryFixture> {
	const inputs: HistoryFixture["inputs"] = [];
	const makeSession = async (owner: string): Promise<Harness> => {
		const harness = await createHarness({
			extensionFactories: [
				(pi) => {
					pi.on("input", (event) => {
						inputs.push({ owner, text: event.text });
						return { action: "handled" };
					});
				},
			],
		});
		harnesses.push(harness);
		for (const text of [`${owner} session older`, `${owner} session latest`]) {
			harness.sessionManager.appendMessage({ role: "user", content: text, timestamp: Date.now() });
		}
		return harness;
	};
	const a = await makeSession("A");
	const b = await makeSession("B");
	const runtimeA = { cwd: a.tempDir, session: a.session, dispose: async () => {} } as unknown as AgentSessionRuntime;
	const manager = new TabManager({
		initialRuntime: runtimeA,
		initialTitle: "Agent-01",
		createRuntime: async () =>
			({
				session: b.session,
				services: { cwd: b.tempDir },
				diagnostics: [],
			}) as unknown as CreateAgentSessionRuntimeResult,
		agentDir: a.tempDir,
		onTabsChanged: () => {},
		configureRuntime: () => {},
	});
	const tabA = manager.getActive();
	const tabB = await manager.createTab({ title: "Agent-02" });
	manager.activate(tabA.id);
	manager.markLoaded(tabA.id);
	manager.markLoaded(tabB.id);

	const terminal = new VirtualTerminal(90, 26);
	const ui = new TuiMainScreen(terminal);
	const defaultEditor = new MixcodePromptEditor(ui, getEditorTheme(), new KeybindingsManager());
	const editorContainer = new Container();
	editorContainer.addChild(defaultEditor);
	const statuses = new Map<string, string>();
	const host = Object.create(InteractiveMode.prototype) as HistoryHost;
	Object.assign(host, {
		ui,
		editor: defaultEditor,
		defaultEditor,
		editorContainer,
		keybindings: new KeybindingsManager(),
		runtimeHost: runtimeA,
		tabManager: manager,
		promptHistory: new Map([
			[tabA.id, ["A stashed latest"]],
			[tabB.id, ["B stashed latest"]],
		]),
		homeSelection: createHomeSelection(),
		homeCommandDepth: 0,
		restoringTabs: [],
		followUpStates: new Map(),
		compactionQueues: new Map(),
		compactionClaimed: false,
		pendingUserInputs: [],
		footer: { render: () => [], invalidate: () => {} },
		footerContainer: new Container(),
		headerContainer: new Container(),
		builtInHeader: undefined,
		footerDataProvider: {
			getExtensionStatuses: () => statuses,
			clearExtensionStatuses: () => statuses.clear(),
			setExtensionStatus: (key: string, text: string) => statuses.set(key, text),
		},
		// Transcript rendering and chrome are independent of the editor and submit paths,
		// so the tab handover parks and rebuilds into empty surfaces.
		chatContainer: new Container(),
		loadedResourcesContainer: new Container(),
		pendingMessagesContainer: new Container(),
		pendingTools: new Map(),
		renderSessionEntries: () => {},
		renderCurrentSessionState: () => {},
		resyncQueuedMessageMirrors: () => {},
		applyRuntimeSettings: () => {},
		subscribeToAgent: () => {},
		ensureSessionBound: () => {},
		setupExtensionShortcuts: () => {},
		showLoadedResources: () => {},
		setupAutocompleteProvider: () => {},
		disposeActiveSelector: () => {},
		requestWidgetRender: () => ui.requestRender(),
		endInterruptArm: () => {},
		clearStatusIndicator: () => {},
		showWorkingStatusIndicator: () => {},
		updateAvailableProviderCount: () => {},
		updateEditorBorderColor: () => {},
		updateTerminalTitle: () => {},
		syncToast: () => {},
		hideUserMessagePreview: () => {},
		updatePendingMessagesDisplay: () => {},
		flushPendingBashComponents: () => {},
		showError: vi.fn(),
		showStatus: () => {},
		showWarning: () => {},
		ensureSessionBoundForSubmit: async () => {},
		leaveHome: () => {
			if (!host.homeSelection.active) return;
			host.homeSelection.active = false;
			host.editor.setText("");
		},
	});
	host.activeTabIdForUi = tabA.id;
	host.setupEditorSubmitHandler();
	host.syncEditorHistory();
	ui.addChild(editorContainer);
	ui.setFocus(defaultEditor);
	ui.start();
	screens.push(ui);
	await terminal.waitForRender();

	return {
		host,
		terminal,
		tabA,
		tabB,
		sessionA: a.session,
		sessionB: b.session,
		inputs,
		focus: (tab) => host.activateTab(tab),
		submit: async (text) => {
			// Capture the promise but keep the real Editor's Enter path, including its clear-before-submit.
			const handler = host.editor.onSubmit!;
			let completion = Promise.resolve();
			host.editor.onSubmit = (value) => {
				completion = Promise.resolve(handler(value));
			};
			host.editor.setText(text);
			terminal.sendInput("\r");
			host.editor.onSubmit = handler;
			await completion;
		},
	};
}

/** Browse with real Up/Down keys, checking the oldest boundary and restoration of a multiline draft. */
function expectHistory(fixture: HistoryFixture, newestFirst: string[], draft: string): void {
	const { host, terminal } = fixture;
	expect.soft(host.editor.getText(), "draft before browsing").toBe(draft);
	host.editor.render(90);
	terminal.sendInput("\x01");
	for (let line = 1; line < host.editor.getText().split("\n").length; line++) terminal.sendInput("\x1b[A");
	for (const text of newestFirst) {
		terminal.sendInput("\x1b[A");
		expect.soft(host.editor.getText(), "Up must recall only the mounted tab's history").toBe(text);
	}
	terminal.sendInput("\x1b[A");
	expect.soft(host.editor.getText(), "Up at oldest entry must not reveal another tab").toBe(newestFirst.at(-1));
	for (let index = 0; index < newestFirst.length; index++) terminal.sendInput("\x1b[B");
	expect.soft(host.editor.getText(), "Down must restore this tab's multiline draft").toBe(draft);
	// Each cycle starts with its own draft, even after a failed soft assertion.
	host.editor.setText(draft);
}

const editorFactories: Array<{ name: string; factory: EditorFactory }> = [
	{ name: "Editor", factory: (ui, theme) => new Editor(ui, theme) },
	{ name: "CustomEditor", factory: (ui, theme, keys) => new CustomEditor(ui, theme, keys) },
];

const historyA = ["A stashed latest", "A session latest", "A session older"];
const historyB = ["B stashed latest", "B session latest", "B session older"];
const draftA = "A unfinished first line\nA unfinished second line";
const draftB = "B unfinished first line\nB unfinished second line";

describe("prompt history follows the editor actually mounted for a tab", () => {
	it.each(editorFactories)("keeps A -> B -> A cycles isolated with a $name replacement", async ({ factory }) => {
		const fixture = await createFixture();
		const { host, tabA, tabB } = fixture;
		host.createTabScopedExtensionUIContext(tabB.id).setEditorComponent(factory);
		host.tabManager.setDraft(tabB.id, draftB);
		host.editor.setText(draftA);
		expectHistory(fixture, historyA, draftA);

		for (let cycle = 0; cycle < 2; cycle++) {
			await fixture.focus(tabB);
			expect(host.editor).not.toBe(host.defaultEditor);
			expectHistory(fixture, historyB, draftB);
			await fixture.focus(tabA);
			expect(host.editor).toBe(host.defaultEditor);
			expectHistory(fixture, historyA, draftA);
		}
	});

	it.each(editorFactories)(
		"seeds $name when a background bind mounts its editor on the visible tab",
		async ({ factory }) => {
			const fixture = await createFixture();
			fixture.host.editor.setText(draftA);
			fixture.host.createTabScopedExtensionUIContext(fixture.tabA.id).setEditorComponent(factory);
			fixture.host.mountBoundTabChrome(fixture.tabA);

			expect(fixture.host.editor).not.toBe(fixture.host.defaultEditor);
			expectHistory(fixture, historyA, draftA);
		},
	);
});

describe("a submit owns its mounted tab before asynchronous binding", () => {
	it("dispatches to A after B mounts and keeps handled raw input in A's revisit history", async () => {
		const fixture = await createFixture();
		const { host, tabA, tabB, sessionA, sessionB, inputs } = fixture;
		const bind = deferred();
		const entered = deferred();
		host.ensureSessionBoundForSubmit = async () => {
			entered.resolve();
			await bind.promise;
		};
		const promptA = vi.spyOn(sessionA, "prompt");
		const promptB = vi.spyOn(sessionB, "prompt");
		const raw = "raw handled A prompt\nsecond submitted line";
		const pending = fixture.submit(raw);
		await entered.promise;
		host.editor.setText(draftA);
		host.tabManager.setDraft(tabB.id, draftB);
		await fixture.focus(tabB);
		bind.resolve();
		await pending;
		await settleSubmission();

		expect.soft(promptA).toHaveBeenCalledWith(raw);
		expect.soft(promptB).not.toHaveBeenCalled();
		expect.soft(inputs).toEqual([{ owner: "A", text: raw }]);
		expect.soft(sessionA.sessionManager.getEntries().filter((entry) => entry.type === "message")).toHaveLength(2);
		expect.soft(host.activeTabIdForUi).toBe(tabB.id);
		expectHistory(fixture, historyB, draftB);
		await fixture.focus(tabA);
		expectHistory(fixture, [raw, ...historyA], draftA);
	});

	it("uses UI A when manager focus moves to B synchronously before the first await resumes", async () => {
		const fixture = await createFixture();
		const { host, tabA, tabB, sessionA, sessionB } = fixture;
		const promptA = vi.spyOn(sessionA, "prompt").mockResolvedValue(undefined);
		const promptB = vi.spyOn(sessionB, "prompt").mockResolvedValue(undefined);
		const pending = fixture.submit("submitted while UI still A");
		host.tabManager.activate(tabB.id);
		expect(host.activeTabIdForUi).toBe(tabA.id);
		await pending;
		await settleSubmission();

		expect.soft(promptA).toHaveBeenCalledWith("submitted while UI still A");
		expect.soft(promptB).not.toHaveBeenCalled();
		host.tabManager.activate(tabA.id);
		await fixture.focus(tabB);
		await fixture.focus(tabA);
		expectHistory(fixture, ["submitted while UI still A", ...historyA], "");
	});

	it.each(["closed", "replaced"] as const)("cancels when the owner is $0 during binding", async (mutation) => {
		const fixture = await createFixture();
		const { host, tabA, tabB, sessionA, sessionB } = fixture;
		const bind = deferred();
		const entered = deferred();
		host.ensureSessionBoundForSubmit = async () => {
			entered.resolve();
			await bind.promise;
		};
		const promptA = vi.spyOn(sessionA, "prompt").mockResolvedValue(undefined);
		const promptB = vi.spyOn(sessionB, "prompt").mockResolvedValue(undefined);
		const pending = fixture.submit("must not reach a different conversation");
		await entered.promise;
		host.tabManager.setDraft(tabB.id, draftB);
		await fixture.focus(tabB);
		if (mutation === "closed") await host.tabManager.closeTab(tabA.id);
		else Object.defineProperty(tabA.runtime, "session", { value: sessionB, configurable: true });
		bind.resolve();
		await pending;
		await settleSubmission();

		expect.soft(promptA).not.toHaveBeenCalled();
		expect.soft(promptB).not.toHaveBeenCalled();
		expectHistory(fixture, historyB, draftB);
	});

	it("captures Home's selected B recipient before a later switch to A", async () => {
		const fixture = await createFixture();
		const { host, tabA, tabB, sessionA, sessionB } = fixture;
		const bind = deferred();
		const entered = deferred();
		host.homeSelection.active = true;
		host.homeSelection.selectedIndex = 1;
		host.ensureSessionBoundForSubmit = async () => {
			entered.resolve();
			await bind.promise;
		};
		const promptA = vi.spyOn(sessionA, "prompt").mockResolvedValue(undefined);
		const promptB = vi.spyOn(sessionB, "prompt").mockResolvedValue(undefined);
		const pending = fixture.submit("Home chose B");
		await entered.promise;
		expect(host.activeTabIdForUi).toBe(tabB.id);
		host.tabManager.setDraft(tabA.id, draftA);
		await fixture.focus(tabA);
		bind.resolve();
		await pending;
		await settleSubmission();

		expect.soft(promptB).toHaveBeenCalledWith("Home chose B");
		expect.soft(promptA).not.toHaveBeenCalled();
		expectHistory(fixture, historyA, draftA);
		await fixture.focus(tabB);
		expectHistory(fixture, ["Home chose B", ...historyB], "");
	});
});

describe("programmatic Home commands clear only their submitted text", () => {
	it.each(["streaming", "compacting"] as const)(
		"clears a handled command on a %s tab while preserving its parked draft",
		async (state) => {
			const fixture = await createFixture();
			const { host, sessionA } = fixture;
			vi.spyOn(sessionA, state === "streaming" ? "isStreaming" : "isCompacting", "get").mockReturnValue(true);
			vi.spyOn(host, "isExtensionCommandFor").mockReturnValue(true);
			const prompt = vi.spyOn(sessionA, "prompt").mockResolvedValue(undefined);
			const command = "/local-command";

			await host.submitHomeCommand(command);
			expect(host.editor.getText()).toBe("");
			expect(prompt).toHaveBeenCalledWith(
				command,
				...(state === "streaming" ? [{ streamingBehavior: "steer" }] : []),
			);

			host.editor.setText(draftA);
			await host.submitHomeCommand(command);
			expect(host.editor.getText()).toBe(draftA);
		},
	);
});

describe("failed submits restore only the owner's empty draft", () => {
	it.each(["", draftA])("preserves B and restores A without overwriting A's draft %j", async (newerDraft) => {
		const fixture = await createFixture();
		const { host, tabA, tabB, sessionA } = fixture;
		const response = deferred();
		vi.spyOn(sessionA, "prompt").mockReturnValue(response.promise);
		const rejected = "A rejected prompt\nretry detail";
		await fixture.submit(rejected);
		await settleSubmission();
		host.editor.setText(newerDraft);
		host.tabManager.setDraft(tabB.id, draftB);
		await fixture.focus(tabB);
		response.reject(new Error("A send rejected"));
		await settleSubmission();

		expect.soft(host.showError).toHaveBeenCalledWith(expect.stringContaining("A send rejected"));
		expect.soft(host.activeTabIdForUi).toBe(tabB.id);
		expectHistory(fixture, historyB, draftB);
		await fixture.focus(tabA);
		expectHistory(fixture, [rejected, ...historyA], newerDraft || rejected);
	});

	it("does not replace Home's ephemeral draft when A rejects behind Home", async () => {
		const fixture = await createFixture();
		const { host, tabA, sessionA } = fixture;
		const response = deferred();
		vi.spyOn(sessionA, "prompt").mockReturnValue(response.promise);
		await fixture.submit("A failed behind Home");
		await settleSubmission();
		host.tabManager.setDraft(tabA.id, draftA);
		host.homeSelection.active = true;
		host.editor.setText("Home search draft\nsecond line");
		response.reject(new Error("A failed on Home"));
		await settleSubmission();

		expect.soft(host.homeSelection.active).toBe(true);
		expect.soft(host.editor.getText()).toBe("Home search draft\nsecond line");
		await fixture.focus(tabA);
		expectHistory(fixture, ["A failed behind Home", ...historyA], draftA);
	});
});

describe("dispatch restores focus only for host-side commands", () => {
	it.each(["/name renamed-A", "!printf A"])(
		"reattaches A before dispatching %s and preserves B's parked draft",
		async (text) => {
			const fixture = await createFixture();
			const { host, tabA, tabB } = fixture;
			const bind = deferred();
			const entered = deferred();
			const dispatched: Array<{ tabId: string | undefined; session: Harness["session"] }> = [];
			host.ensureSessionBoundForSubmit = async () => {
				entered.resolve();
				await bind.promise;
			};
			host.handleNameCommand = () => {
				dispatched.push({ tabId: host.activeTabIdForUi, session: host.runtimeHost.session });
			};
			host.handleBashCommand = async () => {
				dispatched.push({ tabId: host.activeTabIdForUi, session: host.runtimeHost.session });
			};
			const pending = fixture.submit(text);
			await entered.promise;
			host.tabManager.setDraft(tabB.id, draftB);
			await fixture.focus(tabB);
			bind.resolve();
			await pending;
			await settleSubmission();

			expect.soft(dispatched).toEqual([{ tabId: tabA.id, session: fixture.sessionA }]);
			expect.soft(host.activeTabIdForUi).toBe(tabA.id);
			expect.soft(tabB.draftInput).toBe(draftB);
			await fixture.focus(tabB);
			expectHistory(fixture, historyB, draftB);
		},
	);

	it.each(["streaming", "compacting"] as const)(
		"queues a %s A submit in the background without touching B",
		async (state) => {
			const fixture = await createFixture();
			const { host, tabA, tabB, sessionA, sessionB } = fixture;
			const bind = deferred();
			const entered = deferred();
			vi.spyOn(sessionA, state === "streaming" ? "isStreaming" : "isCompacting", "get").mockReturnValue(true);
			const promptA = vi.spyOn(sessionA, "prompt").mockResolvedValue(undefined);
			const promptB = vi.spyOn(sessionB, "prompt").mockResolvedValue(undefined);
			host.ensureSessionBoundForSubmit = async () => {
				entered.resolve();
				await bind.promise;
			};
			const text = `A ${state} raw input`;
			const pending = fixture.submit(text);
			await entered.promise;
			host.tabManager.setDraft(tabB.id, draftB);
			await fixture.focus(tabB);
			bind.resolve();
			await pending;
			await settleSubmission();

			if (state === "streaming") {
				expect.soft(promptA).toHaveBeenCalledWith(text, { streamingBehavior: "steer" });
			} else {
				expect.soft(host.compactionQueues.get(tabA.id)).toEqual([{ text, mode: "steer" }]);
				expect.soft(promptA).not.toHaveBeenCalled();
			}
			expect.soft(promptB).not.toHaveBeenCalled();
			expect.soft(host.activeTabIdForUi).toBe(tabB.id);
			expectHistory(fixture, historyB, draftB);
			await fixture.focus(tabA);
			expectHistory(fixture, [text, ...historyA], "");
		},
	);
});
