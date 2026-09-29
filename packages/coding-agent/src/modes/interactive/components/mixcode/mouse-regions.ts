/**
 * Mouse hit regions of a rendered block: the rows one component painted, so a
 * click or a hover reaches the component that owns that row instead of the block
 * that frames it.
 */
import {
	type Component,
	dispatchMouseEvent,
	type TuiMouseDispatchResult,
	type TuiMouseEvent,
} from "@earendil-works/pi-tui";

/** Rows one component owns inside the block that painted it. */
export interface MouseRegion {
	component: Component;
	/** First row of the region, in the painting block's own row space. */
	start: number;
	height: number;
}

/** The region covering `event.y`, or undefined when that row belongs to the block itself. */
export function regionAtRow(regions: readonly MouseRegion[], event: TuiMouseEvent): MouseRegion | undefined {
	const row = Math.floor(event.y);
	return regions.find((region) => row >= region.start && row < region.start + region.height);
}

/** Hand `event` to the region's component, rebased into that component's own row space. */
export function dispatchToRegion(region: MouseRegion, event: TuiMouseEvent): TuiMouseDispatchResult | undefined {
	return dispatchMouseEvent(region.component, {
		...event,
		y: Math.floor(event.y) - region.start,
		height: region.height,
	});
}
