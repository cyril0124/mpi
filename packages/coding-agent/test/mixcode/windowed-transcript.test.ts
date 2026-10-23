import {
	Box,
	Container,
	ScrollView,
	type TuiMouseEvent,
	type TuiMouseEventResult,
	VStack,
} from "@earendil-works/pi-tui";
import { describe, expect, it } from "vitest";
// The layout engine is internal to pi-tui; drive the container through the real
// scroll child path the fullscreen transcript uses.
import { renderLayoutFrame } from "../../../tui/src/layout.ts";
import { materializeScrollLines } from "../../../tui/src/mixcode/layout-queries.ts";
import type { Component } from "../../../tui/src/tui.ts";
import { BlockHover, hasPointerCueAt } from "../../src/modes/interactive/components/mixcode/hover/hover-block.ts";
import { WindowedTranscript } from "../../src/modes/interactive/components/mixcode/windowed-chat/windowed-transcript.ts";

/** Message stand-in: a fixed number of rows, counted renders, stable identity. */
class Block implements Component {
	renders = 0;
	clicks = 0;
	private rowCount: number;
	private readonly id: string;

	constructor(id: string, rowCount: number) {
		this.id = id;
		this.rowCount = rowCount;
	}

	setRowCount(rowCount: number): void {
		this.rowCount = rowCount;
	}

	render(_width: number): string[] {
		this.renders += 1;
		return Array.from({ length: this.rowCount }, (_, index) => `${this.id}-${index}`);
	}

	invalidate(): void {}

	handleMouse(_event: TuiMouseEvent): TuiMouseEventResult | undefined {
		this.clicks += 1;
		return { handled: true };
	}
}

function makeBlocks(count: number, rows: number): Block[] {
	return Array.from({ length: count }, (_, index) => new Block(`b${index}`, rows));
}

function viewport(blocks: readonly Block[], height: number, estimate = 4) {
	const transcript = new WindowedTranscript({
		blocks: () => blocks,
		estimatedBlockHeight: estimate,
	});
	const scrollView = new ScrollView(transcript, { follow: "end", primary: true });
	const root = new VStack([
		{ component: scrollView, basis: 0, grow: 1, shrink: 1, minSize: 1 },
		{ component: new Block("dock", 1), basis: "auto", grow: 0, shrink: 0 },
	]);
	const frame = () => renderLayoutFrame(root, 24, height, () => {});
	return {
		transcript,
		scrollView,
		frame,
		render: () => frame().lines.map((line) => line.trimEnd()),
	};
}

describe("windowed transcript window", () => {
	it("renders only the blocks inside the viewport window", () => {
		const blocks = makeBlocks(200, 3);
		const { transcript, render } = viewport(blocks, 12);

		render();
		const rendered = blocks.filter((block) => block.renders > 0);

		expect(rendered.length).toBeLessThan(20);
		expect(blocks[0]?.renders).toBe(0);
		expect(blocks[199]?.renders).toBeGreaterThan(0);
		expect(transcript.lineCount(24)).toBeGreaterThan(12);
	});

	it("estimates unmeasured blocks so the scroll range spans the whole conversation", () => {
		const blocks = makeBlocks(100, 3);
		const { transcript } = viewport(blocks, 12);

		expect(transcript.lineCount(24)).toBe(400);

		// Measuring the tail replaces estimates with real heights for those blocks.
		transcript.renderWindow(24, 0, 12, 0);
		expect(transcript.lineCount(24)).toBeLessThan(400);
	});

	it("measures every block of a conversation that fits the window", () => {
		const blocks = makeBlocks(10, 3);
		const { transcript, render } = viewport(blocks, 40);
		render();
		expect(transcript.lineCount(24)).toBe(30);
		expect(blocks.every((block) => block.renders === 1)).toBe(true);
	});

	it("paints the newest rows on the first frame when real heights exceed the estimate", () => {
		// Ten-row blocks against the four-row estimate over a taller viewport than the
		// table below: the window must open on the tail, not at the first block.
		const blocks = makeBlocks(100, 10);
		const { render } = viewport(blocks, 30);

		const rows = render().filter((line) => /^b\d+-/.test(line));

		expect(rows.at(-1)).toBe("b99-9");
		expect(Number(/^b(\d+)-/.exec(rows[0]!)?.[1])).toBeGreaterThanOrEqual(95);
	});

	it("paints the newest row on the first frame for a tall, short and long conversation", () => {
		// Real heights (10 and 20 rows) far above the four-row estimate: every shape
		// must end on the newest row of the first frame, not after a few frames.
		for (const [count, rows, height] of [
			[3, 20, 30],
			[5, 10, 30],
			[200, 10, 30],
			[100, 10, 12],
		] as const) {
			const blocks = makeBlocks(count, rows);
			const painted = viewport(blocks, height, 4)
				.render()
				.filter((line) => /^b\d+-/.test(line));
			expect([count, rows, height, painted.at(-1)]).toEqual([count, rows, height, `b${count - 1}-${rows - 1}`]);
		}
	});

	it("does not move the visible rows when a tall block is appended while scrolled up", () => {
		const blocks = makeBlocks(40, 4);
		const { scrollView, render } = viewport(blocks, 20, 4);
		render();
		scrollView.scrollBy(-40);
		const before = render().filter((line) => /^b\d+-/.test(line));

		blocks.push(new Block("new-1", 20));
		const after = render().filter((line) => /^(new|b)\d*-?\d*/.test(line) && line.length > 0);

		expect(after.slice(0, before.length)).toEqual(before);
	});

	it("keeps one frame's work at the end independent of history length", () => {
		const small = makeBlocks(100, 4);
		const large = makeBlocks(5_000, 4);
		const smallView = viewport(small, 12);
		const largeView = viewport(large, 12);

		smallView.render();
		largeView.render();
		const smallRenders = small.reduce((sum, block) => sum + block.renders, 0);
		const largeRenders = large.reduce((sum, block) => sum + block.renders, 0);

		expect(largeRenders).toBeLessThanOrEqual(smallRenders + 2);
	});

	it("keeps the visible rows pinned when a block above the viewport is re-measured", () => {
		const blocks = makeBlocks(60, 5);
		const { scrollView, render } = viewport(blocks, 10, 4);

		render();
		scrollView.scrollTo(120);
		const first = render().filter((line) => line.length > 0)[0];

		// The second frame re-measures the window; rows above the viewport stay
		// estimates, so the content under the viewport top must not move.
		const second = render().filter((line) => line.length > 0)[0];
		expect(second).toBe(first);
	});

	it("keeps the running height when a tab switch replaces the middle of the block list", () => {
		// A tab switch swaps the conversation while the header and the widget block stay and the
		// list keeps its length, so only the identity of the list tells the new blocks from the old.
		const header = new Block("header", 3);
		const widget = new Block("widget", 1);
		let conversation = makeBlocks(60, 3);
		const transcript = new WindowedTranscript({ blocks: () => [header, ...conversation, widget] });
		const scrollView = new ScrollView(transcript, { follow: "end", primary: true });
		const root = new VStack([{ component: scrollView, basis: 0, grow: 1, shrink: 1, minSize: 1 }]);
		const painted = (): string[] =>
			renderLayoutFrame(root, 24, 12, () => {}).lines.filter((line) => line.trim() !== "");

		// Each switch measures the whole new conversation: the total must stay at the rows the
		// blocks really occupy, and the window must keep painting.
		for (let tab = 0; tab < 3; tab++) {
			conversation = makeBlocks(60, 3);
			transcript.materialize(24);
			expect([painted().length > 0, transcript.lineCount(24)]).toEqual([true, 184]);
		}
	});

	it("gives each tab back its own rows instead of the offset of the tab it replaced", () => {
		// Two tabs share one transcript container, the way a switch swaps the block list while
		// the scroll view keeps a single offset.
		const tabA = makeBlocks(120, 4);
		const tabB = makeBlocks(90, 4);
		let mounted: readonly Block[] = tabA;
		const transcript = new WindowedTranscript({ blocks: () => mounted });
		const scrollView = new ScrollView(transcript, { follow: "end", primary: true });
		const root = new VStack([{ component: scrollView, basis: 0, grow: 1, shrink: 1, minSize: 1 }]);
		const rows = (): string[] =>
			renderLayoutFrame(root, 24, 12, () => {})
				.lines.map((line) => line.trimEnd())
				.filter((line) => line !== "");

		// Tab A starts on its newest rows; the reader then pages up 160 rows.
		rows();
		scrollView.scrollBy(-160);
		const aRows = rows();
		const anchorA = transcript.scrollAnchorSnapshot();
		expect(aRows[0]).toBe("b77-0");
		expect(anchorA).toBeDefined();

		// Switching to a tab that is still at its end paints that tab's newest rows, not A's offset.
		mounted = tabB;
		transcript.restoreScrollAnchor(undefined);
		const bRows = rows();
		expect(bRows[0]).toBe("b87-0");
		expect(bRows.at(-1)).toBe("b89-3");

		// Coming back resumes the row A was left on.
		mounted = tabA;
		transcript.restoreScrollAnchor(anchorA);
		expect(rows().slice(0, aRows.length)).toEqual(aRows);
	});

	it("opens a rebuilt tab at its newest rows when its remembered block is gone", () => {
		let mounted: readonly Block[] = makeBlocks(120, 4);
		const transcript = new WindowedTranscript({ blocks: () => mounted });
		const scrollView = new ScrollView(transcript, { follow: "end", primary: true });
		const root = new VStack([{ component: scrollView, basis: 0, grow: 1, shrink: 1, minSize: 1 }]);
		const rows = (): string[] =>
			renderLayoutFrame(root, 24, 12, () => {})
				.lines.map((line) => line.trimEnd())
				.filter((line) => line !== "");

		rows();
		scrollView.scrollBy(-160);
		const anchor = transcript.scrollAnchorSnapshot();

		// A visited tab that streamed or reloaded in the background rebuilds its components, so
		// the remembered block has no rows on the surface that comes back.
		mounted = makeBlocks(120, 4);
		transcript.restoreScrollAnchor(anchor);
		const rebuilt = rows();
		expect(rebuilt[0]).toBe("b117-0");
		expect(rebuilt.at(-1)).toBe("b119-3");
	});

	it("places the window at the requested offset when it changes", () => {
		const blocks = makeBlocks(200, 4);
		const transcript = new WindowedTranscript({ blocks: () => blocks });

		const scrolled = transcript.renderWindow(24, 400, 11, 20);
		expect(scrolled.start).toBe(380);
		// A jump to another offset must render that offset, not the previous window.
		const jumped = transcript.renderWindow(24, 0, 11, 20);
		expect(jumped.start).toBe(0);
		expect(jumped.lines[0]).toBe("b0-0");
		// Re-requesting the same offset keeps the pinned block instead.
		expect(transcript.renderWindow(24, 0, 11, 20).start).toBe(0);
	});

	it("renders the requested rows after an absolute jump on a long, estimated chat", () => {
		const blocks = makeBlocks(200, 4);
		const { scrollView, render } = viewport(blocks, 12);

		render();
		scrollView.scrollBy(-40);
		render();
		scrollView.scrollToStart();
		const top = render().filter((line) => /^b\d+-/.test(line));

		expect(top[0]).toBe("b0-0");
		expect(top.length).toBeGreaterThan(0);
	});

	it("reports the window it actually rendered past the requested offset", () => {
		const blocks = makeBlocks(50, 4);
		const { render } = viewport(blocks, 8, 4);
		render();

		const lines = render().filter((line) => line.length > 0);
		expect(lines[0]).toMatch(/^b\d+-\d+$/);
		expect(lines.filter((line) => /^b\d+-/.test(line))).toHaveLength(7);
	});

	it("materializes every row exactly, past the estimated line count", () => {
		const blocks = makeBlocks(200, 10);
		const { transcript, scrollView, render, frame } = viewport(blocks, 12);

		// Follow the end once: only the tail blocks get measured, so lineCount is short.
		render();
		expect(transcript.lineCount(24)).toBeLessThan(2000);

		const document = transcript.materialize(24);
		expect(document).toHaveLength(2000);
		expect(document[0]).toBe("b0-0");
		expect(document.at(-1)).toBe("b199-9");
		expect(materializeScrollLines(frame(), scrollView)).toHaveLength(2000);
	});

	it("returns the whole document from render() for the regular renderer and exit output", () => {
		const blocks = makeBlocks(30, 2);
		const transcript = new WindowedTranscript({ blocks: () => blocks });

		const lines = transcript.render(24);

		expect(lines).toHaveLength(60);
		expect(lines[0]).toBe("b0-0");
		expect(lines.at(-1)).toBe("b29-1");
	});
});

describe("windowed transcript mouse routing", () => {
	it("dispatches a click to the block under the row, in that block's coordinates", () => {
		const blocks = makeBlocks(40, 3);
		const transcript = new WindowedTranscript({ blocks: () => blocks });
		transcript.lineCount(24);

		const seen: Array<{ y: number; height: number }> = [];
		// Every block is 4 estimated rows tall here, so content row 11 is row 3 of the
		// third block (rows 8..11).
		const third = blocks[2]!;
		third.handleMouse = (event) => {
			seen.push({ y: event.y, height: event.height });
			return { handled: true };
		};

		const result = transcript.handleMouse({ y: 11, width: 24 } as TuiMouseEvent);

		expect(result?.handled).toBe(true);
		expect(seen).toEqual([{ y: 3, height: 3 }]);
	});

	it("names the component chain of a row, with the row inside each component", () => {
		// The document child is a container, so a row resolves through it to the block inside.
		const card = new Block("card", 3);
		const message = new Container();
		message.addChild(card);
		const transcript = new WindowedTranscript({ blocks: () => [message] });
		// The row mapping reads the render that already happened: the block heights, and each
		// container's own child routing, come from it.
		transcript.render(24);

		expect(transcript.componentPathAtRow(0)).toEqual([
			{ component: message, row: 0 },
			{ component: card, row: 0 },
		]);
		expect(transcript.componentPathAtRow(2)).toEqual([
			{ component: message, row: 2 },
			{ component: card, row: 2 },
		]);
		expect(transcript.componentPathAtRow(3)).toEqual([]);
	});

	it("resolves a row to the card of the block that carries the pointer cue", () => {
		// The same question the mouse selection asks before it underlines a selected row.
		const card = new Block("card", 3);
		const message = new Container();
		message.addChild(card);
		const transcript = new WindowedTranscript({ blocks: () => [message] });
		transcript.render(24);
		// The block paints its gap on row 0 and its card below it.
		new BlockHover(card, () => undefined, 1);

		const cuedRow = (row: number) =>
			transcript.componentPathAtRow(row).some((entry) => hasPointerCueAt(entry.component, entry.row));

		expect(cuedRow(0)).toBe(false);
		expect(cuedRow(1)).toBe(true);
		expect(cuedRow(2)).toBe(true);
	});

	it("descends through a padded box to the card inside it", () => {
		// A block may wrap its card in a Box; the descent has to cross the box's padding rows.
		const card = new Block("card", 2);
		const box = new Box(1, 1);
		box.addChild(card);
		const message = new Container();
		message.addChild(box);
		const transcript = new WindowedTranscript({ blocks: () => [message] });
		transcript.render(24);
		new BlockHover(card, () => undefined, 1);

		const cuedRow = (row: number) =>
			transcript.componentPathAtRow(row).some((entry) => hasPointerCueAt(entry.component, entry.row));

		// The box pads one row above its child, so the box's row 1 is the child's row 0.
		expect(transcript.componentPathAtRow(1)).toEqual([
			{ component: message, row: 1 },
			{ component: box, row: 1 },
			{ component: card, row: 0 },
		]);
		expect(cuedRow(1)).toBe(false);
		expect(cuedRow(2)).toBe(true);
	});
});
