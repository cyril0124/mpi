/**
 * Active-tab shimmer wave: the bouncing highlight that sweeps to the right edge
 * of the focused tab's title and back, then rests before the next pass.
 */
import { theme } from "../../theme/theme.ts";

/** One full cycle: the sweep plus the rest phase that follows it. */
export const TAB_ACTIVE_SHIMMER_PERIOD_MS = 3000;
/** How long one right-then-left pass takes inside a cycle. */
export const TAB_ACTIVE_SHIMMER_SWEEP_MS = 2000;
/** Repaint cadence while a wave is sweeping; fine enough to read as motion. */
const TAB_ACTIVE_SHIMMER_REDRAW_INTERVAL_MS = 50;

/** Brightness steps of the wave, from the lit peak outwards. */
export interface TabShimmerStyles {
	peak: (text: string) => string;
	shoulder: (text: string) => string;
	tail: (text: string) => string;
}

/** Wave steps over a plain chip, where theme foregrounds read against the chip. */
export const THEME_SHIMMER_STYLES: TabShimmerStyles = {
	peak: (text) => theme.bold(theme.fg("text", text)),
	shoulder: (text) => theme.bold(theme.fg("accent", text)),
	tail: (text) => theme.fg("accent", text),
};

/**
 * Wave steps over a chip painted in a tab color. Theme foregrounds have no
 * contrast over a chip color, so the lit cells invert with the same raw SGR the
 * chip colors use; weight stays outside the wave so the chip keeps its own bold
 * state.
 */
export const COLORED_SHIMMER_STYLES: TabShimmerStyles = {
	peak: (text) => `\x1b[7m${text}\x1b[27m`,
	shoulder: (text) => `\x1b[7m${text}\x1b[27m`,
	tail: (text) => text,
};

/**
 * Apply the wave to an active tab title at `now`. A brightness peak travels to
 * the right edge and back within `TAB_ACTIVE_SHIMMER_SWEEP_MS`, then the title
 * is returned unchanged for the rest of `TAB_ACTIVE_SHIMMER_PERIOD_MS`.
 *
 * Each leg eases out so the wave decelerates into its turnaround, and the
 * brightness falls off over 3 steps so the lit region reads as a moving peak
 * rather than a block.
 */
export function applyActiveTabShimmer(
	text: string,
	activatedAt: number | undefined,
	now = Date.now(),
	styles: TabShimmerStyles = THEME_SHIMMER_STYLES,
): string {
	const elapsed = (now - (activatedAt ?? 0)) % TAB_ACTIVE_SHIMMER_PERIOD_MS;
	if (elapsed >= TAB_ACTIVE_SHIMMER_SWEEP_MS) return text;

	const chars = Array.from(text);
	const total = chars.length;
	if (total === 0) return text;

	const progress = elapsed / TAB_ACTIVE_SHIMMER_SWEEP_MS;
	// Triangle wave: right over the first half of the sweep, back over the second.
	const leg = progress < 0.5 ? progress * 2 : (1 - progress) * 2;
	// Ease-out slows each leg as it nears its turnaround.
	const eased = 1 - (1 - leg) * (1 - leg);
	// Turnarounds sit 1 cell outside the title so the wave still grazes its
	// first and last character.
	const waveCenter = eased * (total + 1) - 1;

	return chars
		.map((char, index) => {
			const distance = Math.abs(index - waveCenter);
			if (distance < 0.6) return styles.peak(char);
			if (distance < 1.6) return styles.shoulder(char);
			if (distance < 2.8) return styles.tail(char);
			return char;
		})
		.join("");
}

/**
 * Repaint on the sweep cadence while the active tab waves. An undefined
 * activation (no active tab) never repaints, and the predicate covers 1 extra
 * tick past the sweep end so the resting (plain) title is painted before the
 * loop goes quiet; the rest of the cycle triggers no repaint.
 *
 * Returns a disposer. The interval is unref'd, so it never keeps the process
 * alive on its own.
 */
export function bindActiveTabShimmerRedraw(
	requestRender: () => void,
	getActivatedAt: () => number | undefined,
): () => void {
	const interval = setInterval(() => {
		const activatedAt = getActivatedAt();
		if (activatedAt === undefined) return;
		const elapsed = (Date.now() - activatedAt) % TAB_ACTIVE_SHIMMER_PERIOD_MS;
		if (elapsed < TAB_ACTIVE_SHIMMER_SWEEP_MS + TAB_ACTIVE_SHIMMER_REDRAW_INTERVAL_MS) requestRender();
	}, TAB_ACTIVE_SHIMMER_REDRAW_INTERVAL_MS);
	interval.unref?.();
	return () => clearInterval(interval);
}
