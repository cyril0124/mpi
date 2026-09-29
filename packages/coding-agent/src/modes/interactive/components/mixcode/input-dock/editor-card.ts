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
 * Paint one edge of the card.
 *
 * The top edge shares its right side between the title and the context, and the
 * mode labels anchor its left side; a narrow top drops the mode labels and the
 * context before truncating the title. The bottom edge fits both of its labels to
 * the available width, keeping the right one first.
 */
export function renderEditorCardEdge(
	width: number,
	edge: "top" | "bottom",
	leftLabel: string,
	rightLabel: string,
	frame: (text: string) => string,
	modeLabel = "",
): string {
	// Space both corners and the surrounding dashes reserve.
	const available = Math.max(0, width - 6);
	const left = visibleWidth(leftLabel) === 0 ? "" : leftLabel;
	const right = visibleWidth(rightLabel) === 0 ? "" : rightLabel;

	if (edge === "top") {
		const modeChunk = visibleWidth(modeLabel) > 0 ? ` ${modeLabel} ` : "";
		const modes = visibleWidth(modeChunk) + Math.min(visibleWidth(left), 16) + 1 > available ? "" : modeChunk;
		const titleBudget = available - visibleWidth(modes);
		const contextText = visibleWidth(left) + visibleWidth(right) + 3 > titleBudget ? "" : right;
		const contextChunk = contextText ? `${theme.fg("dim", " · ")}${contextText}` : "";
		const title = truncateToWidth(left, Math.max(0, titleBudget - visibleWidth(contextChunk)));
		const label = ` ${title}${contextChunk} `;
		const fill = width - 4 - visibleWidth(modes) - visibleWidth(label);
		return `${frame("╭─")}${modes}${frame("─".repeat(fill))}${label}${frame("─╮")}`;
	}

	// The bottom edge drops its left label before truncating the right one.
	const cramped = visibleWidth(left) + visibleWidth(right) + 3 > available;
	const leftText = cramped ? "" : left;
	const rightText = cramped ? truncateToWidth(right, available) : right;
	const keepRight = !leftText || visibleWidth(rightText) + Math.min(visibleWidth(leftText), 16) + 3 <= available;
	const keptRight = keepRight ? rightText : "";
	const leftBudget = available - (keptRight ? visibleWidth(keptRight) + 3 : 0);
	const leftChunk = leftText ? ` ${truncateToWidth(leftText, Math.max(0, leftBudget))} ` : "";
	const rightChunk = keptRight ? ` ${keptRight} ` : "";
	const fill = Math.max(0, width - 4 - visibleWidth(leftChunk) - visibleWidth(rightChunk));
	return `${frame("╰─")}${leftChunk}${frame("─".repeat(fill))}${rightChunk}${frame("─╯")}`;
}
