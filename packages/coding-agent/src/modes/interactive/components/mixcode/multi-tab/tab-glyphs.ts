/**
 * What the tab surfaces paint with: a chip's glyph per status, the frames and
 * cadence of the animated working indicator, and the rule the bar and its
 * separator are drawn from.
 *
 * The zen separator reads the same glyphs without going through `tab-bar.ts`,
 * the component that owns the chips, and the repaint loop sits next to the
 * cadence it uses.
 */
import type { TabStatus } from "../../../../../core/mixcode/multi-tab/types.ts";

/** Status glyphs of the tab chips; the Home roster cards and the zen dots share them. */
export const TAB_STATUS_GLYPHS: Record<TabStatus, string> = {
	idle: "-",
	running: "\u25cf",
	thinking: "\u25cf",
	error: "x",
	done: "\u2713",
};

/** Glyph for a tab's status; an unread completion reads as done, an error outranks it. */
export function tabStatusGlyph(status: TabStatus, unread: boolean): string {
	if (unread && status !== "error") return TAB_STATUS_GLYPHS.done;
	return TAB_STATUS_GLYPHS[status];
}

/**
 * Frames of the animated working indicator, shared by the Home roster cards and
 * the zen separator's dots. Chips carry the static status glyph instead.
 */
export const WORKING_INDICATOR_FRAMES = [
	"\u280b",
	"\u2819",
	"\u2839",
	"\u2838",
	"\u283c",
	"\u2834",
	"\u2826",
	"\u2827",
	"\u2807",
	"\u280f",
];
/** Frame interval in milliseconds for {@link WORKING_INDICATOR_FRAMES}. */
export const WORKING_INDICATOR_INTERVAL_MS = 80;

/** The horizontal rule the tab bar and its separator are drawn with. */
export const RULE_CHAR = "\u2500";

/**
 * Repaint on the indicator's frame interval while `shouldAnimate` holds, so an
 * animated indicator keeps moving even when nothing else on screen changes.
 * Returns a disposer; the interval is unref'd, so it never keeps the process
 * alive on its own.
 */
export function bindWorkingIndicatorRedraw(requestRender: () => void, shouldAnimate: () => boolean): () => void {
	const interval = setInterval(() => {
		if (shouldAnimate()) requestRender();
	}, WORKING_INDICATOR_INTERVAL_MS);
	interval.unref?.();
	return () => clearInterval(interval);
}
