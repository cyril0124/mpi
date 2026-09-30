/**
 * Loading spinner for a tab that is still coming up.
 *
 * The frame is picked from the wall clock at paint time rather than stored per
 * tab, so nothing has to be advanced per render. It needs a repaint while any
 * tab is loading, which is what {@link bindTabLoadingRedraw} provides.
 */

/** Braille frames, the same cycle the working indicator uses. */
export const TAB_LOADING_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"] as const;

/** How long one frame is held. */
export const TAB_LOADING_FRAME_MS = 80;

/** The frame for `now`, so two tabs repaint in step. */
export function tabLoadingFrame(now: number = Date.now()): string {
	const index = Math.floor(now / TAB_LOADING_FRAME_MS) % TAB_LOADING_FRAMES.length;
	return TAB_LOADING_FRAMES[index] ?? TAB_LOADING_FRAMES[0];
}

/**
 * Repaint on the frame cadence while `isLoading` holds, so the spinner advances
 * on its own. Returns a disposer; the interval is unref'd and never keeps the
 * process alive.
 */
export function bindTabLoadingRedraw(requestRender: () => void, isLoading: () => boolean): () => void {
	const interval = setInterval(() => {
		if (isLoading()) requestRender();
	}, TAB_LOADING_FRAME_MS);
	interval.unref?.();
	return () => clearInterval(interval);
}
