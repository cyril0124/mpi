import { ScrollView, VStack } from "@earendil-works/pi-tui";
import { describe, expect, it } from "vitest";
// The layout engine is internal to pi-tui; drive the container through the real
// scroll child path the fullscreen transcript uses.
import { renderLayoutFrame } from "../../../tui/src/layout.ts";
import type { Component, TuiMouseEvent, TuiMouseEventResult } from "../../../tui/src/tui.ts";
import { WindowedTranscript } from "../../src/modes/interactive/components/mixcode/windowed-chat/windowed-transcript.ts";

/** Message stand-in: a fixed number of rows, each naming its own content row. */
class Block implements Component {
	renders = 0;
	private readonly id: string;
	private readonly rowCount: number;

	constructor(id: string, rowCount: number) {
		this.id = id;
		this.rowCount = rowCount;
	}

	render(_width: number): string[] {
		this.renders += 1;
		return Array.from({ length: this.rowCount }, (_, index) => `${this.id}-${index}`);
	}

	invalidate(): void {}

	handleMouse(_event: TuiMouseEvent): TuiMouseEventResult | undefined {
		return undefined;
	}
}

/** Rows every test block renders; the content-row decoder below reads the same value. */
const BLOCK_ROWS = 30;

function makeBlocks(count: number, rows: number = BLOCK_ROWS): Block[] {
	return Array.from({ length: count }, (_, index) => new Block(`b${String(index).padStart(2, "0")}`, rows));
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

/** Global content row of the viewport's first line, decoded from the block line ids. */
function topContentRow(lines: readonly string[]): number {
	const match = lines[0]?.match(/^b(\d+)-(\d+)$/);
	if (!match) throw new Error(`unexpected top line: ${lines[0]}`);
	return Number(match[1]) * BLOCK_ROWS + Number(match[2]);
}

describe("windowed relative scroll anchoring", () => {
	it("moves exactly the requested rows while measuring estimated blocks (vim ctrl+u paging)", () => {
		// Far more content than one window, so paging up keeps walking into blocks that were
		// never measured and still carry the 4-row estimate.
		const blocks = makeBlocks(40, 30);
		const { render, scrollView } = viewport(blocks, 12);

		render();
		render();
		let previous = topContentRow(render());

		for (let press = 1; press <= 10; press += 1) {
			scrollView.scrollBy(-10);
			const current = topContentRow(render());
			expect(current, `press ${press} moved ${previous - current} rows`).toBe(previous - 10);
			previous = current;
		}
	});

	it("keeps the relative move exact after the height table resets", () => {
		// A surface swap (tab switch, Home) drops the measured heights; the transcript the
		// reader returns to estimates every never-measured block again.
		const blocks = makeBlocks(40, 30);
		const { transcript, render, scrollView } = viewport(blocks, 12);

		render();
		render();
		transcript.invalidate();
		render();
		let previous = topContentRow(render());

		for (let press = 1; press <= 10; press += 1) {
			scrollView.scrollBy(-10);
			const current = topContentRow(render());
			expect(current, `press ${press} moved ${previous - current} rows`).toBe(previous - 10);
			previous = current;
		}
	});

	it("still reaches the real top instead of the estimated one", () => {
		const blocks = makeBlocks(40, 30);
		const { render, scrollView } = viewport(blocks, 12);

		render();
		render();

		// 40 blocks x 30 rows: the real top is ~1190 rows above the end, far above the
		// estimate-based range (4 rows per unmeasured block). Paging must keep moving
		// exactly 10 rows per press until the real top, not pin at the estimated one.
		let previous = topContentRow(render());
		let presses = 0;
		while (previous > 0 && presses < 200) {
			scrollView.scrollBy(-10);
			const current = topContentRow(render());
			expect(current, `press ${presses + 1} moved ${previous - current} rows`).toBe(Math.max(0, previous - 10));
			previous = current;
			presses += 1;
		}
		expect(previous).toBe(0);
		expect(presses).toBeGreaterThanOrEqual(100);
	});

	it("clears the relative delta on an absolute jump", () => {
		const blocks = makeBlocks(40, 30);
		const { scrollView, render } = viewport(blocks, 12);

		render();
		render();

		// An absolute jump resolves in the table's own coordinates and must not carry a
		// pending relative delta into the next frame; the relative move after it is exact.
		scrollView.scrollBy(-10);
		scrollView.scrollTo(300);
		const jumped = topContentRow(render());
		scrollView.scrollBy(-10);
		expect(topContentRow(render())).toBe(jumped - 10);
	});

	it("keeps a standstill press at an end from moving the next press", () => {
		const blocks = makeBlocks(40, 30);
		const { render, scrollView } = viewport(blocks, 12);

		render();
		render();

		// Walk to the top, then press up twice more: nothing is left above, and the stale
		// no-op requests must not add up into the next real move.
		for (let press = 0; press < 200; press += 1) scrollView.scrollBy(-10);
		render();
		expect(topContentRow(render())).toBe(0);

		scrollView.scrollBy(-10);
		expect(topContentRow(render())).toBe(0);

		scrollView.scrollBy(10);
		expect(topContentRow(render())).toBe(10);
	});
});
