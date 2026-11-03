import { type Component, Text, type TuiAltScreen, visibleWidth } from "@earendil-works/pi-tui";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { VirtualTerminal } from "../../../tui/test/virtual-terminal.ts";
import { createChatViewport } from "../../src/modes/interactive/chat-viewport.ts";
import {
	createWidgetPanelTabState,
	WidgetPanelComponent,
	type WidgetPanelTabState,
} from "../../src/modes/interactive/components/mixcode/widget-panel/widget-panel.ts";
import { createInteractiveTui, InteractiveMode } from "../../src/modes/interactive/interactive-mode.ts";
import { initTheme } from "../../src/modes/interactive/theme/theme.ts";
import { stripAnsi } from "../../src/utils/ansi.ts";
import { WidgetBody } from "./test-utils.ts";

/** Tab id the panel wiring falls back to when there is no tab manager. */
const SESSION_KEY = "session";

type PanelWiringContext = {
	extensionWidgetsAbove: Map<string, Component>;
	extensionWidgetsBelow: Map<string, Component>;
	tabManager: undefined;
	activeTabIdForUi: string | undefined;
	widgetPanelTabStates: Map<string, WidgetPanelTabState>;
	homeSelection: { active: boolean };
	ui: {
		mode: string;
		hasOverlay: () => boolean;
		requestRender: () => void;
		terminal: { columns: number };
	};
	editor: { getText: () => string };
	editorText: () => string;
	editorAutocompleteOpen: () => boolean;
	notifyToast: (type: string, message: string) => void;
	widgetPanelState: () => WidgetPanelTabState | undefined;
	toggleWidgetPanel: () => void;
	handleWidgetPanelKey: () => boolean;
};
const proto = InteractiveMode.prototype as unknown as PanelWiringContext;

const activeTuis: TuiAltScreen[] = [];

beforeEach(() => {
	initTheme("dark");
});

afterEach(() => {
	for (const tui of activeTuis.splice(0)) tui.stop();
});

/**
 * A fullscreen frame built the way the running app builds it: the real chat
 * viewport with the panel wired beside the transcript, driven through the real
 * InteractiveMode wiring methods on a stub `this` that carries the live widget
 * maps and per-tab panel state.
 */
async function bootPanel(options: {
	columns?: number;
	rows?: number;
	above?: string[];
	below?: string[];
	open?: boolean;
	messages?: number;
}) {
	const columns = options.columns ?? 100;
	const rows = options.rows ?? 24;
	const above = new Map<string, Component>();
	const below = new Map<string, Component>();
	if (options.above) above.set("todos", WidgetBody.lines(options.above));
	if (options.below) below.set("fleet", WidgetBody.lines(options.below));

	const chatBlocks: Component[] = [];
	for (let index = 1; index <= (options.messages ?? 2); index += 1) {
		chatBlocks.push(new Text(`message-${index}`, 0, 0));
	}

	const terminal = new VirtualTerminal(columns, rows);
	const tui = createInteractiveTui({
		tuiMode: "fullscreen",
		showHardwareCursor: false,
		logDirectory: "/tmp",
		terminal,
	}) as TuiAltScreen;

	const state = createWidgetPanelTabState();
	state.open = options.open ?? false;
	const toasts: Array<{ type: string; message: string }> = [];
	const context = {} as PanelWiringContext;
	// Flipped off by the test that simulates an extension input owning the composer.
	let panelInteractive = true;
	const panelCopies: string[] = [];
	const widgetPanel = new WidgetPanelComponent({
		widgets: () => ({ above, below }),
		state: () => context.widgetPanelState(),
		terminalWidth: () => columns,
		viewportHeight: () => viewport?.transcript.viewportHeight ?? 0,
		interactive: () => panelInteractive,
		copySelection: (text) => panelCopies.push(text),
	});

	const blocks = [...chatBlocks];
	const document = { render: (width: number) => blocks.flatMap((block) => block.render(width)) } as Component;

	let viewport: ReturnType<typeof createChatViewport> | undefined;
	Object.assign(context, {
		extensionWidgetsAbove: above,
		extensionWidgetsBelow: below,
		tabManager: undefined,
		activeTabIdForUi: undefined,
		widgetPanelTabStates: new Map([[SESSION_KEY, state]]),
		homeSelection: { active: false },
		ui: {
			mode: "fullscreen",
			hasOverlay: () => false,
			requestRender: () => tui.requestRender(),
			terminal: { columns },
		},
		editor: { getText: () => "" },
		editorText: () => context.editor.getText(),
		editorAutocompleteOpen: () => false,
		notifyToast: (type: string, message: string) => toasts.push({ type, message }),
	} satisfies Partial<PanelWiringContext>);
	context.widgetPanelState = () => proto.widgetPanelState.call(context);
	context.toggleWidgetPanel = () => proto.toggleWidgetPanel.call(context);
	context.handleWidgetPanelKey = () => proto.handleWidgetPanelKey.call(context);

	viewport = createChatViewport({
		document,
		pendingMessages: new Text("queue", 0, 0),
		status: new Text("status", 0, 0),
		widgetsAbove: undefined,
		editor: new Text("editor", 0, 0),
		widgetsBelow: undefined,
		footer: new Text("footer", 0, 0),
		panel: { component: widgetPanel, visible: (width) => widgetPanel.isOpen(width) },
	});
	tui.setLayoutRoot(viewport.root);
	activeTuis.push(tui);
	tui.start();
	await terminal.waitForRender();

	const painted = async (): Promise<string[]> => {
		tui.requestRender();
		await terminal.waitForRender();
		return terminal.getViewport().map((line) => stripAnsi(line).trimEnd());
	};
	return {
		state,
		toasts,
		terminal,
		tui,
		transcript: viewport.transcript,
		widgetPanel,
		setPanelInteractive: (value: boolean) => {
			panelInteractive = value;
		},
		panelCopies,
		toggle: () => context.toggleWidgetPanel(),
		handleKey: () => context.handleWidgetPanelKey(),
		painted,
	};
}

describe("widget side panel", () => {
	it("splits chat left / panel right with title, sections, and close hint", async () => {
		const frame = await bootPanel({ above: ["todos-line"], below: ["fleet-line"], open: true });
		const lines = await frame.painted();

		const title = lines.findIndex((line) => line.includes("Widgets"));
		const todosHeader = lines.findIndex((line) => /─ todos ─/.test(line));
		const fleetHeader = lines.findIndex((line) => /─ fleet ─/.test(line));
		const hint = lines.findIndex((line) => line.includes("→ to close"));
		expect(title).toBeGreaterThanOrEqual(0);
		expect(hint).toBeGreaterThan(title);
		expect(todosHeader).toBeGreaterThan(title);
		expect(fleetHeader).toBeGreaterThan(todosHeader);

		// True side-by-side: the panel column starts well right of the chat text,
		// and a chat row shares its output row with the panel column.
		const panelLeft = (lines[todosHeader] ?? "").indexOf("─");
		expect(panelLeft).toBeGreaterThan(50);
		const sideBySide = lines.some((line) => line.includes("message-") && line.includes("│"));
		expect(sideBySide).toBe(true);
		// Every painted row fits the terminal.
		for (const line of terminalLines(frame)) expect(visibleWidth(line)).toBeLessThanOrEqual(100);
	});

	it("Right on the empty composer toggles the panel open and closed", async () => {
		const frame = await bootPanel({ above: ["todos-line"] });
		expect(frame.state.open).toBe(false);

		expect(frame.handleKey()).toBe(true);
		expect(frame.state.open).toBe(true);
		expect((await frame.painted()).some((line) => line.includes("todos-line"))).toBe(true);

		expect(frame.handleKey()).toBe(true);
		expect(frame.state.open).toBe(false);
		expect((await frame.painted()).some((line) => line.includes("→ to close"))).toBe(false);
	});

	it("accepts the toggle on the empty composer, then closes again", async () => {
		const frame = await bootPanel({ above: ["todos-line"] });
		expect(frame.handleKey()).toBe(true);
		expect(frame.state.open).toBe(true);
		expect(frame.handleKey()).toBe(true);
		expect(frame.state.open).toBe(false);
	});

	it("refuses to open without widgets and below the width threshold, saying why", async () => {
		const empty = await bootPanel({ above: undefined, below: undefined });
		empty.toggle();
		expect(empty.state.open).toBe(false);
		expect(empty.toasts).toEqual([{ type: "info", message: "No extension widgets to show." }]);

		const narrow = await bootPanel({ above: ["todos-line"], columns: 60 });
		narrow.toggle();
		expect(narrow.state.open).toBe(false);
		expect(narrow.toasts[0]?.type).toBe("warning");
		expect(narrow.toasts[0]?.message).toContain("Terminal too narrow");
	});

	it("hides the split below the minimum width even while open", async () => {
		const frame = await bootPanel({ above: ["todos-line"], columns: 60, open: true });
		const lines = await frame.painted();
		expect(lines.some((line) => line.includes("→ to close"))).toBe(false);
		// No line overflows the narrow terminal.
		for (const line of terminalLines(frame)) expect(visibleWidth(line)).toBeLessThanOrEqual(60);
	});

	it("windows tall content at a clamped offset with edge markers and a pinned title", async () => {
		const tall = Array.from({ length: 30 }, (_, index) => `panel-item-${index + 1}`);
		const frame = await bootPanel({ above: tall, open: true });
		const top = await frame.painted();
		expect(top.some((line) => line.includes("panel-item-1"))).toBe(true);
		expect(top.some((line) => line.includes("↓ more"))).toBe(true);
		expect(top.some((line) => line.includes("↑ more"))).toBe(false);

		frame.state.scrollOffset = 5;
		const mid = await frame.painted();
		expect(mid[0]).toContain("Widgets");
		expect(mid.some((line) => line.includes("↑ more"))).toBe(true);

		frame.state.scrollOffset = 9999;
		await frame.painted();
		expect(frame.state.scrollOffset).toBeLessThan(9999);
		const end = await frame.painted();
		expect(end.some((line) => line.includes("panel-item-30"))).toBe(true);
		expect(end.some((line) => line.includes("↓ more"))).toBe(false);
	});

	it("wraps wide widget lines instead of truncating them", async () => {
		const longLine = "This is a very long widget line that clearly exceeds the panel body width and should wrap";
		const frame = await bootPanel({ above: [longLine], open: true });
		const lines = await frame.painted();
		const text = lines.join("\n");
		expect(text).toContain("should wrap");
		expect(text).not.toContain("...");
	});

	it("routes wheel over the panel to the panel and over chat to chat", async () => {
		const tall = Array.from({ length: 40 }, (_, index) => `panel-item-${index + 1}`);
		const frame = await bootPanel({ above: tall, open: true, messages: 30 });
		await frame.painted();

		// Panel occupies the rightmost widgetPanelWidth(100)=33 columns; a point
		// inside it (column 90, row 5) must scroll the panel only.
		const chatBefore = frame.transcript.scrollTop;
		frame.terminal.sendInput("\x1b[<65;90;5M");
		await frame.painted();
		expect(frame.state.scrollOffset).toBeGreaterThan(0);
		expect(frame.transcript.scrollTop).toBe(chatBefore);

		// A point over the chat column scrolls the transcript, not the panel;
		// the transcript follows the end, so wheel up is the movable direction.
		const panelBefore = frame.state.scrollOffset;
		frame.terminal.sendInput("\x1b[<64;5;5M");
		await frame.painted();
		expect(frame.state.scrollOffset).toBe(panelBefore);
		expect(frame.transcript.scrollTop).toBeLessThan(chatBefore);
	});

	it("hands the wheel back to chat while an extension input owns the composer", async () => {
		const tall = Array.from({ length: 40 }, (_, index) => `panel-item-${index + 1}`);
		const frame = await bootPanel({ above: tall, open: true, messages: 30 });
		await frame.painted();

		frame.setPanelInteractive(false);
		const chatBefore = frame.transcript.scrollTop;
		frame.terminal.sendInput("\x1b[<64;90;5M");
		await frame.painted();
		expect(frame.state.scrollOffset).toBe(0);
		expect(frame.transcript.scrollTop).toBeLessThan(chatBefore);
	});

	it("selects panel rows with a drag and copies only panel text", async () => {
		const frame = await bootPanel({ above: ["todos-selectable-line"], open: true });
		const lines = await frame.painted();
		const row = lines.findIndex((line) => line.includes("todos-selectable-line"));
		expect(row).toBeGreaterThanOrEqual(0);
		const panelRow = lines[row] ?? "";
		const startCol = panelRow.indexOf("todos-selectable-line") + 1;
		const endCol = startCol + "todos-selectable-line".length - 1;

		// Press on the panel, drag left past the panel's edge into the chat
		// columns, release on the same row: the captured press clamps the
		// selection to the panel body instead of leaking across the split.
		frame.terminal.sendInput(`\x1b[<0;${endCol};${row + 1}M`);
		frame.terminal.sendInput(`\x1b[<32;1;${row + 1}M`);
		frame.terminal.sendInput(`\x1b[<0;1;${row + 1}m`);
		await new Promise((resolve) => setTimeout(resolve, 50));

		expect(frame.panelCopies.length).toBe(1);
		expect(frame.panelCopies[0]).toBe("todos-selectable-line");
	});
});

function terminalLines(frame: Awaited<ReturnType<typeof bootPanel>>): string[] {
	return frame.terminal.getViewport();
}
