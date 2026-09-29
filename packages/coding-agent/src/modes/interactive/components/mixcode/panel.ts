/**
 * Frame body lines in a box whose title sits in the top border. Body lines keep
 * their own colors and are padded to the inner width, so the sides stay aligned
 * whatever the content.
 */
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { theme } from "../../theme/theme.ts";

const PANEL_PADDING_X = 1;

export function panel(title: string, body: string[], width: number): string[] {
	const border = (text: string) => theme.fg("border", text);
	const innerWidth = Math.max(1, width - 2);
	const contentWidth = Math.max(1, innerWidth - PANEL_PADDING_X * 2);
	const label = truncateToWidth(title ? ` ${title} ` : "", innerWidth, "");
	const fill = "─".repeat(Math.max(0, innerWidth - visibleWidth(label)));

	const lines = body.map((line) => {
		const content = truncateToWidth(line, contentWidth, "");
		const padding = " ".repeat(PANEL_PADDING_X + Math.max(0, contentWidth - visibleWidth(content)));
		return border("│") + " ".repeat(PANEL_PADDING_X) + content + padding + border("│");
	});

	return [
		border("┌") + theme.bold(theme.fg("accent", label)) + border(`${fill}┐`),
		...lines,
		border(`└${"─".repeat(innerWidth)}┘`),
	];
}
