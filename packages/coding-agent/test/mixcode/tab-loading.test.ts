import { afterEach, describe, expect, it, vi } from "vitest";
import {
	bindTabLoadingRedraw,
	TAB_LOADING_FRAME_MS,
	TAB_LOADING_FRAMES,
	tabLoadingFrame,
} from "../../src/modes/interactive/components/mixcode/multi-tab/tab-loading.ts";

describe("tab loading spinner", () => {
	it("advances one frame per interval and wraps", () => {
		expect(TAB_LOADING_FRAMES).toHaveLength(10);
		expect(tabLoadingFrame(0)).toBe(TAB_LOADING_FRAMES[0]);
		expect(tabLoadingFrame(TAB_LOADING_FRAME_MS)).toBe(TAB_LOADING_FRAMES[1]);
		expect(tabLoadingFrame(TAB_LOADING_FRAME_MS * TAB_LOADING_FRAMES.length)).toBe(TAB_LOADING_FRAMES[0]);
	});

	it("holds one frame for a whole interval, so tabs repaint in step", () => {
		const base = TAB_LOADING_FRAME_MS * 12;
		expect(tabLoadingFrame(base)).toBe(tabLoadingFrame(base + TAB_LOADING_FRAME_MS - 1));
		expect(tabLoadingFrame(base)).not.toBe(tabLoadingFrame(base + TAB_LOADING_FRAME_MS));
	});
});

describe("tab loading redraw", () => {
	afterEach(() => {
		vi.useRealTimers();
	});

	/** A loading chip only animates if something repaints it; the frame is wall-clock driven. */
	it("repaints on the frame cadence while a tab loads, and goes quiet once they are ready", () => {
		vi.useFakeTimers();
		let renders = 0;
		let loading = true;
		const stop = bindTabLoadingRedraw(
			() => {
				renders += 1;
			},
			() => loading,
		);

		vi.advanceTimersByTime(TAB_LOADING_FRAME_MS * 5);
		expect(renders).toBe(5);

		loading = false;
		vi.advanceTimersByTime(TAB_LOADING_FRAME_MS * 5);
		expect(renders).toBe(5);

		stop();
		loading = true;
		vi.advanceTimersByTime(TAB_LOADING_FRAME_MS * 5);
		expect(renders).toBe(5);
	});
});
