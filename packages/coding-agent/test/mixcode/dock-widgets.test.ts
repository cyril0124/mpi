import { type Component, Container, Text, type TuiAltScreen, type TuiMouseEvent } from "@earendil-works/pi-tui";
import { beforeEach, describe, expect, it } from "vitest";
import { VirtualTerminal } from "../../../tui/test/virtual-terminal.ts";
import { createChatViewport } from "../../src/modes/interactive/chat-viewport.ts";
import { DockWidgetBudget } from "../../src/modes/interactive/components/mixcode/dock-widgets/dock-widgets.ts";
import { WindowedTranscript } from "../../src/modes/interactive/components/mixcode/windowed-chat/windowed-transcript.ts";
import { createInteractiveTui } from "../../src/modes/interactive/interactive-mode.ts";
import { initTheme } from "../../src/modes/interactive/theme/theme.ts";
import { stripAnsi } from "../../src/utils/ansi.ts";

/** Widget stand-in: a fixed number of rows plus a render counter. */
class Body implements Component {
	renders = 0;
	private readonly key: string;
	private readonly rows: number;

	constructor(key: string, rows: number) {
		this.key = key;
		this.rows = rows;
	}

	render(_width: number): string[] {
		this.renders += 1;
		return Array.from({ length: this.rows }, (_, index) => `${this.key}-row-${index}`);
	}

	invalidate(): void {}
}

class Clicks implements Component {
	clicks = 0;
	private readonly rows: number;

	constructor(rows: number) {
		this.rows = rows;
	}

	render(_width: number): string[] {
		return Array.from({ length: this.rows }, (_, index) => `click-${index}`);
	}

	invalidate(): void {}

	handleMouse(): { handled: boolean } {
		this.clicks += 1;
		return { handled: true };
	}
}

function mouse(y: number): TuiMouseEvent {
	return {
		type: "press",
		button: "left",
		x: 0,
		y,
		screenX: 0,
		screenY: y,
		width: 80,
		height: 10,
		shift: false,
		alt: false,
		ctrl: false,
	};
}

beforeEach(() => {
	initTheme("dark");
});

/** A budget over stand-in widgets. The budget is viewport - chrome - 3 - 6 rows. */
function makeBudget(options: {
	above?: Component[];
	below?: Component[];
	chrome?: number;
	viewport?: number | undefined;
	widgetsHidden?: boolean;
}) {
	const above = new Map((options.above ?? []).map((widget, index) => [`above-${index}`, widget]));
	const below = new Map((options.below ?? []).map((widget, index) => [`below-${index}`, widget]));
	const budget = new DockWidgetBudget({
		widgets: () => ({ above, below }),
		chromeRows: () => options.chrome ?? 3,
		viewportRows: () => options.viewport,
		widgetsHidden: () => options.widgetsHidden ?? false,
	});
	return budget;
}

describe("dock widget budget", () => {
	it("renders every row when the stack fits the budget", () => {
		const budget = makeBudget({ above: [new Body("a", 2)], below: [new Body("b", 3)], viewport: 24 });
		const above = budget.above.render(40).map(stripAnsi);
		const below = budget.below.render(40).map(stripAnsi);

		expect(above).toEqual(["", "a-row-0", "a-row-1"]);
		expect(below).toEqual(["b-row-0", "b-row-1", "b-row-2"]);
	});

	it("keeps above-editor rows first and marks the cut below them", () => {
		const budget = makeBudget({
			above: [new Body("a", 5)],
			below: [new Body("b", 10)],
			viewport: 24,
		});
		const above = budget.above.render(40).map(stripAnsi);
		const below = budget.below.render(40).map(stripAnsi);

		// Budget 11 = 10 content rows + the marker row, and the above rows go first.
		expect(above).toHaveLength(6);
		expect(above[0]).toBe("");
		expect(above[5]).toBe("a-row-4");
		expect(below).toEqual(["b-row-0", "b-row-1", "b-row-2", "b-row-3", "b-row-4", " … (widgets truncated)"]);
	});

	it("marks the cut in the above slot when there are no below rows", () => {
		const budget = makeBudget({ above: [new Body("a", 20)], viewport: 24 });
		const above = budget.above.render(40).map(stripAnsi);

		expect(above[0]).toBe("");
		expect(above[10]).toBe("a-row-9");
		expect(above[11]).toBe(" … (widgets truncated)");
		expect(budget.below.render(40)).toEqual([]);
	});

	it("drops every widget row when the budget is gone", () => {
		const budget = makeBudget({ above: [new Body("a", 4)], viewport: 12 });
		expect(budget.above.render(40).map(stripAnsi)).toEqual([""]);
		expect(budget.below.render(40)).toEqual([]);
	});

	it("leaves the widgets uncapped without a terminal size", () => {
		const budget = makeBudget({ above: [new Body("a", 30)], viewport: undefined });
		expect(budget.above.render(40)).toHaveLength(31);
	});

	it("renders nothing in either slot while the tab is in inline mode", () => {
		const budget = makeBudget({ above: [new Body("a", 2)], below: [new Body("b", 2)], widgetsHidden: true });
		expect(budget.above.render(40)).toEqual([]);
		expect(budget.below.render(40)).toEqual([]);
	});

	it("renders each widget once per frame, so an in-place update cannot go stale", () => {
		const widget = new Body("a", 2);
		const budget = makeBudget({ above: [widget], viewport: 24 });

		budget.above.render(40);
		expect(widget.renders).toBe(1);

		budget.above.render(40);
		expect(widget.renders).toBe(2);

		// A width change measures the widgets again, because wrapping follows the width.
		budget.above.render(30);
		expect(widget.renders).toBe(3);
	});

	it("forwards a click on a widget row and ignores the marker row", () => {
		const clickable = new Clicks(3);
		const budget = makeBudget({ above: [clickable], viewport: 24 });
		budget.above.render(40);

		// Row 0 is the slot's separating row, row 1 the widget's first row.
		expect(budget.above.handleMouse?.(mouse(0))).toBeUndefined();
		budget.above.handleMouse?.(mouse(1));
		expect(clickable.clicks).toBe(1);
	});

	it("forwards a click on a row of a half-shown widget, and none on the marker", () => {
		const clickable = new Clicks(20);
		const budget = makeBudget({ above: [clickable], viewport: 24 });
		const lines = budget.above.render(40).map(stripAnsi);

		// 10 kept widget rows, the marker, and the slot's separating row.
		expect(lines).toHaveLength(12);
		expect(lines[11]).toContain("widgets truncated");
		budget.above.handleMouse?.(mouse(10));
		expect(clickable.clicks).toBe(1);
		expect(budget.above.handleMouse?.(mouse(11))).toBeUndefined();
	});
});

describe("dock widget budget in a real frame", () => {
	it("keeps the chat, editor and footer on screen and marks the trimmed stack", async () => {
		const viewportRows = 24;
		const terminal = new VirtualTerminal(60, viewportRows);
		const tui = createInteractiveTui({
			tuiMode: "fullscreen",
			showHardwareCursor: false,
			logDirectory: "/tmp",
			terminal,
		}) as TuiAltScreen;

		const aboveWidget = new Body("tall", 14);
		const belowWidget = new Body("short", 6);
		const budget = new DockWidgetBudget({
			widgets: () => ({
				above: new Map([["tall", aboveWidget]]),
				below: new Map([["short", belowWidget]]),
			}),
			chromeRows: () => 4,
			viewportRows: () => terminal.rows,
			widgetsHidden: () => false,
		});
		const document = new WindowedTranscript({ blocks: () => [new Text("message", 0, 0)] });
		const viewport = createChatViewport({
			document,
			pendingMessages: new Container(),
			status: new Container(),
			widgetsAbove: budget.above,
			widgetsBelow: budget.below,
			editor: new Text("editor", 0, 0),
			footer: new Text("footer", 0, 0),
		});
		tui.setLayoutRoot(viewport.root);
		tui.start();
		await terminal.waitForRender();

		const lines = terminal.getViewport().map((line) => stripAnsi(line).trimEnd());
		const painted = lines.join("\n");
		expect(painted).toContain("… (widgets truncated)");
		expect(painted).toContain("editor");
		expect(painted).toContain("footer");
		// The budget's whole point: the chat keeps its minimum rows while the stack is trimmed.
		expect(viewport.transcript.viewportHeight).toBeGreaterThanOrEqual(6);
		// And the stack cannot exceed what the budget allows.
		expect(lines.indexOf("editor")).toBeGreaterThanOrEqual(6);
		// No row is wider than the terminal, marker included.
		for (const line of lines) expect(line.length).toBeLessThanOrEqual(60);
	});
});
