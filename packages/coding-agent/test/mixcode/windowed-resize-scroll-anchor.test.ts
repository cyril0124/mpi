import { ScrollView, Text, VStack } from "@earendil-works/pi-tui";
import { describe, expect, it } from "vitest";
import { renderLayoutFrame } from "../../../tui/src/layout.ts";
import { stripTerminalSequences } from "../../../tui/src/utils.ts";
import { WindowedTranscript } from "../../src/modes/interactive/components/mixcode/windowed-chat/windowed-transcript.ts";

function visible(lines: readonly string[]): string[] {
	return lines.map((line) => stripTerminalSequences(line).trim());
}

function buildBlocks(): Text[] {
	return Array.from(
		{ length: 24 },
		(_, index) =>
			new Text(
				[
					`anchor-${index} opening line`,
					`message-${index} ${"long wrapping words ".repeat(12)}`,
					`message-${index} closing line`,
				].join("\n"),
				0,
				0,
			),
	);
}

/**
 * Blocks far taller than the 4-row estimate, so a dropped height table leaves the table far
 * shorter than the content. `b<block>-<row>` names the content row of every line.
 */
function buildTallBlocks(): Text[] {
	return Array.from(
		{ length: 40 },
		(_, index) => new Text(Array.from({ length: 30 }, (_, row) => `b${index}-${row}`).join("\n"), 0, 0),
	);
}

/** Index of the first line that names a content row. */
function firstBlockRow(lines: readonly string[]): number {
	return lines.findIndex((line) => /^b\d+-\d+$/.test(line));
}

describe("windowed transcript resize anchoring", () => {
	it("keeps the same message row after width reflow", () => {
		const blocks = buildBlocks();
		const transcript = new WindowedTranscript({ blocks: () => blocks });
		const scroll = new ScrollView(transcript, { follow: "end", primary: true });
		const root = new VStack([{ component: scroll, basis: 0, grow: 1, minSize: 1 }]);

		renderLayoutFrame(root, 80, 10, () => {});
		const target = transcript.matchingBlocks((block) => block === blocks[10])[0];
		expect(target).toBeDefined();
		scroll.scrollTo(target!.row);
		const before = visible(renderLayoutFrame(root, 80, 10, () => {}).lines);
		const anchorRow = before.findIndex((line) => line.includes("anchor-10 opening line"));
		expect(anchorRow).toBeGreaterThanOrEqual(0);

		const after = visible(renderLayoutFrame(root, 36, 10, () => {}).lines);
		expect(after[anchorRow]).toContain("anchor-10 opening line");
	});
});

describe("windowed transcript measurement-reset anchoring", () => {
	it("keeps the same message row when the height table is dropped", () => {
		const blocks = buildBlocks();
		const transcript = new WindowedTranscript({ blocks: () => blocks });
		const scroll = new ScrollView(transcript, { follow: "end", primary: true });
		const root = new VStack([{ component: scroll, basis: 0, grow: 1, minSize: 1 }]);

		renderLayoutFrame(root, 80, 10, () => {});
		const target = transcript.matchingBlocks((block) => block === blocks[10])[0];
		expect(target).toBeDefined();
		scroll.scrollTo(target!.row);
		const before = visible(renderLayoutFrame(root, 80, 10, () => {}).lines);
		const anchorRow = before.findIndex((line) => line.includes("anchor-10 opening line"));
		expect(anchorRow).toBeGreaterThanOrEqual(0);

		// A content change invalidates the container, which drops every measured height.
		transcript.invalidate();
		const after = visible(renderLayoutFrame(root, 80, 10, () => {}).lines);
		expect(after[anchorRow]).toContain("anchor-10 opening line");
	});
});

describe("windowed transcript repaint anchoring", () => {
	it("keeps the reader's row when a repaint measures blocks above it", () => {
		const blocks = buildTallBlocks();
		const transcript = new WindowedTranscript({ blocks: () => blocks });
		const scroll = new ScrollView(transcript, { follow: "end", primary: true });
		const root = new VStack([{ component: scroll, basis: 0, grow: 1, minSize: 1 }]);

		// Dropping the height table puts all 40 blocks of 30 rows back to the 4-row estimate, so
		// the table counts 160 rows over 1200 rows of content.
		renderLayoutFrame(root, 24, 12, () => {});
		transcript.resetMeasurements();
		renderLayoutFrame(root, 24, 12, () => {});
		// Vim's `k` walks the reader up into blocks nothing has measured yet.
		for (let press = 0; press < 5; press += 1) {
			scroll.scrollBy(-3);
			renderLayoutFrame(root, 24, 12, () => {});
		}
		const before = visible(renderLayoutFrame(root, 24, 12, () => {}).lines);
		const row = firstBlockRow(before);
		expect(row).toBeGreaterThanOrEqual(0);

		// The dock loses rows (a status line or a queued message), so the viewport grows and the
		// transcript repaints. That repaint measures the blocks its overscan covers; the rows
		// under the reader have to stay where they are.
		const after = visible(renderLayoutFrame(root, 24, 24, () => {}).lines);
		expect(after[row]).toBe(before[row]);
	});
});
