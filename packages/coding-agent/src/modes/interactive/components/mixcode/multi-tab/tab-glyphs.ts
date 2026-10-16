/**
 * What the tab surfaces paint with: a chip's glyph and colour per status, the
 * frames and cadence of the animated working indicator, and the rule the bar and
 * its separator are drawn from.
 *
 * The zen separator and the Tab Jump rows read the same glyphs and colours without
 * going through `tab-bar.ts`, the component that owns the chips, and the repaint
 * loop sits next to the cadence it uses.
 */
import { isWorkingStatus, type TabStatus } from "../../../../../core/mixcode/multi-tab/types.ts";
import { theme } from "../../../theme/theme.ts";
import { tabLoadingFrame } from "./tab-loading.ts";

/**
 * Status glyphs of the tab chips; the Home roster cards and the zen dots share them.
 * `"loading"` is a view state rather than a tab status, so it is not in the table:
 * a loading chip paints the spinner frame from {@link tabStatusGlyph} instead.
 */
export const TAB_STATUS_GLYPHS: Record<Exclude<TabStatus, "loading">, string> = {
	idle: "-",
	running: "\u25cf",
	thinking: "\u25cf",
	error: "x",
	done: "\u2713",
};

/**
 * Glyph of a tab that waits on a human: an extension dialog (question, confirm,
 * permission prompt) is open on it and can only be answered from that tab.
 */
export const TAB_WAITING_GLYPH = "?";

/**
 * Glyph for a tab's status: a loading tab spins, an error outranks everything,
 * `waiting` outranks an unread completion because the tab cannot move until
 * it is answered; live work outranks an earlier unread completion.
 */
export function tabStatusGlyph(status: TabStatus, unread: boolean, waiting = false): string {
	// A loading tab spins: the frame comes from the clock, not from the tab.
	if (status === "loading") return tabLoadingFrame();
	if (status === "error") return TAB_STATUS_GLYPHS.error;
	if (waiting) return TAB_WAITING_GLYPH;
	if (isWorkingStatus(status)) return TAB_STATUS_GLYPHS[status];
	if (unread) return TAB_STATUS_GLYPHS.done;
	return TAB_STATUS_GLYPHS[status];
}

/**
 * Painter for a tab's status text, so a chip's glyph and a Tab Jump row's glyph and
 * title read in the same colour. `undefined` leaves the text as the surface paints it.
 */
export function tabStatusPaint(
	status: TabStatus,
	unread: boolean,
	waiting = false,
): ((text: string) => string) | undefined {
	if (status === "loading") return (text) => theme.fg("dim", text);
	if (status === "error") return (text) => theme.fg("error", text);
	// The waiting color is the theme's warm accent, the same color MixCode gives a
	// tab parked on a dialog; a completion stays quiet until the question is answered.
	if (waiting) return (text) => theme.fg("toolTitle", text);
	if (isWorkingStatus(status)) return (text) => theme.fg("accent", text);
	if (unread) return (text) => theme.fg("success", text);
	return undefined;
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
