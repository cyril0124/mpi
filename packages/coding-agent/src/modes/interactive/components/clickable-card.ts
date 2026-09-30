import { Box, type TuiMouseEvent, type TuiMouseEventResult } from "@earendil-works/pi-tui";
import { BlockHover } from "./mixcode/hover/hover-block.ts";

/**
 * A message card whose whole surface toggles it between collapsed and expanded
 * on a primary click, with a pointer cue painted while hovered.
 */
export abstract class ClickableCard extends Box {
	private readonly hover = new BlockHover(this, (event) => this.handleCardClick(event));

	/** Toggle between the card's collapsed and expanded content. */
	protected abstract toggleExpanded(): void;

	override render(width: number): string[] {
		return this.hover.paint(super.render(width), width);
	}

	override handleMouse(event: TuiMouseEvent): ReturnType<Box["handleMouse"]> {
		return this.hover.dispatch(event);
	}

	private handleCardClick(event: TuiMouseEvent): TuiMouseEventResult | undefined {
		if (event.type !== "click" || event.button !== "left") return undefined;
		this.toggleExpanded();
		return { handled: true };
	}
}
