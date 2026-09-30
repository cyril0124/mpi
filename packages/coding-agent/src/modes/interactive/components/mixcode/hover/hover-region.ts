/**
 * A wrapper for a clickable sub-block that has no owner of its own to paint it: the
 * framework's `MouseRegion` carries the child and the click handler but no hover cue.
 * The child and the handler behave exactly as before, and the wrapper fills its whole
 * rendered rectangle while the pointer is over it.
 *
 * `onHoverChange` is for a child inside a block whose render is memoized: the wrapper
 * fires it when the cue flips so the block can drop the memo, since a pointer move
 * requests a render without invalidating.
 */
import {
	type Component,
	MouseRegion,
	type MouseRegionHandler,
	type TuiMouseDispatchResult,
	type TuiMouseEvent,
	type TuiMouseEventResult,
} from "@earendil-works/pi-tui";
import { BlockHover } from "./hover-block.ts";

export class HoverRegion extends MouseRegion {
	private readonly hover: BlockHover;

	constructor(child: Component, onMouse: MouseRegionHandler, onHoverChange?: () => void) {
		super(child, onMouse);
		this.hover = new BlockHover(this, undefined, 0, onHoverChange);
	}

	override render(width: number): string[] {
		return this.hover.paint(super.render(width), width);
	}

	override handleMouse(event: TuiMouseEvent): TuiMouseDispatchResult | TuiMouseEventResult | undefined {
		return super.handleMouse(event) ?? this.hover.dispatch(event);
	}
}
