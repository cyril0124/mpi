/**
 * The row that replaces the tab bar while zen mode is on.
 *
 * Hiding the chips frees vertical space, and the separator rule under the bar is
 * painted every frame anyway, so it carries what the chips were still reporting:
 * one dot per other agent, in tab order, capped so a full roster cannot eat the
 * rule. Each dot comes from the tab bar's own glyph priority
 * ({@link tabStatusGlyph}), and the row keeps an exact visible width whatever it
 * ends up carrying.
 */
import { visibleWidth } from "@earendil-works/pi-tui";
import type { AgentTab } from "../../../../../core/mixcode/multi-tab/tab-manager.ts";
import { theme } from "../../../theme/theme.ts";
import {
	RULE_CHAR,
	TAB_STATUS_GLYPHS,
	TAB_WAITING_GLYPH,
	tabStatusGlyph,
	WORKING_INDICATOR_FRAMES,
	WORKING_INDICATOR_INTERVAL_MS,
} from "./tab-glyphs.ts";

/** What a background tab contributes to the zen separator. */
export type ZenStatusMarker = "working" | "waiting" | "done" | "error";

/** Solid dot: the chip glyph for a working tab, reused for the other states. */
const STATUS_DOT = TAB_STATUS_GLYPHS.running;
/** Markers painted before the rest collapse into `[+N]`. */
const MARKER_CAP = 5;
/** Default for a caller that has no waiting tabs. */
const EMPTY_TAB_IDS: ReadonlySet<string> = new Set();
/** Lead dashes of the marker cluster. */
const CLUSTER_LEAD = RULE_CHAR.repeat(2);
/**
 * Chip glyph to marker. Idle has no glyph here, so a tab that is simply sitting
 * there contributes nothing to the row.
 */
const MARKERS: ReadonlyMap<string, ZenStatusMarker> = new Map([
	[TAB_STATUS_GLYPHS.running, "working"],
	[TAB_WAITING_GLYPH, "waiting"],
	[TAB_STATUS_GLYPHS.done, "done"],
	[TAB_STATUS_GLYPHS.error, "error"],
]);

/** Paint for each marker: a frame while a tab works, a coloured dot otherwise. */
const MARKER_PAINT: Record<ZenStatusMarker, (now: number) => string> = {
	working: (now) => {
		const index = Math.floor(now / WORKING_INDICATOR_INTERVAL_MS) % WORKING_INDICATOR_FRAMES.length;
		return theme.fg("accent", WORKING_INDICATOR_FRAMES[index] ?? WORKING_INDICATOR_FRAMES[0]!);
	},
	waiting: () => theme.fg("warning", STATUS_DOT),
	done: () => theme.fg("success", STATUS_DOT),
	error: () => theme.fg("error", STATUS_DOT),
};

/**
 * Markers for every tab other than the one in front, in tab order. A tab that
 * finished while unfocused counts as done, a tab parked on an extension dialog
 * counts as waiting, and an error outranks everything else, because that is the
 * chip {@link tabStatusGlyph} would draw.
 */
export function zenStatusMarkers(
	tabs: readonly AgentTab[],
	activeId: string,
	waitingTabIds: ReadonlySet<string> = EMPTY_TAB_IDS,
): ZenStatusMarker[] {
	const markers: ZenStatusMarker[] = [];
	for (const tab of tabs) {
		if (tab.id === activeId) continue;
		const marker = MARKERS.get(tabStatusGlyph(tab.status, tab.unread, waitingTabIds.has(tab.id)));
		if (marker) markers.push(marker);
	}
	return markers;
}

/**
 * Left cluster `── <dots> [+N] ` of the zen rule, at most `maxWidth` cells wide.
 *
 * `undefined` when there are no markers, or when even the bare dots do not fit.
 * The tab bar reuses this cluster as the prefix of the agent chrome a replaced
 * editor puts on the rule.
 */
export function zenStatusCluster(
	markers: readonly ZenStatusMarker[],
	frame: (text: string) => string,
	maxWidth: number,
	now = Date.now(),
): { painted: string; width: number } | undefined {
	if (markers.length === 0) return undefined;

	const shown = markers.slice(0, MARKER_CAP);
	const overflow = markers.length - shown.length;
	// Every marker done reads as one group, so its count keeps the done colour.
	const overflowColor = markers.every((marker) => marker === "done") ? "success" : "dim";
	const dots = shown.map((marker) => MARKER_PAINT[marker](now)).join(" ");
	// Richest fit first: the dots with the overflow count, then the dots alone.
	const candidates = overflow > 0 ? [`${dots} ${theme.fg(overflowColor, `[+${overflow}]`)}`, dots] : [dots];
	for (const painted of candidates) {
		const text = `${frame(CLUSTER_LEAD)} ${painted} `;
		const width = visibleWidth(text);
		if (width <= maxWidth) return { painted: text, width };
	}
	return undefined;
}

/**
 * Separator rule of exactly `width` columns. With no markers it is a plain rule;
 * otherwise it leads with the status cluster and fills the rest with dashes in
 * the frame colour. `[+N]` counts the markers past the cap, and is dropped, then
 * the whole cluster, before the rule would ever be truncated.
 */
export function renderZenStatusSeparator(
	width: number,
	markers: readonly ZenStatusMarker[],
	frame: (text: string) => string,
	now = Date.now(),
): string {
	if (width <= 0) return "";
	const cluster = zenStatusCluster(markers, frame, width, now);
	if (!cluster) return frame(RULE_CHAR.repeat(width));
	return `${cluster.painted}${frame(RULE_CHAR.repeat(width - cluster.width))}`;
}
