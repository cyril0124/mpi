import {
	type SettingItem,
	setKeybindings,
	stripTerminalSequences,
	TuiMainScreen,
	type TuiMouseEvent,
} from "@earendil-works/pi-tui";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { VirtualTerminal } from "../../../tui/test/virtual-terminal.ts";
import { getSettingsPath } from "../../src/config.ts";
import { KeybindingsManager } from "../../src/core/keybindings.ts";
import { mixcodeSettingsFilePath } from "../../src/core/mixcode/mixcode-settings.ts";
import { shortenPath } from "../../src/core/tools/render-utils.ts";
import {
	SETTINGS_PANEL_HEIGHT_PERCENT,
	SETTINGS_PANEL_WIDTH_PERCENT,
	SettingsPanel,
} from "../../src/modes/interactive/components/mixcode/settings/settings-panel.ts";
import {
	type SettingsCallbacks,
	type SettingsConfig,
	SettingsSelectorComponent,
} from "../../src/modes/interactive/components/settings-selector.ts";
import { InteractiveMode } from "../../src/modes/interactive/interactive-mode.ts";
import { initTheme } from "../../src/modes/interactive/theme/theme.ts";
import { overlayPanelLine } from "./test-utils.ts";

/**
 * `/settings` as the app shows it: the framed surface, the dim filter line, the
 * section headers that carry each settings file's path, the On/Off row values,
 * the key hints, and the centred overlay. The rows are the app's own items, so
 * these tests drive the real selector.
 */

/** The overlay the panel is shown with, built from the shares the app uses. */
const SETTINGS_OVERLAY = {
	anchor: "center",
	width: `${SETTINGS_PANEL_WIDTH_PERCENT}%`,
	maxHeight: `${SETTINGS_PANEL_HEIGHT_PERCENT}%`,
	margin: 1,
} as const;

/** Terminal height the panel measures while these tests run. */
const TERMINAL_ROWS = 24;

const originalStdoutRows = Object.getOwnPropertyDescriptor(process.stdout, "rows");

function setStdoutRows(rows: number): void {
	Object.defineProperty(process.stdout, "rows", { value: rows, configurable: true, writable: true });
}

beforeEach(() => {
	initTheme("dark");
	setKeybindings(new KeybindingsManager());
	// The panel reads its row budget from the terminal: pin it, or a run under a pty
	// with a taller window would show a different window of rows than these cases assert.
	setStdoutRows(TERMINAL_ROWS);
});

afterEach(() => {
	setKeybindings(new KeybindingsManager());
	if (originalStdoutRows) Object.defineProperty(process.stdout, "rows", originalStdoutRows);
	else delete (process.stdout as { rows?: number }).rows;
});

/** A config with the settings these tests read or change. */
function settingsConfig(overrides: Partial<SettingsConfig> = {}): SettingsConfig {
	return {
		autoCompact: true,
		defaultModel: "not set",
		availableDefaultModels: [],
		showImages: true,
		imageWidthCells: 60,
		autoResizeImages: true,
		blockImages: false,
		enableSkillCommands: true,
		steeringMode: "one-at-a-time",
		followUpMode: "all",
		transport: "auto",
		httpIdleTimeoutMs: 300_000,
		cacheWarmingMode: "off",
		thinkingLevel: "medium",
		availableThinkingLevels: [],
		modelThinkingLevels: {},
		currentTheme: "dark",
		terminalTheme: "dark",
		availableThemes: ["dark", "light"],
		hideThinkingBlock: true,
		mermaidRenderingMode: "off",
		showCacheMissNotices: true,
		collapseChangelog: false,
		enableInstallTelemetry: false,
		doubleEscapeAction: "tree",
		treeFilterMode: "default",
		showHardwareCursor: false,
		editorPaddingX: 0,
		outputPad: 0,
		autocompleteMaxVisible: 7,
		quietStartup: false,
		defaultProjectTrust: "ask",
		clearOnShrink: false,
		showTerminalProgress: true,
		tuiMode: "regular",
		fullscreenExitOutput: "transcript",
		fullscreenScrollbar: "auto",
		fullscreenCopyOnSelect: true,
		warnings: {},
		inlineWidgets: true,
		...overrides,
	} as SettingsConfig;
}

function plain(lines: string[]): string {
	return lines.map((line) => stripTerminalSequences(line)).join("\n");
}

/** Body rows of a rendered panel: the framed lines between the two borders. */
function bodyRows(lines: string[]): string[] {
	return plain(lines)
		.split("\n")
		.filter((line) => line.startsWith("│"))
		.map((line) => line.slice(1, -1));
}

/** The row the cursor marker sits on, without the frame. */
function selectedRow(lines: string[]): string {
	const row = bodyRows(lines).find((line) => line.includes("›"));
	if (row === undefined) throw new Error(`no selected row in:\n${plain(lines)}`);
	return row;
}

/** Pointer event in the panel's own coordinates, the way the renderer sends it. */
function pointer(type: TuiMouseEvent["type"], wheelDelta?: number): TuiMouseEvent {
	return {
		type,
		button: type === "wheel" ? "none" : "left",
		x: 4,
		y: 0,
		screenX: 4,
		screenY: 0,
		width: 80,
		height: 24,
		shift: false,
		alt: false,
		ctrl: false,
		wheelDelta,
	};
}

/** A list long enough to exercise the sections, the description block and the window. */
function syntheticItems(count: number): SettingItem[] {
	return Array.from({ length: count }, (_, index) => ({
		id: `item-${index}`,
		label: `Item ${index}`,
		description: index === 0 ? "A description that takes a row of its own." : undefined,
		currentValue: index % 2 === 0 ? "true" : "false",
		values: ["true", "false"],
	}));
}

describe("/settings panel", () => {
	it("frames the list, its filter line, both section paths and the key hints", () => {
		const list = new SettingsSelectorComponent(settingsConfig(), {} as SettingsCallbacks).getSettingsList();

		const lines = list.render(80);
		const text = plain(lines);
		const rows = text.split("\n");
		expect(rows[0]).toContain("┌");
		expect(rows[0]).toContain("Settings");
		expect(rows[rows.length - 1]!.startsWith("└")).toBe(true);
		expect(/filter: type to filter {2}\d+\/\d+/.test(text)).toBe(true);
		expect(text).toContain("  ↑↓ select  ⏎ edit/toggle  type to filter  esc close");
		// One header and one path row per settings file; each list is opened by a row
		// of its own section, since only one section fits the window at a time.
		expect(text).toContain("Pi");
		expect(text).toContain(shortenPath(getSettingsPath()));

		list.selectItem("inline-widgets");
		const mixcode = plain(list.render(80));
		expect(mixcode).toContain("MixCode");
		expect(mixcode).toContain(shortenPath(mixcodeSettingsFilePath()));
		// Every framed row is padded to the panel's inner width.
		const innerWidth = rows[0]!.length - 2;
		for (const row of bodyRows(lines)) expect(row.length).toBe(innerWidth);
	});

	it("marks the selected row with its cursor and keeps its description", () => {
		const list = new SettingsSelectorComponent(settingsConfig(), {} as SettingsCallbacks).getSettingsList();

		list.selectItem("steering-mode");
		const lines = list.render(80);
		expect(selectedRow(lines)).toContain("› Steering mode");
		expect(selectedRow(lines)).toContain("one-at-a-time");
		expect(plain(lines)).toContain("Enter while streaming queues steering messages");
	});

	it("shows booleans as On and Off", () => {
		const onInlineWidgetsChange = vi.fn();
		const list = new SettingsSelectorComponent(settingsConfig({ inlineWidgets: true }), {
			onInlineWidgetsChange,
		} as unknown as SettingsCallbacks).getSettingsList();

		list.selectItem("inline-widgets");
		expect(selectedRow(list.render(80))).toContain("On");

		list.handleInput("\r");
		expect(onInlineWidgetsChange.mock.calls.flat()).toEqual([false]);
		expect(selectedRow(list.render(80))).toContain("Off");

		list.handleInput("\r");
		expect(onInlineWidgetsChange.mock.calls.flat()).toEqual([false, true]);
		expect(selectedRow(list.render(80))).toContain("On");
	});

	it("types to filter, counts the matches, and clears the filter before closing", () => {
		let cancels = 0;
		const list = new SettingsSelectorComponent(settingsConfig(), {
			onCancel: () => cancels++,
		} as unknown as SettingsCallbacks).getSettingsList();

		const total = /(\d+)\/(\d+)/.exec(plain(list.render(80)))!;
		expect(total[1]).toBe(total[2]);

		for (const character of "mermaid") list.handleInput(character);
		const filtered = list.render(80);
		expect(plain(filtered)).toContain("filter: mermaid");
		expect(plain(filtered)).toContain(`1/${total[2]}`);
		expect(plain(filtered)).toContain("Mermaid diagrams");
		expect(plain(filtered)).not.toContain("Auto-compact");
		expect(selectedRow(filtered)).toContain("Mermaid diagrams");

		// Backspace edits the query, Esc clears it, and only an empty query closes.
		list.handleInput("\x7f");
		expect(plain(list.render(80))).toContain("filter: mermai");
		list.handleInput("\x1b");
		expect(cancels).toBe(0);
		expect(plain(list.render(80))).toContain("filter: type to filter");
		list.handleInput("\x1b");
		expect(cancels).toBe(1);
	});

	it("reports no matches and ignores Enter while nothing matches", () => {
		const list = new SettingsSelectorComponent(settingsConfig(), {} as SettingsCallbacks).getSettingsList();
		for (const character of "zzzz") list.handleInput(character);

		const text = plain(list.render(80));
		expect(text).toContain("No matching settings");
		expect(text).toContain("0/");
		list.handleInput("\r");
		expect(plain(list.render(80))).toContain("No matching settings");
	});

	it("windows a long list and keeps the selected row on screen", () => {
		const list = new SettingsSelectorComponent(settingsConfig(), {} as SettingsCallbacks).getSettingsList();

		const first = plain(list.render(80));
		expect(first).toContain("more below");
		expect(first).not.toContain("more above");

		list.selectItem("inline-widgets");
		const last = list.render(80);
		expect(plain(last)).toContain("more above");
		expect(selectedRow(last)).toContain("Inline widgets");
	});

	it("announces the section a window opened in the middle of", () => {
		const list = new SettingsSelectorComponent(settingsConfig(), {} as SettingsCallbacks).getSettingsList();

		// A row deep inside the Pi section still carries its file path at the top of the window.
		list.selectItem("steering-mode");
		const text = plain(list.render(80));
		expect(text).toContain("more above");
		expect(text).toContain("Pi");
		expect(text).toContain(shortenPath(getSettingsPath()));
	});

	it("drops decoration before the filter, the selected row and the hints", () => {
		// Terminal heights that leave a budget of 7, 8, 9 and 10 rows.
		for (const rows of [9, 10, 12, 13]) {
			setStdoutRows(rows);
			const panel = new SettingsPanel(syntheticItems(12), { onChange: () => {}, onCancel: () => {} });
			const lines = plain(panel.render(60)).split("\n");
			const text = lines.join("\n");
			const budget = Math.floor((rows * SETTINGS_PANEL_HEIGHT_PERCENT) / 100);

			expect(lines.length).toBeLessThanOrEqual(budget);
			expect(lines[0]).toContain("┌");
			expect(lines[lines.length - 1]!.startsWith("└")).toBe(true);
			expect(text).toContain("filter: type to filter");
			expect(text).toContain("› Item 0");
			expect(text).toContain("↑↓ select");
		}
	});

	it("keeps the hints when nothing matches on a short panel", () => {
		// Terminal heights that leave a budget of 6, 7 and 8 rows.
		for (const rows of [8, 9, 10]) {
			setStdoutRows(rows);
			const panel = new SettingsPanel(syntheticItems(3), { onChange: () => {}, onCancel: () => {} });
			panel.handleInput("z");
			const lines = plain(panel.render(60)).split("\n");
			const text = lines.join("\n");
			const budget = Math.floor((rows * SETTINGS_PANEL_HEIGHT_PERCENT) / 100);

			expect(lines.length).toBeLessThanOrEqual(budget);
			expect(text).toContain("No matching settings");
			expect(text).toContain("↑↓ select");
			expect(lines[lines.length - 1]!.startsWith("└")).toBe(true);
		}
	});

	it("re-measures the terminal on every frame", () => {
		setStdoutRows(24);
		const panel = new SettingsPanel(syntheticItems(40), { onChange: () => {}, onCancel: () => {} });
		const tall = panel.render(80).length;
		expect(tall).toBeLessThanOrEqual(Math.floor(24 * 0.8));

		// Shrinking the terminal re-fits the panel instead of letting the overlay clip it.
		setStdoutRows(12);
		const short = plain(panel.render(80)).split("\n");
		expect(short.length).toBeLessThan(tall);
		expect(short.length).toBeLessThanOrEqual(Math.floor(12 * 0.8));
		expect(short.join("\n")).toContain("↑↓ select");
		expect(short[short.length - 1]!.startsWith("└")).toBe(true);
	});

	it("falls back to the reported line count when the terminal has no height", () => {
		const originalLines = process.env.LINES;
		try {
			Object.defineProperty(process.stdout, "rows", { value: undefined, configurable: true, writable: true });
			process.env.LINES = "50";
			const panel = new SettingsPanel(syntheticItems(40), { onChange: () => {}, onCancel: () => {} });
			const lines = plain(panel.render(80)).split("\n");

			expect(lines.length).toBeLessThanOrEqual(Math.floor(50 * 0.8));
			expect(lines.length).toBeGreaterThan(Math.floor(TERMINAL_ROWS * 0.8) - 1);
			expect(lines.join("\n")).toContain("↑↓ select");
		} finally {
			if (originalLines === undefined) delete process.env.LINES;
			else process.env.LINES = originalLines;
		}
	});

	it("opens a submenu inside the same frame and returns to the list", () => {
		const list = new SettingsSelectorComponent(settingsConfig(), {} as SettingsCallbacks).getSettingsList();

		list.selectItem("theme");
		list.handleInput("\r");
		const submenu = list.render(80);
		expect(plain(submenu)).toContain("Settings");
		expect(plain(submenu)).toContain("Automatic");
		expect(plain(submenu)).not.toContain("filter: type to filter");

		list.handleInput("\x1b");
		expect(plain(list.render(80))).toContain("filter: type to filter");
		expect(selectedRow(list.render(80))).toContain("Theme");
	});

	it("moves the selection with the wheel and activates the row under the pointer", () => {
		const onInlineWidgetsChange = vi.fn();
		const list = new SettingsSelectorComponent(settingsConfig(), {
			onInlineWidgetsChange,
		} as unknown as SettingsCallbacks).getSettingsList();

		list.selectItem("autocompact");
		// Row text with the cursor marker blanked, so two renders can be compared.
		const unmarkedRows = (): string[] => bodyRows(list.render(80)).map((row) => row.replace("› ", "  ").trimEnd());
		const marked = (): string => unmarkedRows()[bodyRows(list.render(80)).findIndex((row) => row.includes("›"))]!;
		const before = unmarkedRows();
		const firstRow = marked();
		const secondRow = before[before.indexOf(firstRow) + 1];

		// The first row does not wrap around on a wheel up.
		expect(list.handleMouse({ ...pointer("wheel", -1), y: 5 })).toEqual({ handled: true, render: false });
		expect(marked()).toBe(firstRow);
		// A wheel down moves the selection by exactly one row.
		expect(list.handleMouse({ ...pointer("wheel", 1), y: 5 })).toEqual({ handled: true, render: true });
		expect(marked()).toBe(secondRow);

		// A press paints the row under the pointer; the click that follows activates it.
		list.selectItem("inline-widgets");
		const rowIndex = bodyRows(list.render(80)).findIndex((row) => row.includes("›"));
		// Body row 0 is the filter line, and the panel's y includes its top border.
		const y = rowIndex + 1;
		expect(list.handleMouse({ ...pointer("press"), y })).toEqual({ handled: true, focus: true });
		list.handleMouse({ ...pointer("click"), y });
		expect(onInlineWidgetsChange.mock.calls.flat()).toEqual([false]);
	});

	it("keeps a submenu's own list free of the filter line", () => {
		const list = new SettingsSelectorComponent(settingsConfig(), {} as SettingsCallbacks).getSettingsList();

		list.selectItem("theme");
		list.handleInput("\r");
		// The single-theme list preselects the configured theme; stepping up lands on Automatic.
		list.handleInput("\x1b[A");
		list.handleInput("\r");

		const text = plain(list.render(80));
		expect(text).toContain("Automatic Theme");
		expect(text).toContain("Light theme");
		expect(text).not.toContain("filter:");
		expect(text).toContain("⏎ edit/toggle  esc back");
	});

	it("shows a live update written through updateValue", () => {
		const list = new SettingsSelectorComponent(
			settingsConfig({ tuiMode: "regular" }),
			{} as SettingsCallbacks,
		).getSettingsList();

		list.selectItem("tui-mode");
		expect(selectedRow(list.render(80))).toContain("regular");
		list.updateValue("tui-mode", "fullscreen");
		expect(selectedRow(list.render(80))).toContain("fullscreen");
	});
});

describe("/settings overlay", () => {
	it("floats in the centre of the terminal and takes the keyboard", async () => {
		const terminal = new VirtualTerminal(80, 24);
		const ui = new TuiMainScreen(terminal);
		ui.start();
		try {
			const selector = new SettingsSelectorComponent(settingsConfig(), {
				onCancel: () => {},
			} as SettingsCallbacks);
			ui.showOverlay(selector.getSettingsList(), SETTINGS_OVERLAY);
			await terminal.waitForRender();

			const screenLines = terminal.getViewport().map((line) => stripTerminalSequences(line));
			// 78% of 80 columns, centred: the same share the command palette takes.
			expect(overlayPanelLine(screenLines, "┌")).toContain("Settings");
			expect(overlayPanelLine(screenLines, "┌").length).toBe(62);
			expect(overlayPanelLine(screenLines, "└").length).toBe(62);
			expect(screenLines.findIndex((line) => line.includes("┌"))).toBeGreaterThan(0);
			expect(screenLines.join("\n")).toContain("filter: type to filter");
			expect(screenLines.join("\n")).toContain("Auto-compact");

			for (const character of "mermaid") terminal.sendInput(character);
			await terminal.waitForRender();
			const screen = terminal
				.getViewport()
				.map((line) => stripTerminalSequences(line))
				.join("\n");
			expect(screen).toContain("Mermaid diagrams");
			expect(screen).not.toContain("Auto-compact");
		} finally {
			ui.stop();
		}
	});

	it("is shown with the app's own centred overlay options", () => {
		let overlayOptions: unknown;
		let shown: SettingsSelectorComponent | undefined;
		const context = Object.assign(Object.create(InteractiveMode.prototype), {
			ui: {
				showOverlay: (component: SettingsSelectorComponent, options: unknown) => {
					shown = component;
					overlayOptions = options;
					return {
						hide: () => {},
						setHidden: () => {},
						isHidden: () => false,
						focus: () => {},
						unfocus: () => {},
						isFocused: () => true,
					};
				},
				requestRender: () => {},
			},
		});
		const prototype = InteractiveMode.prototype as unknown as {
			showSettingsPanelOverlay(this: unknown, create: (done: () => void) => unknown): void;
		};
		prototype.showSettingsPanelOverlay.call(context, () => {
			shown = new SettingsSelectorComponent(settingsConfig(), { onCancel: () => {} } as SettingsCallbacks);
			return shown;
		});

		expect(overlayOptions).toEqual(SETTINGS_OVERLAY);
		expect(shown).toBeDefined();
		expect(plain(shown!.render(80))).toContain("Settings");
	});
});
