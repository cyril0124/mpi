import { sliceByColumn, stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui";
import { beforeEach, describe, expect, it } from "vitest";
import {
	type HoverTarget,
	PointerHover,
	paintRowBackground,
} from "../../src/modes/interactive/components/mixcode/hover/pointer-hover.ts";
import { initTheme, theme } from "../../src/modes/interactive/theme/theme.ts";
import { hoverBackgroundOpen } from "./test-utils.ts";

/**
 * The hover primitive: what a hovered target paints, when a highlight survives a
 * new frame, and when a move counts as a transition that asks for a repaint.
 */

beforeEach(() => {
	initTheme("dark");
});

/** The visible text of a painted line. */
function plain(line: string): string {
	return stripTerminalSequences(line);
}

function target(overrides: Partial<HoverTarget> = {}): HoverTarget {
	return { id: "a", x: 1, y: 0, width: 2, ...overrides };
}

describe("hover paint", () => {
	it("paints only the target's cells, keeping the text and the line width", () => {
		const hover = new PointerHover();
		hover.layout([target()]);
		expect(hover.move(1, 0)).toBe(true);

		const lines = ["abcde", "second"];
		const painted = hover.paint(lines, 5);
		expect(painted[1]).toBe("second");
		expect(plain(painted[0]!)).toBe("abcde");
		expect(visibleWidth(painted[0]!)).toBe(5);
		// The underline marks the target's two cells and nothing else.
		const underlined = painted[0]!.indexOf("\x1b[4m");
		expect(painted[0]!.match(/\x1b\[4m/g)).toHaveLength(1);
		expect(plain(painted[0]!.slice(underlined))).toBe("bcde");
		expect(plain(painted[0]!.slice(0, underlined))).toBe("a");
		expect(hoverBackgroundOpen()).not.toBe("");
		expect(painted[0]!).toContain(hoverBackgroundOpen());
	});

	it("returns the same lines when nothing is hovered and skips rows that are not painted", () => {
		const hover = new PointerHover();
		hover.layout([target()]);
		const lines = ["abcde"];
		expect(hover.paint(lines, 5)).toBe(lines);

		hover.move(1, 0);
		expect(plain(hover.paint(lines, 5)[0]!)).toBe("abcde");
		// A target on rows that were never rendered paints nothing.
		hover.layout([target({ y: 9, height: 3 })]);
		expect(plain(hover.paint(lines, 5)[0]!)).toBe("abcde");
	});

	it("composes the cue over content that has its own background", () => {
		const hover = new PointerHover();
		hover.layout([target({ width: 3 })]);
		hover.move(1, 0);
		const chip = theme.bg("toolPendingBg", theme.fg("text", "abc"));
		const painted = hover.paint([chip], 3)[0]!;
		expect(plain(painted)).toBe("abc");
		// The hover background is re-opened after the chip's own background resets.
		expect(sliceByColumn(painted, 0, 3, true)).toContain(hoverBackgroundOpen());
	});

	it("cues a whole row, filled to the block width, and never an underline", () => {
		const marked = paintRowBackground(theme.fg("accent", "row"), 10);
		expect(plain(marked)).toBe("row       ");
		expect(visibleWidth(marked)).toBe(10);
		expect(marked).toContain(hoverBackgroundOpen());
		expect(marked).not.toContain("\x1b[4m");
		// A blank row of a card is a bar, not a hole in the cue.
		expect(plain(paintRowBackground("", 4))).toBe("    ");
	});
});

describe("hover lifecycle", () => {
	it("reports a move as a transition only when the hovered target changed", () => {
		const hover = new PointerHover();
		hover.layout([target({ id: "a" }), target({ id: "b", x: 4 })]);
		expect(hover.move(1, 0)).toBe(true);
		expect(hover.move(2, 0)).toBe(false);
		expect(hover.move(4, 0)).toBe(true);
		expect(hover.move(9, 0)).toBe(true);
		expect(hover.move(9, 0)).toBe(false);
		expect(hover.id).toBeUndefined();
	});

	it("cancels a highlight whose target moved instead of transferring it", () => {
		const hover = new PointerHover();
		hover.layout([target({ id: "a", x: 1 })], "frame-1");
		hover.move(1, 0);
		expect(hover.id).toBe("a");

		hover.layout([target({ id: "a", x: 2 })], "frame-1");
		expect(hover.id).toBeUndefined();

		hover.layout([target({ id: "a", x: 2 })], "frame-1");
		hover.move(2, 0);
		expect(hover.id).toBe("a");
		// Same id and rect, new revision: the highlight cannot be carried over.
		hover.layout([target({ id: "a", x: 2 })], "frame-2");
		expect(hover.id).toBeUndefined();
	});

	it("keeps a highlight across a layout that did not move it and drops it on reset", () => {
		const hover = new PointerHover();
		hover.layout([target({ id: "a" })], "frame-1");
		hover.move(1, 0);
		hover.layout([target({ id: "a" }), target({ id: "b", x: 4 })], "frame-1");
		expect(hover.id).toBe("a");
		hover.reset();
		expect(hover.id).toBeUndefined();
		expect(hover.move(1, 0)).toBe(false);
	});
});
