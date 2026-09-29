/**
 * A wrapper for a clickable sub-block that has no owner of its own to paint it: the
 * framework's `MouseRegion` carries the child and the click handler but no hover cue.
 * The child and the handler behave exactly as before, and the wrapper fills its whole
 * rendered rectangle while the pointer is over it.
 */
import {
	MouseRegion,
	type TuiMouseDispatchResult,
	type TuiMouseEvent,
	type TuiMouseEventResult,
} from "@earendil-works/pi-tui";
import { BlockHover } from "./hover-block.ts";

export class HoverRegion extends MouseRegion {
	private readonly hover = new BlockHover();

	override render(width: number): string[] {
		return this.hover.paint(super.render(width), width);
	}

	override handleMouse(event: TuiMouseEvent): TuiMouseDispatchResult | TuiMouseEventResult | undefined {
		return super.handleMouse(event) ?? this.hover.dispatch(event);
	}
}
