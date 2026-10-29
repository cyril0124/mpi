import { LAYOUT_NODE, type ScrollLayoutNode } from "../layout-node.ts";
import { type Component, Container } from "../tui.ts";

export type ScrollViewScrollbar = "hidden" | "auto" | "always";

export interface ScrollViewOptions {
	axis?: "vertical";
	follow?: "none" | "end";
	primary?: boolean;
	overscroll?: "chain" | "contain";
	scrollbar?: ScrollViewScrollbar;
	scrollbarTrackStyle?: (text: string) => string;
	scrollbarThumbStyle?: (text: string) => string;
	scrollbarHideDelayMs?: number;
}

export interface ScrollViewScrollToOptions {
	/** Keep follow-end disabled even when the target is the current content end. */
	disableFollow?: boolean;
}

export class ScrollView extends Container {
	private readonly child: Component;
	readonly followEnd: boolean;
	readonly primary: boolean;
	readonly overscroll: "chain" | "contain";
	readonly scrollbarTrackStyle: (text: string) => string;
	readonly scrollbarThumbStyle: (text: string) => string;
	private currentScrollbar: ScrollViewScrollbar;
	private readonly scrollbarHideDelayMs: number;
	private currentScrollTop = 0;
	private contentHeight = 0;
	private currentViewportHeight = 0;
	private followingEnd: boolean;
	private followSuppressedAtEnd = false;
	/** Follow-end suspended by a pointer gesture. */
	private followSuspended = false;
	/** The gesture scrolled the view after suspending it. */
	private gestureScrolledWhileSuspended = false;
	/** The offset moved after suspending it, by a gesture or by content that shrank. */
	private offsetMovedWhileSuspended = false;
	/** Content beyond the viewport when the suspension started. */
	private suspendedMaxScrollTop = 0;
	private requestRenderCallback: (() => void) | undefined;
	private transientScrollbarVisible = false;
	private scrollbarActive = false;
	private scrollbarHideTimer: NodeJS.Timeout | undefined;
	/**
	 * Relative rows requested by {@link scrollBy} since the last layout pass, for a
	 * child whose row numbering can shift while it is being measured. Absolute
	 * jumps clear it.
	 */
	private pendingRelativeDelta: number | undefined;

	constructor(component: Component, options: ScrollViewOptions = {}) {
		super();
		if (options.axis !== undefined && options.axis !== "vertical") {
			throw new Error(`Unsupported ScrollView axis: ${options.axis}`);
		}
		this.child = component;
		this.children.push(component);
		this.followEnd = (options.follow ?? "none") === "end";
		this.followingEnd = this.followEnd;
		this.primary = options.primary ?? false;
		this.overscroll = options.overscroll ?? "chain";
		this.currentScrollbar = options.scrollbar ?? "hidden";
		this.scrollbarTrackStyle = options.scrollbarTrackStyle ?? ((text) => `\x1b[90m${text}\x1b[39m`);
		this.scrollbarThumbStyle = options.scrollbarThumbStyle ?? ((text) => `\x1b[37m${text}\x1b[39m`);
		this.scrollbarHideDelayMs = Math.max(0, Math.floor(options.scrollbarHideDelayMs ?? 1000));
	}

	get scrollTop(): number {
		return this.currentScrollTop;
	}

	get isFollowingEnd(): boolean {
		return this.followingEnd;
	}

	get viewportHeight(): number {
		return this.currentViewportHeight;
	}

	get scrollbar(): ScrollViewScrollbar {
		return this.currentScrollbar;
	}

	get isScrollbarVisible(): boolean {
		if (this.scrollbar === "always") return this.currentViewportHeight > 0;
		return (
			this.scrollbar === "auto" && this.contentHeight > this.currentViewportHeight && this.transientScrollbarVisible
		);
	}

	get isScrollbarActive(): boolean {
		return this.scrollbarActive;
	}

	setScrollbar(scrollbar: ScrollViewScrollbar): void {
		if (scrollbar === this.currentScrollbar) return;
		this.currentScrollbar = scrollbar;
		if (scrollbar !== "auto") this.hideTransientScrollbar();
		else if (this.scrollbarActive) this.markScrollbarActivity();
		this.requestRenderCallback?.();
	}

	/**
	 * The relative rows requested by {@link scrollBy} since the last layout pass,
	 * then cleared. A windowed child turns the delta into a content-anchored move,
	 * because its absolute row numbers move whenever an estimated block is measured.
	 */
	consumeRelativeScrollDelta(): number | undefined {
		const delta = this.pendingRelativeDelta;
		this.pendingRelativeDelta = undefined;
		return delta;
	}

	getContentWidth(width: number): number {
		return this.scrollbar === "always" && width > 1 ? width - 1 : width;
	}

	private markScrollbarActivity(): void {
		if (this.scrollbar !== "auto" || this.contentHeight <= this.currentViewportHeight) return;
		this.transientScrollbarVisible = true;
		if (this.scrollbarHideTimer) {
			clearTimeout(this.scrollbarHideTimer);
			this.scrollbarHideTimer = undefined;
		}
		if (this.scrollbarActive) return;
		this.scrollbarHideTimer = setTimeout(() => {
			this.scrollbarHideTimer = undefined;
			this.transientScrollbarVisible = false;
			this.requestRenderCallback?.();
		}, this.scrollbarHideDelayMs);
		this.scrollbarHideTimer.unref();
	}

	private hideTransientScrollbar(): void {
		this.transientScrollbarVisible = false;
		if (!this.scrollbarHideTimer) return;
		clearTimeout(this.scrollbarHideTimer);
		this.scrollbarHideTimer = undefined;
	}

	setScrollbarActive(active: boolean): void {
		if (active === this.scrollbarActive) return;
		this.scrollbarActive = active;
		this.markScrollbarActivity();
		this.requestRenderCallback?.();
	}

	private maxScrollTop(): number {
		return Math.max(0, this.contentHeight - this.currentViewportHeight);
	}

	/** Whether follow-end is suspended by a pointer gesture. */
	get isFollowSuspended(): boolean {
		return this.followSuspended;
	}

	/**
	 * Whether the gesture that suspended this view also scrolled it. Content that shrinks clamps the
	 * offset too, so a caller that wants to know whether the user moved the view asks this rather than
	 * comparing offsets.
	 */
	get wasScrolledWhileSuspended(): boolean {
		return this.gestureScrolledWhileSuspended;
	}

	/** Whether the offset moved under the suspension, whichever way. */
	get movedWhileSuspended(): boolean {
		return this.offsetMovedWhileSuspended;
	}

	/**
	 * Whether content arrived under the suspension and pushed the end out of reach. Only that moves
	 * what a screen row means: content that still fits was already showing its end.
	 */
	get grewPastViewportWhileSuspended(): boolean {
		return this.maxScrollTop() > this.suspendedMaxScrollTop;
	}

	/** Drop a suspended follow-end and the gesture bookkeeping it recorded. */
	private clearFollowSuspension(): void {
		this.followSuspended = false;
		this.gestureScrolledWhileSuspended = false;
		this.offsetMovedWhileSuspended = false;
	}

	/**
	 * Suspend follow-end until cleared, so the view holds its offset when content grows. The layout
	 * re-scrolls a windowed child to the offset it collected each frame, which would otherwise put
	 * the view back at the end; a suspended view also tells that child to honor the offset, because
	 * an estimate that still looks like the end would make it collect its window from there.
	 */
	setFollowSuspended(suspended: boolean): void {
		if (suspended === this.followSuspended) return;
		this.clearFollowSuspension();
		this.followSuspended = suspended;
		this.suspendedMaxScrollTop = this.maxScrollTop();
		if (suspended) {
			this.followingEnd = false;
			this.followSuppressedAtEnd = true;
		}
		// No repaint here: the gesture that suspends or lifts it paints what it changed.
	}

	scrollTo(scrollTop: number, options: ScrollViewScrollToOptions = {}): void {
		this.pendingRelativeDelta = undefined;
		const requested = Number.isFinite(scrollTop) ? Math.trunc(scrollTop) : this.currentScrollTop;
		const maxScrollTop = this.maxScrollTop();
		const next = Math.max(0, Math.min(maxScrollTop, requested));
		const nextFollowSuppressedAtEnd =
			(this.followSuspended || options.disableFollow === true) && next === maxScrollTop;
		const nextFollowingEnd = !nextFollowSuppressedAtEnd && this.followEnd && next === maxScrollTop;
		if (
			next === this.currentScrollTop &&
			nextFollowingEnd === this.followingEnd &&
			nextFollowSuppressedAtEnd === this.followSuppressedAtEnd
		) {
			return;
		}
		const moved = next !== this.currentScrollTop;
		if (moved && this.followSuspended) this.offsetMovedWhileSuspended = true;
		this.currentScrollTop = next;
		this.followingEnd = nextFollowingEnd;
		this.followSuppressedAtEnd = nextFollowSuppressedAtEnd;
		if (moved) this.markScrollbarActivity();
		this.requestRenderCallback?.();
	}

	scrollBy(lines: number): number {
		const requested = Number.isFinite(lines) ? Math.trunc(lines) : 0;
		if (requested === 0) return 0;
		const maxScrollTop = this.maxScrollTop();
		const start = this.followingEnd ? maxScrollTop : this.currentScrollTop;
		const next = Math.max(0, Math.min(maxScrollTop, start + requested));
		const moved = next - start;
		const wasFollowingEnd = this.followingEnd;
		this.currentScrollTop = next;
		this.followingEnd = !this.followSuspended && this.followEnd && next === maxScrollTop;
		this.followSuppressedAtEnd = false;
		if (this.followSuspended && moved !== 0) {
			this.gestureScrolledWhileSuspended = true;
			this.offsetMovedWhileSuspended = true;
		}
		if (moved !== 0) this.markScrollbarActivity();
		if (moved !== 0 || this.followingEnd !== wasFollowingEnd) this.requestRenderCallback?.();
		// Accumulate the requested rows for the next frame's content-anchored placement.
		// A request clamped to a standstill (already at an end) never happened on screen,
		// so it must not leak into the next anchored move.
		if (moved === 0) this.pendingRelativeDelta = undefined;
		else this.pendingRelativeDelta = (this.pendingRelativeDelta ?? 0) + requested;
		return requested - moved;
	}

	/** Move to the content end and take up follow-end without painting. */
	private moveToEnd(): void {
		this.pendingRelativeDelta = undefined;
		this.clearFollowSuspension();
		this.currentScrollTop = this.maxScrollTop();
		this.followingEnd = this.followEnd;
		this.followSuppressedAtEnd = false;
	}

	/**
	 * Take up follow-end again without painting, for a gesture that ended without changing which
	 * rows the user is looking at.
	 */
	resumeFollowEnd(): void {
		this.moveToEnd();
	}

	scrollToStart(): void {
		this.pendingRelativeDelta = undefined;
		const changed =
			this.currentScrollTop !== 0 ||
			this.followingEnd !== (this.followEnd && this.contentHeight <= this.currentViewportHeight);
		this.clearFollowSuspension();
		this.currentScrollTop = 0;
		this.followingEnd = this.followEnd && this.contentHeight <= this.currentViewportHeight;
		this.followSuppressedAtEnd = false;
		if (changed) {
			this.markScrollbarActivity();
			this.requestRenderCallback?.();
		}
	}

	scrollToEnd(): void {
		const changed = this.currentScrollTop !== this.maxScrollTop() || this.followingEnd !== this.followEnd;
		this.moveToEnd();
		if (changed) {
			this.markScrollbarActivity();
			this.requestRenderCallback?.();
		}
	}

	updateLayout(contentHeight: number, viewportHeight: number, requestRender: () => void): void {
		this.contentHeight = Math.max(0, Math.floor(contentHeight));
		this.currentViewportHeight = Math.max(0, Math.floor(viewportHeight));
		this.requestRenderCallback = requestRender;
		const maxScrollTop = this.maxScrollTop();
		const previousScrollTop = this.currentScrollTop;
		if (this.followingEnd) this.currentScrollTop = maxScrollTop;
		else this.currentScrollTop = Math.max(0, Math.min(this.currentScrollTop, maxScrollTop));
		if (this.followSuspended && this.currentScrollTop !== previousScrollTop) {
			this.offsetMovedWhileSuspended = true;
		}
		if (this.currentScrollTop < maxScrollTop) this.followSuppressedAtEnd = false;
		if (
			this.followEnd &&
			!this.followSuspended &&
			this.currentScrollTop === maxScrollTop &&
			!this.followSuppressedAtEnd
		) {
			this.followingEnd = true;
		}
		if (this.contentHeight <= this.currentViewportHeight) this.hideTransientScrollbar();
	}

	override addChild(_component: Component): void {
		throw new Error("ScrollView has exactly one child");
	}

	override removeChild(_component: Component): void {
		throw new Error("ScrollView child cannot be removed");
	}

	override clear(): void {
		throw new Error("ScrollView child cannot be cleared");
	}

	override render(width: number): string[] {
		const contentWidth = this.getContentWidth(width);
		const lines = this.child.render(contentWidth);
		return contentWidth === width ? lines : lines.map((line) => `${line} `);
	}

	[LAYOUT_NODE](): ScrollLayoutNode {
		return { type: "scroll", component: this.child, state: this };
	}
}
