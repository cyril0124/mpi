/**
 * Windowed transcript container.
 *
 * Rendering every message component on every frame makes frame cost grow with
 * the whole conversation, because the layout clips a fully rendered document to
 * the viewport. This container reports a virtual line count and renders only the
 * rows the layout asks for, estimating rows for blocks it has never measured.
 *
 * Rows are addressed from the top of the transcript, and the window is assembled
 * backwards from the end of the content. That keeps the newest rows on screen even
 * when the blocks above the viewport are only estimated, and it keeps one frame's
 * work proportional to the window rather than to the conversation: the total is
 * maintained incrementally, and the walk stops once the window is filled.
 *
 * It renders as a plain `Container` when a caller asks for the whole document (the
 * `Component` contract); the layout uses the windowed protocol instead.
 */
import {
	type Component,
	Container,
	dispatchMouseEvent,
	type RenderedLineWindow,
	type TuiMouseDispatchResult,
	type TuiMouseEvent,
	WINDOWED_NODE,
	type WindowedLayoutNode,
} from "@earendil-works/pi-tui";

/** Rows assumed for a block that has not been rendered at the current width. */
export const ESTIMATED_BLOCK_HEIGHT = 4;

/** How many times a window is collected again while its own walk keeps measuring blocks. */
const WINDOW_RECOLLECT_ATTEMPTS = 2;

/** The block painted on a content row, with the row's offset inside that block. */
interface BlockAtRow {
	block: Component;
	offsetInBlock: number;
	height: number;
}

/**
 * The first visible row, pinned to a block rather than to a row number, so the same
 * spot can be found again after the prefix above it changed height. A tab switch keeps
 * these per tab; a reflow keeps one for the mounted surface.
 */
export interface ScrollAnchor {
	block: Component;
	rowInBlock: number;
	blockProgress: number;
	blockHeight: number;
	width: number;
}

export interface WindowedTranscriptOptions {
	/** Every block in paint order; read live so messages can be added and removed. */
	blocks: () => readonly Component[];
	/** Rows assumed for an unmeasured block. Defaults to `ESTIMATED_BLOCK_HEIGHT`. */
	estimatedBlockHeight?: number;
}

export class WindowedTranscript extends Container {
	private readonly blocksSource: () => readonly Component[];
	private readonly estimatedBlockHeight: number;
	/** Measured block height, valid for `measuredWidth`. Weak so transcript blocks
	 * swapped out by a tab switch are not kept alive by this table. */
	private measuredHeights = new WeakMap<Component, number>();
	private measuredWidth = -1;
	/** Measured heights currently in the table, maintained incrementally. */
	private measuredSum = 0;
	private measuredCount = 0;
	/** Block list the counters were last synced against, its length, and its edges. */
	private syncedList: readonly Component[] | undefined;
	private syncedLength = -1;
	private syncedFirst: Component | undefined;
	private syncedLast: Component | undefined;
	/** Rendered lines for the current pass, so one pass renders a block once. */
	private readonly passLines = new Map<Component, string[]>();
	/** Set when measuring the current pass changes the virtual total. */
	private measuredThisPass = false;
	/** The first visible row's stable block, retained across a width reflow or a height-table reset. */
	private scrollAnchor?: ScrollAnchor;
	/** Anchor captured before a width change or a dropped height table, waiting for the next frame. */
	private pendingAnchor?: ScrollAnchor;
	/** Anchor of the surface being mounted; unlike a reflow anchor it falls back to the newest rows. */
	private pendingScrollRestore: { readonly anchor: ScrollAnchor | undefined } | undefined;

	constructor(options: WindowedTranscriptOptions) {
		super();
		this.blocksSource = options.blocks;
		this.estimatedBlockHeight = Math.max(1, Math.floor(options.estimatedBlockHeight ?? ESTIMATED_BLOCK_HEIGHT));
	}

	/** The live block list, read fresh so messages can be added and removed. */
	private blockList(): readonly Component[] {
		return this.blocksSource();
	}

	/**
	 * Drop this container's measurements.
	 *
	 * The blocks are not invalidated: the layout invalidates this subtree on every
	 * relayout, and forwarding that to the blocks discarded their rendered lines even
	 * though the content had not changed, which made the first paint of a tab render
	 * its whole window from scratch. A memo that depends on the theme compares
	 * {@link getThemeGeneration} instead, so theme changes still miss on their own.
	 */
	override invalidate(): void {
		this.resetMeasurements();
	}

	/**
	 * Drop the height table without touching the blocks' own rendered lines.
	 *
	 * A surface swap (Home to a transcript, or one tab to another) changes which blocks
	 * are painted but not their content, so the table has to go while the blocks keep
	 * whatever they have already rendered: clearing their caches here is what made the
	 * first visit to a tab re-render its whole window from scratch.
	 */
	resetMeasurements(): void {
		// Every unmeasured block falls back to the estimate, so the total collapses and the scroll
		// view clamps the reader's offset towards the end. The remembered block is identity-based
		// and survives the dropped table, so hand it to the next frame the way a width change does.
		if (this.scrollAnchor) this.pendingAnchor = this.scrollAnchor;
		this.passLines.clear();
		this.measuredHeights = new WeakMap<Component, number>();
		this.measuredSum = 0;
		this.measuredCount = 0;
		this.syncedList = undefined;
		this.syncedLength = -1;
	}

	/** The block the first visible row sits on, or undefined while the content end is in view. */
	scrollAnchorSnapshot(): ScrollAnchor | undefined {
		return this.scrollAnchor;
	}

	/**
	 * Put the viewport back on a row remembered for the surface that is being painted now.
	 *
	 * A switch between tabs changes which blocks are on screen but not where the reader was
	 * in each of them, so the incoming tab resolves its own anchor on the next frame instead
	 * of keeping the outgoing tab's offset. An anchor this surface no longer paints, which is
	 * what a rebuilt transcript leaves behind, falls back to the newest rows rather than an
	 * unrelated row number.
	 */
	restoreScrollAnchor(anchor: ScrollAnchor | undefined): void {
		this.scrollAnchor = undefined;
		this.pendingScrollRestore = { anchor };
	}

	/**
	 * Mouse rows arrive in content coordinates (the layout places this component at
	 * its virtual content origin), so map the row back to the block under it and
	 * dispatch in that block's local coordinates.
	 */
	override handleMouse(event: TuiMouseEvent): TuiMouseDispatchResult | undefined {
		const width = this.safeWidth(event.width);
		this.ensureWidth(width);
		const hit = this.blockAtRow(width, Math.floor(event.y));
		if (!hit) return undefined;
		return dispatchMouseEvent(hit.block, { ...event, y: hit.offsetInBlock, height: hit.height });
	}

	/**
	 * Whole document. Nothing in the running app calls this: the layout uses the
	 * windowed protocol and the regular renderer mounts the plain document
	 * container. It exists because a window is still a `Component`.
	 */
	override render(width: number): string[] {
		const safeWidth = this.safeWidth(width);
		this.ensureWidth(safeWidth);
		this.passLines.clear();
		const lines: string[] = [];
		for (const block of this.blockList()) lines.push(...this.linesOf(block, safeWidth));
		return lines;
	}

	lineCount(width: number): number {
		const safeWidth = this.safeWidth(width);
		this.ensureWidth(safeWidth);
		// A line count starts a layout pass: drop the previous pass's rendered lines so
		// a streaming block re-renders, but keep measured heights as the estimate
		// table for blocks this pass does not touch.
		this.passLines.clear();
		return this.totalHeight();
	}

	/** Rows for an arbitrary content range, walking from the nearer end. */
	getLines(width: number, start: number, count: number): string[] {
		const safeWidth = this.safeWidth(width);
		this.ensureWidth(safeWidth);
		const from = Math.max(0, Math.floor(start));
		const wanted = Math.max(0, Math.floor(count));
		if (wanted === 0) return [];
		const total = this.totalHeight();
		const end = Math.min(total, from + wanted);
		if (end <= from) return [];
		if (this.nearerEnd(from, total) === "bottom") return this.collectBackward(safeWidth, end, end - from).lines;
		return this.collectForward(safeWidth, from, end - from);
	}

	/**
	 * Every line of the transcript, rendered so the result is exact. Search, prompt
	 * jumps and copy use this: they need the whole document, not one window, and the
	 * estimated line count is only a scroll-range hint. Same rows as {@link render},
	 * under the name the windowed protocol calls.
	 */
	materialize(width: number): string[] {
		return this.render(width);
	}

	/**
	 * The components painted at a content row, outermost first, each with the row inside it: the
	 * document child that owns the row, then the child chain within it, as of the last render. Resolves
	 * a content row the way a mouse event does, without dispatching to it, so a caller can ask what a
	 * row is made of and where in each component it sits. The chain ends at the first component that
	 * cannot name its own rows.
	 */
	componentPathAtRow(row: number): Array<{ component: Component; row: number }> {
		const width = this.measuredWidth;
		if (width <= 0) return [];
		const hit = this.blockAtRow(width, row);
		if (!hit) return [];
		let entry = { component: hit.block, row: hit.offsetInBlock };
		const path = [entry];
		while (canRouteRows(entry.component)) {
			const child = entry.component.componentAtRow(entry.row);
			if (!child) break;
			entry = { component: child.component, row: child.offset };
			path.push(entry);
		}
		return path;
	}

	/**
	 * Blocks matching `matches`, in paint order, with their exact top content row.
	 *
	 * The row comes from measuring every block on the way, not from the window's
	 * height table: that table only covers the blocks a frame has painted, and an
	 * estimate drifts from the rows the scroll view reports. One call measures the
	 * whole document, so use it for a one-off jump or a list of results, never for a
	 * frame; the measurement is cached, which keeps the next jump cheap.
	 */
	matchingBlocks<T extends Component>(matches: (block: Component) => block is T): Array<{ block: T; row: number }>;
	matchingBlocks(matches: (block: Component) => boolean): Array<{ block: Component; row: number }>;
	matchingBlocks(matches: (block: Component) => boolean): Array<{ block: Component; row: number }> {
		const width = this.measuredWidth;
		if (width <= 0) return [];
		this.ensureWidth(width);
		this.passLines.clear();
		const found: Array<{ block: Component; row: number }> = [];
		let offset = 0;
		for (const block of this.blockList()) {
			const height = this.linesOf(block, width).length;
			const blockRow = offset;
			offset += height;
			if (height <= 0 || !matches(block)) continue;
			found.push({ block, row: blockRow });
		}
		return found;
	}

	/**
	 * Rows for a `height`-row viewport scrolled to `scrollTop`, plus the content row
	 * the first returned line corresponds to.
	 *
	 * The window is assembled from whichever end of the content is closer, and always
	 * from the end when the caller is already at it. Following the end therefore paints
	 * the newest rows whatever the estimates above claim, and appending output cannot
	 * move the rows above it: only blocks inside the window are ever measured.
	 */
	renderWindow(
		width: number,
		scrollTop: number,
		height: number,
		overscan: number,
		honorOffset = false,
		relativeDelta?: number,
	): RenderedLineWindow {
		const safeWidth = this.safeWidth(width);
		const viewportHeight = Math.max(0, Math.floor(height));
		const margin = Math.max(0, Math.floor(overscan));
		this.ensureWidth(safeWidth);
		let top = Math.max(0, Math.floor(scrollTop));
		if (viewportHeight === 0) {
			this.pendingAnchor = undefined;
			return { lines: [], start: top, scrollTop: top, total: this.totalHeight() };
		}

		this.measuredThisPass = false;
		// A tab switch carries the incoming surface's remembered row; a width change carries the
		// mounted surface's own anchor. A remembered row this surface cannot paint any more falls
		// back to the newest rows, so the offset of the surface that was just unmounted never shows.
		const restoreAnchor = this.pendingScrollRestore ? this.pendingScrollRestore.anchor : this.pendingAnchor;
		const restoreFallsBackToEnd = this.pendingScrollRestore !== undefined;
		const placeAnchor = (): number | undefined => {
			const resolved = restoreAnchor
				? this.resolveScrollAnchor(safeWidth, viewportHeight, restoreAnchor)
				: undefined;
			if (resolved !== undefined) return resolved;
			if (restoreFallsBackToEnd) return Math.max(0, this.totalHeight() - viewportHeight);
			if (relativeDelta === undefined) return undefined;
			// A relative move resolves against content, not against the row number the caller
			// carried in: measuring an estimated block renumbers every row below it, so the
			// same offset points at different rows on the next pass. The anchor block keeps
			// the viewport's top row; without one the content end is what the reader looks at.
			// The rows the moved view will paint are measured up front, so the placement is
			// exact in one pass instead of chasing the renumbering a collection causes.
			this.measureRowsAboveAnchor(safeWidth, relativeDelta, viewportHeight, margin);
			const anchorRow = this.scrollAnchor
				? this.anchorRowUnderTable()
				: Math.max(0, this.totalHeight() - viewportHeight);
			if (anchorRow === undefined) return undefined;
			const max = Math.max(0, this.totalHeight() - viewportHeight);
			return Math.max(0, Math.min(max, anchorRow + relativeDelta));
		};
		const anchoredTop = placeAnchor();
		if (anchoredTop !== undefined) top = anchoredTop;
		const atContentEnd = !honorOffset && top + viewportHeight >= this.totalHeight();
		let window = this.collectWindow(safeWidth, top, viewportHeight, margin, atContentEnd);
		// Each walk measures the blocks it paints, which moves the total and the row the
		// window ends at. The anchor is recomputed after those measurements so a changed
		// prefix estimate cannot move the anchored block.
		for (let attempt = 0; attempt < WINDOW_RECOLLECT_ATTEMPTS && this.measuredThisPass; attempt += 1) {
			this.measuredThisPass = false;
			const nextTop = placeAnchor();
			if (nextTop !== undefined) top = nextTop;
			window = this.collectWindow(safeWidth, top, viewportHeight, margin, atContentEnd);
		}
		this.pendingAnchor = undefined;
		this.pendingScrollRestore = undefined;

		const total = this.totalHeight();
		const maxScrollTop = Math.max(0, total - viewportHeight);
		const effectiveScrollTop = atContentEnd ? maxScrollTop : Math.min(top, maxScrollTop);
		this.rememberScrollAnchor(safeWidth, effectiveScrollTop, viewportHeight, total);
		return {
			...window,
			scrollTop: Math.max(0, effectiveScrollTop),
			total,
		};
	}

	/**
	 * The scroll anchor's content row under the current height table, summing the
	 * table's heights without rendering anything. Measuring a block above the anchor
	 * moves this row, which is exactly what a relative scroll must compensate for.
	 */
	private anchorRowUnderTable(): number | undefined {
		const anchor = this.scrollAnchor;
		if (!anchor) return undefined;
		let offset = 0;
		for (const block of this.blockList()) {
			if (block === anchor.block) {
				const height = this.heightOf(block);
				return offset + Math.min(anchor.rowInBlock, Math.max(0, height - 1));
			}
			offset += this.heightOf(block);
		}
		return undefined;
	}

	/**
	 * Render the blocks the next `relativeDelta` move will paint, measuring them before
	 * the window is placed. An anchor anchors the walk at the viewport's top row; without
	 * one the reader is at the content end, whose whole moved view must be exact. The
	 * work is bounded by the move plus the overscan margin, not by the distance travelled.
	 */
	private measureRowsAboveAnchor(width: number, delta: number, viewportHeight: number, margin: number): void {
		const blocks = this.blockList();
		const anchor = this.scrollAnchor;
		let covered: number;
		let index: number;
		let needed: number;
		if (anchor) {
			const anchorIndex = blocks.lastIndexOf(anchor.block);
			if (anchorIndex < 0) return;
			covered = anchor.rowInBlock;
			index = anchorIndex - 1;
			needed = (delta < 0 ? -delta : 0) + margin;
		} else {
			covered = 0;
			index = blocks.length - 1;
			needed = viewportHeight + (delta < 0 ? -delta : 0) + margin;
		}
		for (; index >= 0 && covered < needed; index -= 1) {
			covered += this.linesOf(blocks[index]!, width).length;
		}
	}

	/** Recalculate the global row containing the remembered block after reflow. */
	private resolveScrollAnchor(width: number, viewportHeight: number, anchor: ScrollAnchor): number | undefined {
		const blocks = this.blockList();
		let rowsAfter = 0;
		for (let index = blocks.length - 1; index >= 0; index -= 1) {
			const block = blocks[index]!;
			const height = this.linesOf(block, width).length;
			if (block !== anchor.block) {
				rowsAfter += height;
				continue;
			}

			const preserveRow = anchor.width === width && height >= anchor.blockHeight;
			const lastRowInBlock = Math.max(0, height - 1);
			const candidateRow = preserveRow ? anchor.rowInBlock : Math.round(anchor.blockProgress * height);
			const rowInBlock = Math.min(lastRowInBlock, candidateRow);
			const total = this.totalHeight();
			const blockStart = total - rowsAfter - height;
			const maxScrollTop = Math.max(0, total - viewportHeight);
			return Math.max(0, Math.min(maxScrollTop, blockStart + rowInBlock));
		}
		return undefined;
	}

	/** Remember the top visible block while the user is away from the content end. */
	private rememberScrollAnchor(width: number, scrollTop: number, viewportHeight: number, total: number): void {
		if (viewportHeight <= 0 || scrollTop + viewportHeight >= total) {
			this.scrollAnchor = undefined;
			return;
		}
		const hit = this.blockAtRow(width, scrollTop);
		if (!hit || hit.height <= 0) {
			this.scrollAnchor = undefined;
			return;
		}
		this.scrollAnchor = {
			block: hit.block,
			rowInBlock: hit.offsetInBlock,
			blockProgress: hit.offsetInBlock / hit.height,
			blockHeight: hit.height,
			width,
		};
	}

	/** One window collection at the requested offset, using the current table. */
	private collectWindow(
		width: number,
		top: number,
		viewportHeight: number,
		margin: number,
		atContentEnd: boolean,
	): RenderedLineWindow {
		const total = this.totalHeight();
		const windowEnd = atContentEnd ? total : Math.min(total, top + viewportHeight + margin);
		const windowStart = Math.max(0, windowEnd - (viewportHeight + margin * 2));
		if (windowEnd <= windowStart) return { lines: [], start: windowStart, scrollTop: top, total };
		// A window that reaches the end of the content is always assembled from that
		// end, so the newest rows are painted whatever the estimates above claim. Any
		// other window is assembled from whichever end is closer, which keeps one
		// frame's cost at the window plus the shorter distance to an end.
		const window =
			windowEnd >= total || this.nearerEnd(windowStart, total) === "bottom"
				? this.collectBackward(width, windowEnd, windowEnd - windowStart)
				: { lines: this.collectForward(width, windowStart, windowEnd - windowStart), start: windowStart };
		// At the end of the content the viewport is its last rows; anywhere else the
		// requested offset is what the window was placed around.
		const maxScrollTop = Math.max(0, total - viewportHeight);
		const effectiveScrollTop = atContentEnd ? maxScrollTop : top;
		return {
			...window,
			scrollTop: Math.max(0, Math.min(effectiveScrollTop, maxScrollTop)),
			total: this.totalHeight(),
		};
	}

	[WINDOWED_NODE](): WindowedLayoutNode {
		return {
			type: "windowed",
			state: {
				lineCount: (width) => this.lineCount(width),
				renderWindow: (width, scrollTop, height, overscan, honorOffset, relativeDelta) =>
					this.renderWindow(width, scrollTop, height, overscan, honorOffset, relativeDelta),
				getLines: (width, start, count) => this.getLines(width, start, count),
				materialize: (width) => this.materialize(width),
			},
		};
	}

	/** Rows ending at `windowEnd`, walking backwards until `wanted` rows are filled. */
	private collectBackward(width: number, windowEnd: number, wanted: number): { lines: string[]; start: number } {
		const blocks = this.blockList();
		const total = this.totalHeight();
		const end = Math.max(0, Math.min(total, windowEnd));
		const windowStart = Math.max(0, end - wanted);
		const parts: string[][] = [];
		let rowsAfter = 0;
		for (let index = blocks.length - 1; index >= 0; index -= 1) {
			const block = blocks[index]!;
			const lines = this.linesOf(block, width);
			const height = lines.length;
			const blockStart = total - rowsAfter - height;
			rowsAfter += height;
			const from = Math.max(windowStart, blockStart);
			const to = Math.min(end, blockStart + height);
			if (to > from) parts.push(lines.slice(from - blockStart, to - blockStart));
			if (blockStart <= windowStart) break;
		}
		parts.reverse();
		return { lines: parts.flat(), start: windowStart };
	}

	/** Rows from `start` onward, walking forwards and stopping once `count` are filled. */
	private collectForward(width: number, start: number, count: number): string[] {
		const end = start + count;
		const lines: string[] = [];
		let offset = 0;
		for (const block of this.blockList()) {
			const estimatedHeight = this.heightOf(block);
			if (offset + estimatedHeight > start && offset < end) {
				const blockLines = this.linesOf(block, width);
				const from = Math.max(0, start - offset);
				const to = Math.min(blockLines.length, end - offset);
				for (let index = from; index < to; index++) lines.push(blockLines[index] ?? "");
			}
			offset += this.heightOf(block);
			if (offset >= end) break;
		}
		return lines;
	}

	/** The block painted on `row`, with the row's offset inside it. */
	private blockAtRow(width: number, row: number): BlockAtRow | undefined {
		const blocks = this.blockList();
		const total = this.totalHeight();
		if (row < 0 || row >= total) return undefined;
		if (this.nearerEnd(row, total) === "bottom") {
			let rowsAfter = 0;
			for (let index = blocks.length - 1; index >= 0; index -= 1) {
				const block = blocks[index]!;
				const estimated = this.heightOf(block);
				if (row >= total - rowsAfter - estimated) {
					const lines = this.linesOf(block, width);
					const start = total - rowsAfter - lines.length;
					return { block, offsetInBlock: Math.max(0, row - start), height: lines.length };
				}
				rowsAfter += estimated;
			}
			return undefined;
		}
		let offset = 0;
		for (const block of blocks) {
			const height = this.heightOf(block);
			if (row < offset + height) {
				return { block, offsetInBlock: row - offset, height: this.linesOf(block, width).length };
			}
			offset += height;
		}
		return undefined;
	}

	/** Total rows, maintained incrementally: measured heights plus the estimate for the rest. */
	private totalHeight(): number {
		const blocks = this.blockList();
		// Resync when the list changed. A replaced list is not always a different length with different
		// edges: a tab switch swaps the conversation in the middle while the header and the widget block
		// stay, so the identity of the list is what tells the new blocks from the old. Without it the
		// previous tab's counters stay in the table and the total counts two conversations at once.
		if (
			blocks !== this.syncedList ||
			blocks.length !== this.syncedLength ||
			blocks[0] !== this.syncedFirst ||
			blocks[blocks.length - 1] !== this.syncedLast
		) {
			let sum = 0;
			let count = 0;
			for (const block of blocks) {
				const height = this.measuredHeights.get(block);
				if (height === undefined) continue;
				sum += height;
				count += 1;
			}
			this.measuredSum = sum;
			this.measuredCount = count;
			this.syncedList = blocks;
			this.syncedLength = blocks.length;
			this.syncedFirst = blocks[0];
			this.syncedLast = blocks[blocks.length - 1];
		}
		return this.measuredSum + (blocks.length - this.measuredCount) * this.estimatedBlockHeight;
	}

	/** The measured height of a block, or the estimate while it has never been rendered. */
	private heightOf(block: Component): number {
		return this.measuredHeights.get(block) ?? this.estimatedBlockHeight;
	}

	/** This block's rendered lines, measured once per pass. */
	private linesOf(block: Component, width: number): string[] {
		const cached = this.passLines.get(block);
		if (cached) return cached;
		const lines = block.render(width);
		this.passLines.set(block, lines);
		this.recordHeight(block, lines.length);
		return lines;
	}

	/** Store a measured height and keep the running total in step. */
	private recordHeight(block: Component, height: number): void {
		const previous = this.measuredHeights.get(block);
		if (previous === height) return;
		this.measuredHeights.set(block, height);
		this.measuredThisPass = true;
		if (previous === undefined) {
			this.measuredSum += height;
			this.measuredCount += 1;
			return;
		}
		this.measuredSum += height - previous;
	}

	private safeWidth(width: number): number {
		return Math.max(1, Math.floor(width));
	}

	/** Which end of the content `row` is closer to; rows are addressed from the top. */
	private nearerEnd(row: number, total: number): "top" | "bottom" {
		return row * 2 >= total ? "bottom" : "top";
	}

	/** Measurements are only valid for one width, so a width change drops the table. */
	private ensureWidth(width: number): void {
		if (width === this.measuredWidth) return;
		if (this.measuredWidth >= 0 && this.scrollAnchor) {
			this.pendingAnchor = this.scrollAnchor;
		}
		this.measuredWidth = width;
		this.passLines.clear();
		this.measuredHeights = new WeakMap<Component, number>();
		this.measuredSum = 0;
		this.measuredCount = 0;
		this.syncedList = undefined;
		this.syncedLength = -1;
	}
}

/** A component that can name the child painted at one of its own rows. */
interface RowRouting {
	componentAtRow(row: number): { component: Component; offset: number } | undefined;
}

function canRouteRows(component: Component): component is Component & RowRouting {
	return typeof (component as Partial<RowRouting>).componentAtRow === "function";
}
