/**
 * Frame body lines in a box whose title sits in the top border. Body lines keep
 * their own colors and are padded to the inner width, so the sides stay aligned
 * whatever the content.
 */
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { type ThemeBg, type ThemeColor, theme } from "../../theme/theme.ts";

const PANEL_PADDING_X = 1;

/** Columns the frame spends on chrome: both borders plus the body padding on each side. */
export const PANEL_CHROME_COLUMNS = 2 + PANEL_PADDING_X * 2;

/** Content columns a panel `width` columns wide leaves for its body. */
export function panelContentWidth(width: number): number {
	return Math.max(1, width - PANEL_CHROME_COLUMNS);
}

export interface PanelOptions {
	/** Round the corners instead of squaring them. */
	rounded?: boolean;
	/** Color of the frame; the theme's border color by default. */
	borderColor?: ThemeColor;
	/** Background behind every cell, so the panel reads as a surface instead of an outline. */
	backgroundColor?: ThemeBg;
}

interface PanelCorners {
	topLeft: string;
	topRight: string;
	bottomLeft: string;
	bottomRight: string;
}

const SQUARE_CORNERS: PanelCorners = { topLeft: "┌", topRight: "┐", bottomLeft: "└", bottomRight: "┘" };
const ROUND_CORNERS: PanelCorners = { topLeft: "╭", topRight: "╮", bottomLeft: "╰", bottomRight: "╯" };

/** Frame `body` in a box `width` columns wide, with `title` set into the top border. */
export function panel(title: string, body: string[], width: number, options: PanelOptions = {}): string[] {
	const corners = options.rounded === true ? ROUND_CORNERS : SQUARE_CORNERS;
	const borderColor = options.borderColor ?? "border";
	const border = (text: string) => theme.fg(borderColor, text);
	const innerWidth = Math.max(1, width - 2);
	const contentWidth = panelContentWidth(width);
	const label = truncateToWidth(title ? ` ${title} ` : "", innerWidth, "");
	const fill = "─".repeat(Math.max(0, innerWidth - visibleWidth(label)));

	const lines = body.map((line) => {
		const content = truncateToWidth(line, contentWidth, "");
		const padding = " ".repeat(PANEL_PADDING_X + Math.max(0, contentWidth - visibleWidth(content)));
		return border("│") + " ".repeat(PANEL_PADDING_X) + content + padding + border("│");
	});

	const topBorder = label
		? border(corners.topLeft) + theme.bold(theme.fg("accent", label)) + border(`${fill}${corners.topRight}`)
		: border(`${corners.topLeft}${fill}${corners.topRight}`);

	const framed = [topBorder, ...lines, border(`${corners.bottomLeft}${"─".repeat(innerWidth)}${corners.bottomRight}`)];

	if (options.backgroundColor === undefined) return framed;
	const backgroundColor = options.backgroundColor;
	return framed.map((line) => theme.bg(backgroundColor, line));
}
