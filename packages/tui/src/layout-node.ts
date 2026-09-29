import type { Component } from "./tui.ts";

export const LAYOUT_NODE = Symbol.for("@earendil-works/pi-tui/layout-node");

export interface LayoutViewport {
	width: number;
	height: number;
}

export interface StackLayoutEntry {
	component: Component;
	basis?: number | "auto";
	grow?: number;
	shrink?: number;
	minSize?: number;
	maxSize?: number;
	visible?: (viewport: LayoutViewport) => boolean;
}

export interface StackLayoutNode {
	type: "vstack" | "hstack";
	entries: readonly StackLayoutEntry[];
	gap: number;
	align: "stretch" | "start" | "center" | "end";
}

export interface ScrollLayoutState {
	readonly scrollTop: number;
	readonly primary: boolean;
	readonly overscroll: "chain" | "contain";
	readonly viewportHeight: number;
	getContentWidth(width: number): number;
	updateLayout(contentHeight: number, viewportHeight: number, requestRender: () => void): void;
}

export interface ScrollLayoutNode {
	type: "scroll";
	component: Component;
	state: ScrollLayoutState;
}

/**
 * A component that can render an arbitrary line window of its own content.
 *
 * A plain component is measured by rendering all of it; a windowed one reports a
 * virtual line count and renders only the rows a caller asks for. A scroll view
 * whose child is windowed therefore keeps a correct scroll range and scrollbar
 * without ever materializing the whole document.
 */
export interface WindowedLayoutState {
	/** Total line count for `width`, including content that was never rendered. */
	lineCount(width: number): number;
	/**
	 * Rows to paint for a `height`-row viewport scrolled to `scrollTop`, plus the
	 * content row the first returned line corresponds to. `overscan` rows are
	 * rendered above and below the viewport. The returned `start` may differ from
	 * `scrollTop - overscan` when the window is assembled from the end of the content,
	 * which happens when the caller is already at the end.
	 */
	renderWindow(width: number, scrollTop: number, height: number, overscan: number): RenderedLineWindow;
	/**
	 * Lines for an arbitrary range. The range is resolved against the same
	 * estimated heights as `lineCount`, so it is exact only for content that has
	 * been rendered; use `materialize` when every line is needed.
	 */
	getLines(width: number, start: number, count: number): string[];
	/** Every line, with every part rendered so the result is exact. */
	materialize(width: number): string[];
}

/** The rows, content offsets and total a windowed render returned for one request. */
export interface RenderedLineWindow {
	lines: string[];
	/** Content row the first returned line corresponds to. */
	start: number;
	/**
	 * Content row the caller's viewport top corresponds to, in the component's own
	 * measured row space. It differs from the requested offset when the requested
	 * position was at the end of the content and the collection measured it; callers
	 * paint and scroll against this value.
	 */
	scrollTop: number;
	/** Total content rows after the window's own measurements. */
	total: number;
}

export interface WindowedLayoutNode {
	type: "windowed";
	state: WindowedLayoutState;
}

/** Symbol a component implements to expose windowed content to the layout engine. */
export const WINDOWED_NODE = Symbol.for("@earendil-works/pi-tui/windowed-node");

/** A component that renders its content through `WindowedLayoutState`. */
export interface WindowedLayoutComponent extends Component {
	[WINDOWED_NODE](): WindowedLayoutNode;
}

export type LayoutNode = StackLayoutNode | ScrollLayoutNode | WindowedLayoutNode;

export interface LayoutComponent extends Component {
	[LAYOUT_NODE](): LayoutNode;
}

/**
 * Random-access view over a scroll view's content lines.
 *
 * Non-windowed scroll views answer from the lines the layout already rendered;
 * windowed ones render the requested range on demand.
 */
export interface ScrollLineProvider {
	lineCount(): number;
	getLines(start: number, count: number): string[];
	/** Every line, exact; present when the source can render content it has not measured. */
	materialize?(): string[];
}

export function getLayoutNode(component: Component): LayoutNode | undefined {
	const candidate = component as Partial<LayoutComponent>;
	return typeof candidate[LAYOUT_NODE] === "function" ? candidate[LAYOUT_NODE]() : undefined;
}

export function getWindowedNode(component: Component): WindowedLayoutNode | undefined {
	const candidate = component as Partial<WindowedLayoutComponent>;
	return typeof candidate[WINDOWED_NODE] === "function" ? candidate[WINDOWED_NODE]() : undefined;
}
