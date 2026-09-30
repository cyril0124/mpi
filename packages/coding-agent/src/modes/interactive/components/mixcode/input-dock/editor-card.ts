/**
 * Rounded edges of the input card.
 *
 * The card is drawn over the editor's own flat rules: the top edge carries the
 * left mode labels and the right-anchored title with the exact context usage,
 * the bottom edge carries the scroll hint. Labels arrive already painted, so the
 * only style this module owns is the dim separator between the title and the
 * context text.
 *
 * Every returned line has an exact visible width of `width`, so the card stays
 * aligned whatever the labels are.
 */
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { theme } from "../../../theme/theme.ts";

/**
 * Columns one side label may keep before the title yields: enough for a mode
 * badge or the working status, not enough to crowd the title off the edge.
 */
export const LABEL_ROOM_MAX = 16;

/** Columns the two corners and the surrounding dashes reserve in an edge row. */
const EDGE_CHROME_COLUMNS = 6;

/**
 * Top edge of the card: the mode labels on the left, the title and the context
 * usage right-aligned. A narrow edge drops the mode labels and the context before
 * truncating the title.
 */
export function renderTopEdge(
	width: number,
	title: string,
	context: string,
	frame: (text: string) => string,
	modeLabel = "",
): string {
	// Space both corners and the surrounding dashes reserve.
	const available = Math.max(0, width - EDGE_CHROME_COLUMNS);
	const modeChunk = visibleWidth(modeLabel) > 0 ? ` ${modeLabel} ` : "";
	const modes =
		visibleWidth(modeChunk) + Math.min(visibleWidth(title), LABEL_ROOM_MAX) + 1 > available ? "" : modeChunk;
	const titleBudget = available - visibleWidth(modes);
	const contextText = visibleWidth(title) + visibleWidth(context) + 3 > titleBudget ? "" : context;
	const contextChunk = contextText ? `${theme.fg("dim", " · ")}${contextText}` : "";
	const label = ` ${truncateToWidth(title, Math.max(0, titleBudget - visibleWidth(contextChunk)))}${contextChunk} `;
	const fill = width - 4 - visibleWidth(modes) - visibleWidth(label);
	return `${frame("╭─")}${modes}${frame("─".repeat(fill))}${label}${frame("─╮")}`;
}

/** Bottom edge of the card: the scroll hint on the left, then the closing rule. */
export function renderBottomEdge(width: number, hint: string, frame: (text: string) => string): string {
	const available = Math.max(0, width - EDGE_CHROME_COLUMNS);
	// The hint is dropped whole rather than clipped when it cannot share the edge.
	const leftChunk = hint && visibleWidth(hint) + 3 <= available ? ` ${truncateToWidth(hint, available)} ` : "";
	const fill = Math.max(0, width - 4 - visibleWidth(leftChunk));
	return `${frame("╰─")}${leftChunk}${frame("─".repeat(fill))}${frame("─╯")}`;
}
