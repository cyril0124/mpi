import assert from "node:assert";
import { describe, it } from "node:test";
import { ScrollView, type ScrollViewScrollbar } from "../src/components/scroll-view.ts";
import { Text } from "../src/components/text.ts";
import { VStack } from "../src/components/v-stack.ts";
import {
	getScrollbarGeometry,
	materializeScrollLines,
	renderLayoutFrame,
	WINDOW_OVERSCAN_LINES,
} from "../src/layout.ts";
import { WINDOWED_NODE, type WindowedLayoutNode } from "../src/layout-node.ts";
import type { Component } from "../src/tui.ts";
import { TuiAltScreen } from "../src/tui-alt-screen.ts";
import { stripTerminalSequences } from "../src/utils.ts";
import { VirtualTerminal } from "./virtual-terminal.ts";

/** Windowed content stand-in: numbered rows served from a virtual total. */
class WindowedRows implements Component {
	private readonly rows: string[];
	/** Rows the virtual line count claims beyond the real ones (unmeasured estimate). */
	private readonly phantomRows: number;
	readonly requested: Array<{ start: number; end: number }> = [];
	fullRenders = 0;
	materializeCalls = 0;

	constructor(rowCount: number, options: { rows?: string[]; phantomRows?: number } = {}) {
		this.rows = options.rows ?? Array.from({ length: rowCount }, (_, index) => `row-${index}`);
		this.phantomRows = options.phantomRows ?? 0;
	}

	render(_width: number): string[] {
		this.fullRenders += 1;
		return this.rows;
	}

	invalidate(): void {}

	[WINDOWED_NODE](): WindowedLayoutNode {
		return {
			type: "windowed",
			state: {
				lineCount: () => this.rows.length + this.phantomRows,
				renderWindow: (_width, scrollTop, height, overscan) => {
					const start = Math.max(0, scrollTop - overscan);
					const end = Math.min(this.rows.length, scrollTop + height + overscan);
					this.requested.push({ start, end });
					return { lines: this.rows.slice(start, end), start, scrollTop, total: this.rows.length };
				},
				getLines: (_width, start, count) => this.rows.slice(start, start + count),
				materialize: () => {
					this.materializeCalls += 1;
					return [...this.rows];
				},
			},
		};
	}
}

function visible(lines: readonly string[]): string[] {
	return lines.map((line) => stripTerminalSequences(line).trimEnd());
}

function frameFor(content: Component, height: number, width = 20, scrollbar: ScrollViewScrollbar = "hidden") {
	const transcript = new ScrollView(content, { follow: "end", primary: true, scrollbar });
	const root = new VStack([
		{ component: transcript, basis: 0, grow: 1, shrink: 1, minSize: 1 },
		{ component: new Text("dock", 0, 0), basis: "auto", grow: 0, shrink: 0 },
	]);
	return { transcript, render: () => renderLayoutFrame(root, width, height, () => {}) };
}
describe("windowed scroll child", () => {
	it("paints only the viewport rows of the virtual content", () => {
		const content = new WindowedRows(500);
		const { transcript, render } = frameFor(content, 6);

		render();
		transcript.scrollToStart();
		const frame = render();

		assert.deepStrictEqual(visible(frame.lines).slice(0, 5), ["row-0", "row-1", "row-2", "row-3", "row-4"]);
		assert.strictEqual(content.fullRenders, 0, "the virtual content is never rendered whole");
	});

	it("asks for a bounded window plus overscan, not the whole document", () => {
		const content = new WindowedRows(5_000);
		const { transcript, render } = frameFor(content, 10);

		render();
		transcript.scrollToStart();
		render();
		const viewport = transcript.viewportHeight;
		const first = content.requested.at(-1);
		assert.strictEqual(first?.start, 0);
		assert.ok(
			(first?.end ?? 0) <= viewport + WINDOW_OVERSCAN_LINES * 2,
			`window was ${first?.end} rows for a ${viewport}-row viewport`,
		);

		transcript.scrollTo(2_500);
		render();
		const middle = content.requested.at(-1);
		assert.strictEqual(middle?.start, 2_500 - WINDOW_OVERSCAN_LINES);
		assert.strictEqual(middle?.end, 2_500 + viewport + WINDOW_OVERSCAN_LINES);
	});

	it("reports the virtual height so the scroll range and scrollbar span the document", () => {
		const content = new WindowedRows(500);
		const { transcript, render } = frameFor(content, 10, 20, "always");

		render();
		transcript.scrollToStart();
		const frame = render();
		const viewport = transcript.viewportHeight;
		const geometry = getScrollbarGeometry(frame.root.children[0]!, true);
		assert.strictEqual(geometry?.maxScrollTop, 500 - viewport);

		transcript.scrollToEnd();
		const bottom = visible(render().lines);
		assert.ok(bottom[0]?.startsWith(`row-${500 - viewport}`), `bottom row was ${bottom[0]}`);
		assert.ok(bottom[1]?.startsWith(`row-${501 - viewport}`), `second row was ${bottom[1]}`);
	});

	it("scrolls by lines and pages against the virtual range", () => {
		const content = new WindowedRows(200);
		const { transcript, render } = frameFor(content, 10);

		render();
		transcript.scrollToEnd();
		render();
		const viewport = transcript.viewportHeight;
		assert.strictEqual(transcript.scrollTop, 200 - viewport);
		const unused = transcript.scrollBy(5);
		assert.strictEqual(unused, 5, "scrolling past the end returns the unused delta");
		transcript.scrollBy(-4);
		assert.strictEqual(transcript.scrollTop, 200 - viewport - 4);
	});

	it("materializes the full document on demand for search and prompt jumps", () => {
		const content = new WindowedRows(300);
		const { transcript, render } = frameFor(content, 8);

		render();
		transcript.scrollToStart();
		const frame = render();
		const lines = materializeScrollLines(frame, transcript);
		assert.strictEqual(lines?.length, 300);
		assert.strictEqual(lines?.[299], "row-299");
	});
});

describe("plain scroll child", () => {
	it("keeps rendering the child in full and reports its real height", () => {
		const content = new Text(Array.from({ length: 40 }, (_, index) => `plain-${index}`).join("\n"), 0, 0);
		const { transcript, render } = frameFor(content, 5);

		render();
		transcript.scrollToStart();
		const frame = render();

		assert.deepStrictEqual(visible(frame.lines).slice(0, 3), ["plain-0", "plain-1", "plain-2"]);
		assert.strictEqual(materializeScrollLines(frame, transcript)?.length, 40);
	});
});

describe("windowed transcript and prompt jumps", () => {
	it("finds the previous prompt when the committed offset is past the real rows", async () => {
		// OSC 133 marks the prompt start; the virtual line count claims rows that do
		// not exist yet, so the committed offset sits past the materialized document.
		const rows = Array.from({ length: 300 }, (_, index) =>
			index === 120 ? "\x1b]133;A\x07prompt-120" : `row-${index}`,
		);
		const content = new WindowedRows(0, { rows, phantomRows: 200 });
		const transcript = new ScrollView(content, { follow: "end", primary: true });
		const root = new VStack([{ component: transcript, basis: 0, grow: 1, shrink: 1, minSize: 1 }]);
		const terminal = new VirtualTerminal(40, 12);
		const tui = new TuiAltScreen(terminal);
		tui.start();
		tui.setLayoutRoot(root);
		await terminal.waitForRender();

		// The layout aligns the scroll offset with the rows the window measured, and the
		// jump still finds the prompt rather than walking off the end of the document.
		assert.strictEqual(tui.scrollToPrompt(-1), true);
		assert.ok(transcript.scrollTop <= 120, `offset ${transcript.scrollTop} should be at or before the prompt`);
		tui.stop();
	});
});

describe("windowed transcript and the search overlay", () => {
	it("materializes once while the search overlay stays open", async () => {
		const content = new WindowedRows(400);
		const transcript = new ScrollView(content, { follow: "end", primary: true });
		const editor = {
			focused: false,
			render: () => ["editor"],
			invalidate: () => {},
			handleInput: () => {},
		};
		const terminal = new VirtualTerminal(60, 8);
		const tui = new TuiAltScreen(terminal);
		tui.setLayoutRoot(
			new VStack([
				{ component: transcript, basis: 0, grow: 1, minSize: 1 },
				{ component: editor, basis: 1, shrink: 0 },
			]),
		);
		tui.setFocus(editor);
		tui.start();
		await terminal.waitForRender();
		assert.strictEqual(content.materializeCalls, 0, "a plain frame never materializes");

		terminal.sendInput("\x1b[102;6u");
		terminal.sendInput("row");
		await terminal.waitForRender();
		const afterQuery = content.materializeCalls;
		assert.ok(afterQuery >= 1, "the opened search materializes the document");

		for (let frame = 0; frame < 3; frame += 1) {
			tui.requestRender();
			await terminal.waitForRender();
		}
		assert.strictEqual(content.materializeCalls, afterQuery, "unchanged content is reused, not re-rendered");
		tui.stop();
	});
});
