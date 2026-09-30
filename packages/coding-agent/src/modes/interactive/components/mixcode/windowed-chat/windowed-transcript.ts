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
	/** Block list the counters were last synced against. */
	private syncedBlocks = -1;
	private syncedFirst: Component | undefined;
	private syncedLast: Component | undefined;
	/** Rendered lines for the current pass, so one pass renders a block once. */
	private readonly passLines = new Map<Component, string[]>();
	/** Set when this pass measured a block, which moves the total and the window. */
	private measuredThisPass = false;

	constructor(options: WindowedTranscriptOptions) {
		super();
		this.blocksSource = options.blocks;
		this.estimatedBlockHeight = Math.max(1, Math.floor(options.estimatedBlockHeight ?? ESTIMATED_BLOCK_HEIGHT));
	}

	/** The live block list, read fresh so messages can be added and removed. */
	private blockList(): readonly Component[] {
		return this.blocksSource();
	}

	/** Forward invalidation to the blocks the container renders (its `children` stay empty). */
	override invalidate(): void {
		this.passLines.clear();
		this.measuredHeights = new WeakMap<Component, number>();
		this.measuredSum = 0;
		this.measuredCount = 0;
		this.syncedBlocks = -1;
		for (const block of this.blockList()) block.invalidate?.();
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
	 * estimated line count is only a scroll-range hint.
	 */
	materialize(width: number): string[] {
		const safeWidth = this.safeWidth(width);
		this.ensureWidth(safeWidth);
		this.passLines.clear();
		const lines: string[] = [];
		for (const block of this.blockList()) lines.push(...this.linesOf(block, safeWidth));
		return lines;
	}

	/**
	 * Content row of a block matching `matches`, at or after `from` (or the last one
	 * before it when `direction` is -1). Reads its rows from {@link matchingBlocks},
	 * so they are exact; the whole document is measured on the way.
	 */
	findBlockRow(from: number, direction: -1 | 1, matches: (block: Component) => boolean): number | undefined {
		const target = Math.max(0, Math.floor(from));
		let previous: number | undefined;
		for (const entry of this.matchingBlocks(matches)) {
			if (direction === 1) {
				if (entry.row >= target) return entry.row;
			} else if (entry.row < target) {
				previous = entry.row;
			}
		}
		return direction === -1 ? previous : undefined;
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
	): RenderedLineWindow {
		const safeWidth = this.safeWidth(width);
		const viewportHeight = Math.max(0, Math.floor(height));
		const margin = Math.max(0, Math.floor(overscan));
		this.ensureWidth(safeWidth);
		const top = Math.max(0, Math.floor(scrollTop));
		if (viewportHeight === 0) return { lines: [], start: top, scrollTop: top, total: this.totalHeight() };

		// A caller already at the end of the estimated content stays at the end once the
		// walk has measured it, so the newest rows are painted on this frame too. A caller that
		// asks to honor its offset keeps the window around that offset instead, even while the
		// estimate still looks like the content end.
		const atContentEnd = !honorOffset && top + viewportHeight >= this.totalHeight();
		this.measuredThisPass = false;
		let window = this.collectWindow(safeWidth, top, viewportHeight, margin, atContentEnd);
		// Each walk measures the blocks it paints, which moves the total and the row the
		// window ends at. Collect again while that keeps happening; the blocks are cached
		// for this pass, so a repeated collection renders nothing twice.
		for (let attempt = 0; attempt < WINDOW_RECOLLECT_ATTEMPTS && this.measuredThisPass; attempt += 1) {
			this.measuredThisPass = false;
			window = this.collectWindow(safeWidth, top, viewportHeight, margin, atContentEnd);
		}
		return window;
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
				renderWindow: (width, scrollTop, height, overscan, honorOffset) =>
					this.renderWindow(width, scrollTop, height, overscan, honorOffset),
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
		// Resync when the list changed outright: a different length, or a different first
		// or last block, which covers appends, removals and a wholesale replacement.
		if (
			blocks.length !== this.syncedBlocks ||
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
			this.syncedBlocks = blocks.length;
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
		this.measuredWidth = width;
		this.passLines.clear();
		this.measuredHeights = new WeakMap<Component, number>();
		this.measuredSum = 0;
		this.measuredCount = 0;
		this.syncedBlocks = -1;
	}
}

/** A component that can name the child painted at one of its own rows. */
interface RowRouting {
	componentAtRow(row: number): { component: Component; offset: number } | undefined;
}

function canRouteRows(component: Component): component is Component & RowRouting {
	return typeof (component as Partial<RowRouting>).componentAtRow === "function";
}
