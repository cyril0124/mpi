import { describe, expect, it, vi } from "vitest";
import { InteractiveMode } from "../../src/modes/interactive/interactive-mode.ts";

type SubmitContext = {
	defaultEditor: { onSubmit?: (text: string) => Promise<void> };
	editor: { addToHistory?: (text: string) => void; setText: (text: string) => void };
	session: {
		isCompacting: boolean;
		isStreaming: boolean;
		isBashRunning: boolean;
		prompt: (text: string, options?: unknown) => Promise<void>;
	};
	tabManager?: { activeTab: () => { id: string; title: string; runtime: { session: SubmitContext["session"] } } };
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
		defaultEditor: {},
		editor: { addToHistory: vi.fn(), setText: vi.fn() },
		session,
		ui: { requestRender: vi.fn() },
		attachHomeSelectionForSubmit: vi.fn(async () => true),
		ensureSessionBoundForSubmit: vi.fn(async () => {}),
		flushPendingBashComponents: vi.fn(),
		setEditorText: vi.fn(),
		showError: vi.fn(),
		pendingUserInputs: [],
	};
	if (options.withTabManager) context.tabManager = { activeTab: () => tab };
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
