import { Container, Editor, getKeybindings, setKeybindings, TuiMainScreen } from "@earendil-works/pi-tui";
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { VirtualTerminal } from "../../../tui/test/virtual-terminal.ts";
import type { ExtensionUIContext } from "../../src/core/extensions/types.ts";
import { KeybindingsManager } from "../../src/core/keybindings.ts";
import { ExtensionSelectorComponent } from "../../src/modes/interactive/components/extension-selector.ts";
import { InteractiveMode } from "../../src/modes/interactive/interactive-mode.ts";
import { getEditorTheme, initTheme } from "../../src/modes/interactive/theme/theme.ts";

/**
 * The app's chrome shortcuts must answer while an extension dialog owns the keyboard.
 *
 * A dialog an extension opens as a capturing overlay takes focus from the composer, which
 * leaves every action bound with `defaultEditor.onAction` dead until the dialog closes. The
 * shortcuts that keep working are answered by a raw input listener instead.
 *
 * The host is the shape the tab-dialog tests use: a real TUI and overlay stack, and only
 * the fields the methods under test read. The target handlers are stubs, so each case pins
 * which key reaches which action, not what the action does.
 */
beforeAll(() => {
	initTheme("dark");
});

let previousKeybindings: ReturnType<typeof getKeybindings>;

beforeEach(() => {
	previousKeybindings = getKeybindings();
});

afterEach(() => {
	setKeybindings(previousKeybindings);
});

interface ShortcutHost {
	ui: TuiMainScreen;
	editorContainer: Container;
	editor: Editor;
	tabInteractions: Map<string, unknown>;
	activeTabIdForUi: string | undefined;
	homeSelection: { active: boolean };
	extensionContextFor(tabId: string): ExtensionUIContext;
	handleExtensionDialogShortcut(data: string): { consume: boolean } | undefined;
}

/** Plain keys for the actions whose defaults are chords, so the test sends a byte, not a sequence. */
const USER_BINDINGS = {
	"app.quit": "q",
	"app.palette": "p",
	"app.tab.jump": "t",
	"app.tab.new": "n",
	"app.tab.close": "c",
} as const;

function createHost(): ShortcutHost {
	const ui = new TuiMainScreen(new VirtualTerminal());
	const keybindings = new KeybindingsManager({ ...USER_BINDINGS });
	setKeybindings(keybindings);
	const editorContainer = new Container();
	const editor = new Editor(ui, getEditorTheme());
	editorContainer.addChild(editor);
	const host = Object.create(InteractiveMode.prototype) as ShortcutHost;
	Object.assign(host, {
		ui,
		editorContainer,
		editor,
		tabInteractions: new Map(),
		activeTabIdForUi: "tab-a",
		homeSelection: { active: false },
		tabManager: undefined,
		activeSelectorToken: undefined,
		activeSelectorDispose: undefined,
		keybindings,
	});
	host.extensionContextFor = (tabId) =>
		(
			host as unknown as { createTabScopedExtensionUIContext(tabId: string): ExtensionUIContext }
		).createTabScopedExtensionUIContext(tabId);
	return host;
}

/** Record which action each shortcut reaches, in call order. */
function stubHandlers(host: ShortcutHost): string[] {
	const calls: string[] = [];
	Object.assign(host, {
		handleTabCycle: (delta: number) => {
			calls.push(`tab:${delta}`);
			return true;
		},
		handleTabJumpShortcut: () => void calls.push("jump"),
		handleNewTab: () => void calls.push("new"),
		handleCloseTab: () => void calls.push("close"),
		handlePaletteShortcut: () => void calls.push("palette"),
		showQuitConfirm: () => void calls.push("quit"),
	});
	return calls;
}

/**
 * Open a real extension dialog on the editor slot (the shape `ctx.ui.select`, `confirm`,
 * `input` and the app's own session confirmations take) and hand it the keyboard.
 */
async function openSlottedDialog(host: ShortcutHost): Promise<void> {
	void host.extensionContextFor("tab-a").select("Pick one", ["one", "two"]);
	await vi.waitFor(() => expect(host.ui.getFocusedComponent()).toBeInstanceOf(ExtensionSelectorComponent));
}

/** Open a real extension overlay on tab-a and hand it the keyboard. */
async function openDialog(host: ShortcutHost): Promise<void> {
	host.extensionContextFor("tab-a").custom(() => ({ render: () => ["DIALOG"], invalidate: () => {} }), {
		overlay: true,
		overlayOptions: { width: 20 },
	});
	await vi.waitFor(() => expect(host.ui.hasOverlay()).toBe(true));
	(host as unknown as { focusTabInteractions(tabId: string): void }).focusTabInteractions("tab-a");
	expect(host.ui.getFocusedComponent()).not.toBe(host.editor);
}

describe("app chrome shortcuts over an extension dialog", () => {
	test("without a dialog on the keyboard the editor keeps every key", () => {
		const host = createHost();
		const calls = stubHandlers(host);
		expect(host.handleExtensionDialogShortcut("\t")).toBeUndefined();
		expect(host.handleExtensionDialogShortcut("q")).toBeUndefined();
		expect(calls).toEqual([]);
	});

	test("a focused dialog leaves the chrome keys to the app", async () => {
		const host = createHost();
		await openDialog(host);
		const calls = stubHandlers(host);

		expect(host.handleExtensionDialogShortcut("\t")).toEqual({ consume: true });
		expect(host.handleExtensionDialogShortcut("\x1b[Z")).toEqual({ consume: true });
		expect(host.handleExtensionDialogShortcut("t")).toEqual({ consume: true });
		expect(host.handleExtensionDialogShortcut("n")).toEqual({ consume: true });
		expect(host.handleExtensionDialogShortcut("c")).toEqual({ consume: true });
		expect(host.handleExtensionDialogShortcut("p")).toEqual({ consume: true });
		expect(host.handleExtensionDialogShortcut("q")).toEqual({ consume: true });
		expect(calls).toEqual(["tab:1", "tab:-1", "jump", "new", "close", "palette", "quit"]);
	});

	test("a dialog on the editor slot leaves the chrome keys to the app too", async () => {
		const host = createHost();
		await openSlottedDialog(host);
		const calls = stubHandlers(host);

		// Tab is how a session confirmation parks on its tab and comes back with it, so the frame
		// the dialog holds must reach the app's tab cycling and Tab Jump.
		expect(host.handleExtensionDialogShortcut("\t")).toEqual({ consume: true });
		expect(host.handleExtensionDialogShortcut("\x1b[Z")).toEqual({ consume: true });
		expect(host.handleExtensionDialogShortcut("t")).toEqual({ consume: true });
		expect(calls).toEqual(["tab:1", "tab:-1", "jump"]);
	});

	test("keys the dialog owns, its cancel and arrows included, still reach it", async () => {
		const host = createHost();
		await openDialog(host);
		const calls = stubHandlers(host);

		expect(host.handleExtensionDialogShortcut("a")).toBeUndefined();
		expect(host.handleExtensionDialogShortcut("\x1b")).toBeUndefined();
		expect(host.handleExtensionDialogShortcut("\x1b[D")).toBeUndefined();
		expect(host.handleExtensionDialogShortcut("\r")).toBeUndefined();
		expect(calls).toEqual([]);
	});
});
