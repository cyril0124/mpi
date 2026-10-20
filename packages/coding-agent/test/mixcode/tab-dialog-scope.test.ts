import { Container, Editor, getKeybindings, setKeybindings, TuiMainScreen } from "@earendil-works/pi-tui";
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { VirtualTerminal } from "../../../tui/test/virtual-terminal.ts";
import type { ExtensionUIContext } from "../../src/core/extensions/types.ts";
import { KeybindingsManager } from "../../src/core/keybindings.ts";
import { MissingSessionCwdError } from "../../src/core/session-cwd.ts";
import { ExtensionEditorComponent } from "../../src/modes/interactive/components/extension-editor.ts";
import { ExtensionInputComponent } from "../../src/modes/interactive/components/extension-input.ts";
import { ExtensionSelectorComponent } from "../../src/modes/interactive/components/extension-selector.ts";
import { InteractiveMode } from "../../src/modes/interactive/interactive-mode.ts";
import { getEditorTheme, initTheme } from "../../src/modes/interactive/theme/theme.ts";

/**
 * An extension dialog belongs to the tab whose session opened it: it paints only while
 * that tab is on screen, and the tab reports the wait with `?` until it is answered.
 *
 * The tests use a real TUI, a real editor slot, and the real prototype methods, with
 * only the fields a running instance would have initialized: the constructor is not
 * run, and the dialogs touch nothing outside those fields.
 */
beforeAll(() => {
	initTheme("dark");
});

let previousKeybindings: ReturnType<typeof getKeybindings>;

beforeEach(() => {
	previousKeybindings = getKeybindings();
	setKeybindings(new KeybindingsManager());
});

afterEach(() => {
	setKeybindings(previousKeybindings);
});

interface TestHost {
	ui: TuiMainScreen;
	editorContainer: Container;
	editor: Editor;
	tabInteractions: Map<string, unknown>;
	activeTabIdForUi: string | undefined;
	homeSelection: { active: boolean };
	programStatus: { setBlocked(source: string, status: unknown): void };
	runtimeHost: { importFromJsonl(path: string, cwd?: string): Promise<{ cancelled: boolean }> };
	clearStatusIndicator(): void;
	showStatus(message: string): void;
	handleImportCommand(text: string): Promise<void>;
	promptForMissingSessionCwd(error: MissingSessionCwdError): Promise<string | undefined>;
	extensionContextFor(tabId: string): ExtensionUIContext;
}

/** The InteractiveMode methods under test, on a host that only carries their inputs. */
function createHost(activeTabIdForUi: string): TestHost {
	const ui = new TuiMainScreen(new VirtualTerminal());
	const editorContainer = new Container();
	const editor = new Editor(ui, getEditorTheme());
	// The running app mounts the composer on the slot; a parked dialog gives it back here.
	editorContainer.addChild(editor);
	const host = Object.create(InteractiveMode.prototype) as TestHost;
	Object.assign(host, {
		ui,
		editorContainer,
		editor,
		tabInteractions: new Map(),
		activeTabIdForUi,
		homeSelection: { active: false },
		tabManager: undefined,
		activeSelectorToken: undefined,
		activeSelectorDispose: undefined,
		keybindings: new KeybindingsManager(),
		// A dialog reports the block it puts on the process, which `blockedCalls` reads back.
		programStatus: { setBlocked: vi.fn() },
		// `/import` asks first and then hands the file to the runtime; both are stubbed here.
		runtimeHost: { importFromJsonl: vi.fn(async () => ({ cancelled: false })) },
		clearStatusIndicator: vi.fn(),
		showStatus: vi.fn(),
	});
	// The extension editor reads the external-editor command from the settings manager, which
	// belongs to the running session. Its class getter has no setter, so the field is defined here.
	Object.defineProperty(host, "settingsManager", {
		value: { getExternalEditorCommand: () => undefined },
	});
	host.extensionContextFor = (tabId) =>
		(
			host as unknown as { createTabScopedExtensionUIContext(tabId: string): ExtensionUIContext }
		).createTabScopedExtensionUIContext(tabId);
	return host;
}

/** The component on the editor slot: the composer itself when no dialog holds it. */
function slotted(host: TestHost): unknown {
	return host.editorContainer.children[0];
}

/** Whether the tab reports a pending extension dialog. */
function waiting(host: TestHost, tabId: string): boolean {
	return (host as unknown as { tabWaitingForInput(tabId: string): boolean }).tabWaitingForInput(tabId);
}

/** What the dialogs told the terminal about blocking the process, oldest first. */
function blockedCalls(host: TestHost): Array<[string, unknown]> {
	return (host.programStatus.setBlocked as unknown as { mock: { calls: Array<[string, unknown]> } }).mock.calls;
}

/** What `switchActiveTab` does for the incoming tab. */
function focusTab(host: TestHost, tabId: string): void {
	host.activeTabIdForUi = tabId;
	(host as unknown as { focusTabInteractions(tabId: string): void }).focusTabInteractions(tabId);
}

/** What `detachTabUi` does for the outgoing tab. */
function parkTab(host: TestHost, tabId: string): void {
	(host as unknown as { parkTabInteractions(tabId: string): void }).parkTabInteractions(tabId);
}

/** Drop a closed tab's interactions, as `disposeTabUi` does. */
function forgetTab(host: TestHost, tabId: string): void {
	(host as unknown as { forgetTabInteractions(tabId: string): void }).forgetTabInteractions(tabId);
}

/** The chip the tab bar would paint for a tab, through the real projection. */
function chipWaiting(host: TestHost, tabId: string, activeId = "tab-b"): boolean | undefined {
	const item = (
		host as unknown as {
			tabBarItem(tab: unknown, activeId: string): { waiting?: boolean };
		}
	).tabBarItem({ id: tabId, title: tabId, status: "idle", unread: false }, activeId);
	return item.waiting;
}

describe("tab-scoped extension dialogs", () => {
	test("an overlay dialog of a background tab is not shown, and its chip reports the wait", async () => {
		const host = createHost("tab-b");
		const dialog = { render: () => ["ASKED-ON-A"], invalidate: () => {} };
		let answer: ((value: string) => void) | undefined;
		let registered = false;
		const pending = host.extensionContextFor("tab-a").custom<string>(
			(_tui, _theme, _keybindings, done) => {
				answer = done;
				return dialog;
			},
			{
				overlay: true,
				overlayOptions: { width: 20 },
				onHandle: () => {
					registered = true;
				},
			},
		);

		// The factory resolves on a microtask; the overlay exists once the handle lands.
		await vi.waitFor(() => expect(registered).toBe(true));
		// Tab B is in front, so the question does not paint there.
		expect(host.ui.hasOverlay()).toBe(false);
		expect(waiting(host, "tab-a")).toBe(true);
		expect(waiting(host, "tab-b")).toBe(false);
		// The tab bar marks the waiting tab, and only that one.
		expect(chipWaiting(host, "tab-a")).toBe(true);
		expect(chipWaiting(host, "tab-b")).toBe(false);

		// Switching to the asking tab shows the question there, on the keyboard: the overlay
		// was pushed while its gate was false, so showing it is what has to take focus.
		focusTab(host, "tab-a");
		expect(host.ui.hasOverlay()).toBe(true);
		expect(host.ui.getFocusedComponent()).toBe(dialog);

		// Answering it clears the wait.
		answer!("picked");
		expect(await pending).toBe("picked");
		expect(waiting(host, "tab-a")).toBe(false);
		expect(host.ui.hasOverlay()).toBe(false);
	});

	test("an overlay the extension collapsed stays hidden even on its own tab", async () => {
		const host = createHost("tab-a");
		let handle: { setHidden(hidden: boolean): void } | undefined;
		const pending = host
			.extensionContextFor("tab-a")
			.custom<string>(
				(_tui, _theme, _keybindings, _done) => ({ render: () => ["ASKED-ON-A"], invalidate: () => {} }),
				{
					overlay: true,
					overlayOptions: { width: 20 },
					onHandle: (created) => {
						handle = created;
					},
				},
			);
		await vi.waitFor(() => expect(host.ui.hasOverlay()).toBe(true));

		// The collapse shortcut hides the overlay; the tab gate must not undo it.
		handle!.setHidden(true);
		expect(host.ui.hasOverlay()).toBe(false);
		// A tab switch while it is collapsed leaves it collapsed.
		host.activeTabIdForUi = "tab-b";
		focusTab(host, "tab-a");
		expect(host.ui.hasOverlay()).toBe(false);
		handle!.setHidden(false);
		expect(host.ui.hasOverlay()).toBe(true);
		expect(waiting(host, "tab-a")).toBe(true);
		void pending;
	});

	test("a selector opened by a background tab parks, then mounts when its tab comes forward", async () => {
		const host = createHost("tab-b");
		const pending = host.extensionContextFor("tab-a").select("Pick one", ["first", "second"]);

		// Parked: the composer still belongs to the tab in front.
		expect(slotted(host)).toBe(host.editor);
		expect(waiting(host, "tab-a")).toBe(true);

		focusTab(host, "tab-a");
		const selector = slotted(host);
		expect(selector).toBeInstanceOf(ExtensionSelectorComponent);
		expect(waiting(host, "tab-a")).toBe(true);

		// The answer resolves the extension's promise and gives the slot back.
		(selector as ExtensionSelectorComponent).handleInput("\r");
		expect(await pending).toBe("first");
		expect(slotted(host)).toBe(host.editor);
		expect(waiting(host, "tab-a")).toBe(false);
	});

	test("a selector survives a tab switch and keeps its answer on its own tab", async () => {
		const host = createHost("tab-a");
		const pending = host.extensionContextFor("tab-a").select("Pick one", ["first", "second"]);
		focusTab(host, "tab-a");
		const selector = slotted(host);

		// The user switches away while the question is up: the dialog parks with its tab,
		// so the extension keeps waiting for an answer.
		parkTab(host, "tab-a");
		host.activeTabIdForUi = "tab-b";
		expect(slotted(host)).toBe(host.editor);
		expect(waiting(host, "tab-a")).toBe(true);

		// Coming back puts the same dialog on the slot.
		focusTab(host, "tab-a");
		expect(slotted(host)).toBe(selector);
		(selector as ExtensionSelectorComponent).handleInput("j");
		(selector as ExtensionSelectorComponent).handleInput("\r");
		expect(await pending).toBe("second");
		expect(slotted(host)).toBe(host.editor);
		expect(waiting(host, "tab-a")).toBe(false);
	});

	test("a dialog the newest one displaced comes back when that one closes", async () => {
		const host = createHost("tab-a");
		const first = host.extensionContextFor("tab-a").select("First question", ["one", "two"]);
		const second = host.extensionContextFor("tab-a").select("Second question", ["three", "four"]);

		// The newest dialog holds the slot; the one it displaced is parked and unanswered.
		const newest = slotted(host) as ExtensionSelectorComponent;
		expect(newest.render(60).join("\n")).toContain("Second question");
		expect(waiting(host, "tab-a")).toBe(true);

		newest.handleInput("\r");
		expect(await second).toBe("three");
		const parked = slotted(host) as ExtensionSelectorComponent;
		expect(parked).toBeInstanceOf(ExtensionSelectorComponent);
		expect(parked.render(60).join("\n")).toContain("First question");
		expect(waiting(host, "tab-a")).toBe(true);

		parked.handleInput("\r");
		expect(await first).toBe("one");
		expect(slotted(host)).toBe(host.editor);
		expect(waiting(host, "tab-a")).toBe(false);
	});

	test("a closed tab stops reporting its parked dialog and gives the slot back", async () => {
		const host = createHost("tab-b");
		void host.extensionContextFor("tab-a").select("Pick one", ["first"]);
		expect(waiting(host, "tab-a")).toBe(true);

		forgetTab(host, "tab-a");

		expect(waiting(host, "tab-a")).toBe(false);
		expect(slotted(host)).toBe(host.editor);
	});

	test("a context captured while its tab was in front still owns its dialogs after a switch", async () => {
		// The bind that hands a session its context runs while its tab is in front; the
		// extension may ask its question much later, from another tab.
		const host = createHost("tab-a");
		const context = host.extensionContextFor("tab-a");
		host.activeTabIdForUi = "tab-b";

		const pending = context.select("Pick one", ["first", "second"]);
		expect(slotted(host)).toBe(host.editor);
		expect(waiting(host, "tab-a")).toBe(true);
		expect(waiting(host, "tab-b")).toBe(false);

		focusTab(host, "tab-a");
		const selector = slotted(host);
		expect(selector).toBeInstanceOf(ExtensionSelectorComponent);
		(selector as ExtensionSelectorComponent).handleInput("\r");
		expect(await pending).toBe("first");
	});

	test("an unscoped context owns whatever the user is looking at when the dialog is asked for", async () => {
		// A context made on the spot (a shortcut handler, a trust prompt) has no tab of its
		// own, so it follows the user instead of parking on the tab it was made under.
		const host = createHost("tab-a");
		const context = (
			host as unknown as { createExtensionUIContext(): ExtensionUIContext }
		).createExtensionUIContext();
		host.activeTabIdForUi = "tab-b";

		const pending = context.select("Pick one", ["first", "second"]);
		expect(slotted(host)).toBeInstanceOf(ExtensionSelectorComponent);
		expect(waiting(host, "tab-b")).toBe(true);
		expect(waiting(host, "tab-a")).toBe(false);
		(slotted(host) as ExtensionSelectorComponent).handleInput("\r");
		expect(await pending).toBe("first");
		expect(slotted(host)).toBe(host.editor);
		expect(waiting(host, "tab-b")).toBe(false);
	});

	test("a dialog parks while Home covers the tabs, and a new one does not paint over Home", async () => {
		const host = createHost("tab-a");
		const pending = host.extensionContextFor("tab-a").select("Pick one", ["first", "second"]);
		focusTab(host, "tab-a");
		expect(slotted(host)).toBeInstanceOf(ExtensionSelectorComponent);

		// Home covers the tab, so the dialog goes back into the park.
		parkTab(host, "tab-a");
		host.homeSelection.active = true;
		expect(slotted(host)).toBe(host.editor);

		// An extension asking while Home is up parks as well; nothing paints over Home.
		const second = host.extensionContextFor("tab-a").input("Type here");
		expect(slotted(host)).toBe(host.editor);
		expect(waiting(host, "tab-a")).toBe(true);

		// Leaving Home returns the newest dialog, and the wait survives for the answer.
		host.homeSelection.active = false;
		focusTab(host, "tab-a");
		expect(slotted(host)).toBeInstanceOf(ExtensionInputComponent);
		expect(waiting(host, "tab-a")).toBe(true);
		void pending;
		void second;
	});

	test("an input opened by a background tab parks, and the terminal hears about the block", async () => {
		const host = createHost("tab-b");
		const pending = host.extensionContextFor("tab-a").input("Type a name");

		// Parked with its tab, but the extension still waits, so the block is reported.
		expect(slotted(host)).toBe(host.editor);
		expect(waiting(host, "tab-a")).toBe(true);
		expect(blockedCalls(host)).toEqual([["extension-dialog", { kind: "question", message: "Type a name" }]]);

		focusTab(host, "tab-a");
		const input = slotted(host);
		expect(input).toBeInstanceOf(ExtensionInputComponent);
		(input as ExtensionInputComponent).handleInput("hi");
		(input as ExtensionInputComponent).handleInput("\n");
		expect(await pending).toBe("hi");

		// The answer gives the slot back and drops the block it reported.
		expect(slotted(host)).toBe(host.editor);
		expect(waiting(host, "tab-a")).toBe(false);
		expect(blockedCalls(host).at(-1)).toEqual(["extension-dialog", undefined]);
	});

	test("a confirm opened by a background tab parks and reports a permission block", async () => {
		const host = createHost("tab-b");
		const pending = host.extensionContextFor("tab-a").confirm("Delete it?", "This cannot be undone");

		expect(slotted(host)).toBe(host.editor);
		expect(blockedCalls(host)).toEqual([["extension-dialog", { kind: "permission", message: "Delete it?" }]]);

		focusTab(host, "tab-a");
		const selector = slotted(host);
		expect(selector).toBeInstanceOf(ExtensionSelectorComponent);
		(selector as ExtensionSelectorComponent).handleInput("\r");
		expect(await pending).toBe(true);
		expect(slotted(host)).toBe(host.editor);
	});

	test("an editor opened by a background tab parks until its tab comes forward", async () => {
		const host = createHost("tab-b");
		const pending = host.extensionContextFor("tab-a").editor("Edit it", "draft");

		expect(slotted(host)).toBe(host.editor);
		expect(waiting(host, "tab-a")).toBe(true);

		focusTab(host, "tab-a");
		const editor = slotted(host);
		expect(editor).toBeInstanceOf(ExtensionEditorComponent);
		(editor as ExtensionEditorComponent).handleInput("\r");
		expect(await pending).toBe("draft");

		expect(slotted(host)).toBe(host.editor);
		expect(waiting(host, "tab-a")).toBe(false);
	});
});

/**
 * The app's own dialogs carry the mounted tab, like an extension's. Asked for without a tab,
 * the dialog is not parked when its tab goes behind: attaching the next tab clears the editor
 * slot it waits in, so the question disappears and its promise never settles.
 */
describe("app dialogs belong to the mounted tab", () => {
	test("the /import confirmation parks with its tab and answers there", async () => {
		const host = createHost("tab-a");
		const pending = host.handleImportCommand("/import /tmp/session.jsonl");

		expect(waiting(host, "tab-a")).toBe(true);
		const selector = slotted(host);
		expect(selector).toBeInstanceOf(ExtensionSelectorComponent);

		// Switching away parks the question instead of dropping it.
		parkTab(host, "tab-a");
		host.activeTabIdForUi = "tab-b";
		expect(slotted(host)).toBe(host.editor);
		expect(waiting(host, "tab-a")).toBe(true);

		// Coming back puts it on the slot again, and the answer runs the import.
		focusTab(host, "tab-a");
		expect(slotted(host)).toBe(selector);
		(selector as ExtensionSelectorComponent).handleInput("\r");
		await pending;
		expect(host.runtimeHost.importFromJsonl).toHaveBeenCalledWith("/tmp/session.jsonl");
	});

	test("the missing-cwd prompt of /resume parks with its tab", async () => {
		const host = createHost("tab-a");
		const pending = host.promptForMissingSessionCwd(
			new MissingSessionCwdError({ sessionCwd: "/gone", fallbackCwd: "/here" }),
		);

		expect(waiting(host, "tab-a")).toBe(true);
		parkTab(host, "tab-a");
		host.activeTabIdForUi = "tab-b";
		expect(waiting(host, "tab-a")).toBe(true);

		focusTab(host, "tab-a");
		const selector = slotted(host);
		expect(selector).toBeInstanceOf(ExtensionSelectorComponent);
		(selector as ExtensionSelectorComponent).handleInput("\r");
		expect(await pending).toBe("/here");
	});
});
