import { describe, expect, it, vi } from "vitest";
import { InteractiveMode } from "../../src/modes/interactive/interactive-mode.ts";

type SubmitTab = { id: string; title: string; runtime: { session: SubmitContext["session"] } };

type SubmitContext = {
	defaultEditor: { onSubmit?: (text: string) => Promise<void> };
	editor: { addToHistory?: (text: string) => void; getText: () => string; setText: (text: string) => void };
	session: {
		isCompacting: boolean;
		isStreaming: boolean;
		isBashRunning: boolean;
		prompt: (text: string, options?: unknown) => Promise<void>;
	};
	tabManager?: { activeTab: () => SubmitTab; get: (id: string) => SubmitTab | undefined };
	homeSelection: { active: boolean };
	activeTabIdForUi: string | undefined;
	promptHistory: Map<string, string[]>;
	recordPromptHistory(text: string, tab: SubmitTab | undefined): void;
	ui: { requestRender: () => void };
	attachHomeSelectionForSubmit: () => Promise<boolean>;
	ensureSessionBoundForSubmit: () => Promise<void>;
	flushPendingBashComponents: () => void;
	setEditorText: (text: string) => void;
	showError: (message: string) => void;
	onInputCallback?: (text: string) => void;
	pendingUserInputs: string[];
};

type InteractiveModePrivate = {
	setupEditorSubmitHandler(this: SubmitContext): void;
};

const interactiveModePrototype = InteractiveMode.prototype as unknown as InteractiveModePrivate;

/** A submit context whose active tab owns `session`, as a multi-tab instance does. */
function createSubmitContext(options: { withTabManager: boolean }): {
	context: SubmitContext;
	session: SubmitContext["session"];
} {
	const session = {
		isCompacting: false,
		isStreaming: false,
		isBashRunning: false,
		prompt: vi.fn(async () => {}),
	};
	const tab = { id: "s1", title: "Agent-01", runtime: { session } };
	const context: SubmitContext = {
		homeSelection: { active: false },
		activeTabIdForUi: options.withTabManager ? tab.id : undefined,
		promptHistory: new Map(),
		recordPromptHistory: Reflect.get(
			InteractiveMode.prototype,
			"recordPromptHistory",
		) as SubmitContext["recordPromptHistory"],
		defaultEditor: {},
		editor: { addToHistory: vi.fn(), getText: () => "", setText: vi.fn() },
		session,
		ui: { requestRender: vi.fn() },
		attachHomeSelectionForSubmit: vi.fn(async () => true),
		ensureSessionBoundForSubmit: vi.fn(async () => {}),
		flushPendingBashComponents: vi.fn(),
		setEditorText: vi.fn(),
		showError: vi.fn(),
		pendingUserInputs: [],
	};
	if (options.withTabManager)
		context.tabManager = { activeTab: () => tab, get: (id) => (id === tab.id ? tab : undefined) };
	return { context, session };
}

/**
 * A submit received while another tab's turn runs must reach the tab it was typed
 * in, not the tab focused when that turn ends.
 */
describe("interactive submit routes to the composer's tab", () => {
	it("sends straight to the active tab instead of the shared input queue", async () => {
		const { context, session } = createSubmitContext({ withTabManager: true });
		context.onInputCallback = vi.fn();
		interactiveModePrototype.setupEditorSubmitHandler.call(context);

		await context.defaultEditor.onSubmit?.("typed in tab A");
		await Promise.resolve();

		expect(session.prompt).toHaveBeenCalledWith("typed in tab A");
		expect(context.onInputCallback).not.toHaveBeenCalled();
		expect(context.pendingUserInputs).toEqual([]);
	});

	it("captures the submitting tab before a nested microtask changes focus after binding", async () => {
		const { context, session: sessionA } = createSubmitContext({ withTabManager: true });
		const { session: sessionB } = createSubmitContext({ withTabManager: true });
		const tabA = { id: "A", title: "Agent-A", runtime: { session: sessionA } };
		const tabB = { id: "B", title: "Agent-B", runtime: { session: sessionB } };
		let active = tabA;
		context.tabManager = {
			activeTab: () => active,
			get: (id) => (id === tabA.id ? tabA : id === tabB.id ? tabB : undefined),
		};
		context.ensureSessionBoundForSubmit = async () => {
			queueMicrotask(() =>
				queueMicrotask(() => {
					active = tabB;
				}),
			);
		};
		interactiveModePrototype.setupEditorSubmitHandler.call(context);

		await context.defaultEditor.onSubmit?.("ordinary input from A");

		expect(active).toBe(tabB);
		expect(sessionA.prompt).toHaveBeenCalledWith("ordinary input from A");
		expect(sessionB.prompt).not.toHaveBeenCalled();
	});

	it("binds the submitting tab before dispatch, then routes busy and idle input", async () => {
		const { context, session } = createSubmitContext({ withTabManager: true });
		const trace: string[] = [];
		let releaseBind: () => void = () => {};
		context.ensureSessionBoundForSubmit = async () => {
			trace.push("bind");
			await new Promise<void>((resolve) => {
				releaseBind = resolve;
			});
		};
		Object.assign(context, { handleThinkingCommand: (value: string) => trace.push(`thinking:${value}`) });
		interactiveModePrototype.setupEditorSubmitHandler.call(context);
		const command = context.defaultEditor.onSubmit?.("  /thinking high  ");
		await Promise.resolve();
		expect(trace).toEqual(["bind"]);
		expect(context.editor.setText).not.toHaveBeenCalled();
		releaseBind();
		await command;
		expect(trace).toEqual(["bind", "thinking:high"]);
		context.ensureSessionBoundForSubmit = async () => {};
		session.isStreaming = true;
		Object.assign(context, { updatePendingMessagesDisplay: vi.fn() });
		await context.defaultEditor.onSubmit?.("  steer active tab  ");
		expect(session.prompt).toHaveBeenCalledWith("steer active tab", { streamingBehavior: "steer" });
		session.isStreaming = false;
		await context.defaultEditor.onSubmit?.("idle active tab");
		expect(session.prompt).toHaveBeenCalledWith("idle active tab");
		expect(context.pendingUserInputs).toEqual([]);
	});

	it("declines an unattached Home row without binding or dispatch", async () => {
		const { context, session } = createSubmitContext({ withTabManager: true });
		// A roster row whose runtime is not ready yet is the case Home cannot attach.
		context.homeSelection.active = true;
		Object.assign(context, { homeRoster: () => [] });
		interactiveModePrototype.setupEditorSubmitHandler.call(context);
		await context.defaultEditor.onSubmit?.("/thinking high");
		expect(context.ensureSessionBoundForSubmit).not.toHaveBeenCalled();
		expect(session.prompt).not.toHaveBeenCalled();
		expect(context.editor.setText).not.toHaveBeenCalled();
	});

	it("keeps the shared input queue for a session without tabs", async () => {
		const { context } = createSubmitContext({ withTabManager: false });
		const onInputCallback = vi.fn();
		context.onInputCallback = onInputCallback;
		interactiveModePrototype.setupEditorSubmitHandler.call(context);

		await context.defaultEditor.onSubmit?.("single session prompt");
		await Promise.resolve();

		expect(onInputCallback).toHaveBeenCalledWith("single session prompt");
		expect(context.session.prompt).not.toHaveBeenCalled();
		expect(context.pendingUserInputs).toEqual([]);
	});
});
