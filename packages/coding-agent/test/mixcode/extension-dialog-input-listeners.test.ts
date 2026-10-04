import { getKeybindings, setKeybindings, TuiMainScreen } from "@earendil-works/pi-tui";
import { afterEach, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { VirtualTerminal } from "../../../tui/test/virtual-terminal.ts";
import { KeybindingsManager } from "../../src/core/keybindings.ts";
import { InteractiveMode } from "../../src/modes/interactive/interactive-mode.ts";
import { initTheme } from "../../src/modes/interactive/theme/theme.ts";

/**
 * A terminal-input listener an extension registered through `ctx.ui.onTerminalInput` belongs
 * to its tab. A tab that is not the one on screen parks the listener, and bringing the tab
 * back registers it again.
 *
 * A listener dropped on the first tab switch leaves an extension unable to answer keys
 * afterwards, which strands any state those keys drive: an overlay hidden on collapse has no
 * other way to reopen.
 *
 * The host carries only the fields the methods under test read; the TUI and terminal are
 * real, so the assertions run through the same input path the app uses.
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

type TerminalInputHandler = (data: string) => { consume?: boolean; data?: string } | undefined;

interface ListenerHost {
	ui: TuiMainScreen;
	extensionTerminalInputSubscriptions: Set<unknown>;
	activeTabIdForUi: string | undefined;
	homeSelection: { active: boolean };
	tabManager: undefined;
	addExtensionTerminalInputListener(tabId: string | undefined, handler: TerminalInputHandler): () => void;
	attachExtensionTerminalInputListeners(tabId: string): void;
	detachExtensionTerminalInputListeners(tabId: string): void;
}

function createHost(activeTabIdForUi: string): { host: ListenerHost; terminal: VirtualTerminal } {
	const terminal = new VirtualTerminal(80, 24);
	const ui = new TuiMainScreen(terminal);
	const host = Object.create(InteractiveMode.prototype) as ListenerHost;
	Object.assign(host, {
		ui,
		extensionTerminalInputSubscriptions: new Set(),
		activeTabIdForUi,
		homeSelection: { active: false },
		tabManager: undefined,
	});
	return { host, terminal };
}

/** Record the keys a listener receives, so the test asserts delivery, not registration. */
function recordingListener(received: string[]): TerminalInputHandler {
	return (data) => {
		received.push(data);
		return undefined;
	};
}

describe("extension terminal-input listeners across tabs", () => {
	test("a listener parks with its tab and answers again when the tab returns", () => {
		const { host, terminal } = createHost("tab-b");
		host.ui.start();
		const received: string[] = [];
		host.addExtensionTerminalInputListener("tab-a", recordingListener(received));

		// tab-b is in front, so tab-a's listener must not see its keys.
		terminal.sendInput("x");
		expect(received).toEqual([]);

		// tab-a takes focus: the parked listener is registered.
		host.activeTabIdForUi = "tab-a";
		host.attachExtensionTerminalInputListeners("tab-a");
		terminal.sendInput("y");
		expect(received).toEqual(["y"]);

		// tab-a leaves: the listener parks and stays silent.
		host.detachExtensionTerminalInputListeners("tab-a");
		host.activeTabIdForUi = "tab-b";
		terminal.sendInput("z");
		expect(received).toEqual(["y"]);

		// Returning registers it again; this is the path a collapse-and-reopen needs.
		host.activeTabIdForUi = "tab-a";
		host.attachExtensionTerminalInputListeners("tab-a");
		terminal.sendInput("w");
		expect(received).toEqual(["y", "w"]);

		host.ui.stop();
	});

	test("a listener of the tab on screen answers right away", () => {
		const { host, terminal } = createHost("tab-a");
		host.ui.start();
		const received: string[] = [];
		host.addExtensionTerminalInputListener("tab-a", recordingListener(received));

		terminal.sendInput("x");
		expect(received).toEqual(["x"]);

		host.ui.stop();
	});
});
