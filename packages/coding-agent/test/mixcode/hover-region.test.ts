import { Text, type TuiMouseEvent, type TuiMouseEventType } from "@earendil-works/pi-tui";
import { beforeEach, describe, expect, it } from "vitest";
import { HoverRegion } from "../../src/modes/interactive/components/mixcode/hover/hover-region.ts";
import { initTheme } from "../../src/modes/interactive/theme/theme.ts";
import { hoverBackgroundOpen } from "./test-utils.ts";

/**
 * The clickable region that paints itself while hovered: the cue follows passive
 * motion, a leave event from the dispatcher clears it, and the click handler the
 * region was built with is untouched.
 */

beforeEach(() => {
	initTheme("dark");
});

function mouse(type: TuiMouseEventType, x: number, y: number): TuiMouseEvent {
	return {
		type,
		button: type === "move" ? "none" : "left",
		x,
		y,
		screenX: x,
		screenY: y,
		width: 8,
		height: 1,
		shift: false,
		alt: false,
		ctrl: false,
	};
}

describe("hover region", () => {
	it("paints its rows while the pointer is inside and stops at the leave event", () => {
		const clicks: string[] = [];
		const region = new HoverRegion(new Text("row text", 0, 0), (event) => {
			if (event.type !== "click") return undefined;
			clicks.push(event.type);
			return { handled: true };
		});

		expect(region.render(8)[0]).not.toContain(hoverBackgroundOpen());
		expect(region.handleMouse(mouse("move", 3, 0))).toMatchObject({ handled: true, render: true });
		expect(region.render(8)[0]).toContain(hoverBackgroundOpen());

		// Moving inside the same region is still answered, but needs no repaint.
		expect(region.handleMouse(mouse("move", 4, 0))).toMatchObject({ handled: true, render: false });
		// The dispatcher sends a move outside every cell once the pointer leaves.
		expect(region.handleMouse(mouse("move", -1, -1))).toMatchObject({ handled: true, render: true });
		expect(region.render(8)[0]).not.toContain(hoverBackgroundOpen());
		expect(region.render(8)[0]).toBe("row text");

		// A click is still the region's own handler; a press or drag is not a hover.
		expect(region.handleMouse(mouse("click", 1, 0))).toMatchObject({ handled: true });
		expect(clicks).toEqual(["click"]);
		expect(region.handleMouse(mouse("press", 1, 0))).toBeUndefined();
		expect(region.render(8)[0]).not.toContain(hoverBackgroundOpen());
	});
});
