import {
	type AutocompleteProvider,
	CombinedAutocompleteProvider,
	type Component,
	Container,
	TuiMainScreen,
} from "@earendil-works/pi-tui";
import { afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import { VirtualTerminal } from "../../../tui/test/virtual-terminal.ts";
import type { AutocompleteProviderFactory } from "../../src/core/extensions/index.ts";
import { KeybindingsManager } from "../../src/core/keybindings.ts";
import { MixcodePromptEditor } from "../../src/modes/interactive/components/mixcode/input-dock/prompt-editor.ts";
import { InteractiveMode } from "../../src/modes/interactive/interactive-mode.ts";
import type { ExtensionUiController } from "../../src/modes/interactive/mixcode/extensions/extension-ui-controller.ts";
import { getEditorTheme, initTheme } from "../../src/modes/interactive/theme/theme.ts";
import { stripAnsi } from "../../src/utils/ansi.ts";

type Widget = Component & { dispose?(): void };
type ChromeHost = Pick<ExtensionUiController, "createExtensionUIContext" | "detachTabUi" | "attachTabUi"> & {
	activeTabIdForUi: string;
	extensionWidgetsAbove: Map<string, Widget>;
	extensionWidgetsBelow: Map<string, Widget>;
	autocompleteProviderWrappers: AutocompleteProviderFactory[];
};

beforeAll(() => initTheme("dark"));

afterEach(() => vi.restoreAllMocks());

describe("extension UI controller tab handover", () => {
	test("a hand-built host renders only the mounted tab's widgets and restores its completion and input hooks", async () => {
		const terminal = new VirtualTerminal(80, 24);
		const ui = new TuiMainScreen(terminal);
		const editor = new MixcodePromptEditor(ui, getEditorTheme(), new KeybindingsManager());
		const editorContainer = new Container();
		editorContainer.addChild(editor);
		const footer = { render: () => [], invalidate: () => {} };
		const statuses = new Map<string, string>();
		// Own data properties must follow controller collection replacement across tab switches.
		const host = {
			ui,
			editor,
			defaultEditor: editor,
			editorContainer,
			footer,
			footerContainer: new Container(),
			headerContainer: new Container(),
			builtInHeader: undefined,
			footerDataProvider: {
				getExtensionStatuses: () => statuses,
				clearExtensionStatuses: () => statuses.clear(),
				setExtensionStatus: (key: string, text: string) => statuses.set(key, text),
			},
			activeTabIdForUi: "tab-a",
			homeSelection: { active: false },
			extensionWidgetsAbove: new Map<string, Widget>(),
			extensionWidgetsBelow: new Map<string, Widget>(),
			autocompleteProviderWrappers: [] as AutocompleteProviderFactory[],
			shownTabId(this: ChromeHost) {
				return this.activeTabIdForUi;
			},
			disposeActiveSelector: () => {},
			requestWidgetRender: () => ui.requestRender(),
			applyTabWorkingState: () => {},
			refreshEditorStatus: () => {},
			createBaseAutocompleteProvider: (): AutocompleteProvider => new CombinedAutocompleteProvider([], "/tmp"),
		} as unknown as ChromeHost;
		for (const name of ["createExtensionUIContext", "detachTabUi", "attachTabUi", "setupAutocompleteProvider"]) {
			Reflect.set(host, name, Reflect.get(InteractiveMode.prototype, name));
		}
		const widgets: Component = {
			render: (width) =>
				[...host.extensionWidgetsAbove.values(), ...host.extensionWidgetsBelow.values()].flatMap((widget) =>
					widget.render(width),
				),
			invalidate: () => {},
		};
		ui.addChild(widgets);
		ui.addChild(editorContainer);
		ui.setFocus(editor);
		ui.start();
		try {
			const receivedA: string[] = [];
			const receivedB: string[] = [];
			const wrapA = vi.fn((provider: AutocompleteProvider) => provider);
			const wrapB = vi.fn((provider: AutocompleteProvider) => provider);
			const contextA = host.createExtensionUIContext("tab-a");
			contextA.setWidget("goal-a", ["WIDGET-A"]);
			contextA.addAutocompleteProvider(wrapA);
			contextA.onTerminalInput((data) => {
				receivedA.push(data);
				return { consume: true };
			});
			await terminal.waitForRender();
			expect(terminal.getViewport().map(stripAnsi).join("\n")).toContain("WIDGET-A");
			terminal.sendInput("a");

			host.detachTabUi("tab-a");
			host.activeTabIdForUi = "tab-b";
			host.attachTabUi("tab-b");
			const contextB = host.createExtensionUIContext("tab-b");
			contextB.setWidget("goal-b", ["WIDGET-B"]);
			contextB.addAutocompleteProvider(wrapB);
			contextB.onTerminalInput((data) => {
				receivedB.push(data);
				return { consume: true };
			});
			await terminal.waitForRender();
			const tabBFrame = terminal.getViewport().map(stripAnsi).join("\n");
			expect(tabBFrame).toContain("WIDGET-B");
			expect(tabBFrame).not.toContain("WIDGET-A");
			terminal.sendInput("b");
			expect(receivedA).toEqual(["a"]);
			expect(receivedB).toEqual(["b"]);
			wrapA.mockClear();
			wrapB.mockClear();

			host.detachTabUi("tab-b");
			host.activeTabIdForUi = "tab-a";
			host.attachTabUi("tab-a");
			await terminal.waitForRender();
			const tabAFrame = terminal.getViewport().map(stripAnsi).join("\n");
			expect(tabAFrame).toContain("WIDGET-A");
			expect(tabAFrame).not.toContain("WIDGET-B");
			terminal.sendInput("c");
			expect(receivedA).toEqual(["a", "c"]);
			expect(receivedB).toEqual(["b"]);
			expect(wrapA).toHaveBeenCalledOnce();
			expect(wrapB).not.toHaveBeenCalled();
		} finally {
			ui.stop();
		}
	});
});
