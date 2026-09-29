import type { TuiMouseEvent, TuiMouseEventType } from "@earendil-works/pi-tui";
import { beforeEach, describe, expect, it } from "vitest";
import { BlockHover } from "../../src/modes/interactive/components/mixcode/hover/hover-block.ts";
import { initTheme, theme } from "../../src/modes/interactive/theme/theme.ts";

/**
 * The hover owner for a message block: the whole block answers the pointer, a
 * click goes to the block's own action, and the cue fills every rendered row.
 */

beforeEach(() => {
	initTheme("dark");
});

function backgroundOpen(): string {
	const painted = theme.bg("selectedBg", "\u0001");
	const markerIndex = painted.indexOf("\u0001");
	return markerIndex > 0 ? painted.slice(0, markerIndex) : "";
}

function mouse(type: TuiMouseEventType, x: number, y: number, width = 10, height = 3): TuiMouseEvent {
	return {
		type,
		button: type === "move" ? "none" : "left",
		x,
		y,
		screenX: x,
		screenY: y,
		width,
		height,
		shift: false,
		alt: false,
		ctrl: false,
	};
}

describe("block hover", () => {
	it("answers moves inside the block and paints every row while hovered", () => {
		const clicks: string[] = [];
		const hover = new BlockHover((event) => {
			if (event.type !== "click") return undefined;
			clicks.push("click");
			return { handled: true };
		});

		expect(hover.paint(["a", "b", "c"], 4)).toEqual(["a", "b", "c"]);
		expect(hover.dispatch(mouse("move", 2, 1))).toMatchObject({ handled: true, render: true });
		expect(hover.active).toBe(true);
		// Moving inside the same block is still answered, without a repaint.
		expect(hover.dispatch(mouse("move", 3, 2))).toMatchObject({ handled: true, render: false });

		const painted = hover.paint(["a", "b", "c"], 4);
		expect(painted).toHaveLength(3);
		for (const line of painted) {
			expect(line).toContain(backgroundOpen());
			expect(line).not.toContain("\x1b[4m");
		}
		// A blank row of the block is filled, so the cue is one rectangle.
		expect(painted[1]!.replace(/\x1b\[[0-9;:]*m/g, "")).toBe("b   ");
	});

	it("hands a click to the block's own action and clears the cue on a leave event", () => {
		let expanded = false;
		const hover = new BlockHover((event) => {
			if (event.type !== "click" || event.button !== "left") return undefined;
			expanded = !expanded;
			return { handled: true };
		});

		hover.dispatch(mouse("move", 1, 1));
		expect(hover.dispatch(mouse("click", 1, 1))).toMatchObject({ handled: true });
		expect(expanded).toBe(true);

		// The dispatcher sends a move outside every cell once the pointer leaves.
		hover.dispatch(mouse("move", 1, 1));
		expect(hover.active).toBe(true);
		expect(hover.dispatch(mouse("move", -1, -1))).toMatchObject({ handled: true, render: true });
		expect(hover.active).toBe(false);
		expect(hover.paint(["a"], 4)).toEqual(["a"]);

		// A wheel or a drag is not a hover and never toggles.
		expect(hover.dispatch(mouse("wheel", 1, 1))).toBeUndefined();
		expect(hover.dispatch(mouse("press", 1, 1))).toBeUndefined();
		expect(expanded).toBe(true);
	});

	it("keeps the gap row above the card out of the cue and out of the click", () => {
		let clicks = 0;
		const hover = new BlockHover((event) => {
			if (event.type !== "click" || event.button !== "left") return undefined;
			clicks += 1;
			return { handled: true };
		}, 1);

		// The gap row answers no pointer, so nothing is cued and nothing toggles.
		expect(hover.dispatch(mouse("move", 2, 0))).toMatchObject({ handled: true, render: false });
		expect(hover.paint(["gap", "card"], 4)[0]).toBe("gap");
		expect(hover.dispatch(mouse("click", 2, 0))).toBeUndefined();
		expect(clicks).toBe(0);

		// The card below it is the target, and the cue fills its rows only.
		expect(hover.dispatch(mouse("move", 2, 1))).toMatchObject({ handled: true, render: true });
		const painted = hover.paint(["gap", "card"], 4);
		expect(painted[0]).toBe("gap");
		expect(painted[1]).toContain("\x1b[48;2;58;58;74m");
		expect(hover.dispatch(mouse("click", 2, 1))).toMatchObject({ handled: true });
		expect(clicks).toBe(1);
	});
});
