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
