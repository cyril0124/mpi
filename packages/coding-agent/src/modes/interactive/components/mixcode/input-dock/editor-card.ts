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

/**
 * Columns one edge row spends on its corners and their adjacent dashes, leaving
 * the rest for labels. The body sizes its rows to the same arithmetic.
 */
export const CARD_EDGE_CHROME_COLUMNS = 4;

/**
 * Content columns a card `width` columns wide leaves for its body, once the two
 * side borders and the body inset are taken off.
 */
export function cardInnerWidth(width: number, bodyInset: number): number {
	return Math.max(1, width - 2 - bodyInset);
}

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
	// The two left corner glyphs and the dashes that follow them.
	const available = Math.max(0, width - CARD_EDGE_CHROME_COLUMNS);
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
	const available = Math.max(0, width - CARD_EDGE_CHROME_COLUMNS);
	// The hint is dropped whole rather than clipped when it cannot share the edge.
	const leftChunk = hint && visibleWidth(hint) + 3 <= available ? ` ${truncateToWidth(hint, available)} ` : "";
	const fill = Math.max(0, width - 4 - visibleWidth(leftChunk));
	return `${frame("╰─")}${leftChunk}${frame("─".repeat(fill))}${frame("─╯")}`;
}
