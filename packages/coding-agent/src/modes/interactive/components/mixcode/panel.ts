/**
 * Frame body lines in a box whose title sits in the top border. Body lines keep
 * their own colors and are padded to the inner width, so the sides stay aligned
 * whatever the content.
 */
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { type ThemeBg, type ThemeColor, theme } from "../../theme/theme.ts";

const PANEL_PADDING_X = 1;

/** Columns the frame spends on chrome when it keeps its default padding. */
export const PANEL_CHROME_COLUMNS = 2 + PANEL_PADDING_X * 2;

/** Content columns a panel `width` columns wide leaves for its body. */
export function panelContentWidth(width: number, paddingX: number = PANEL_PADDING_X): number {
	return Math.max(1, width - 2 - paddingX * 2);
}

export interface PanelOptions {
	/** Round the corners instead of squaring them. */
	rounded?: boolean;
	/** Color of the frame; the theme's border color by default. */
	borderColor?: ThemeColor;
	/** Background behind every cell, so the panel reads as a surface instead of an outline. */
	backgroundColor?: ThemeBg;
	/**
	 * Which cells `backgroundColor` covers: the whole framed line (the default), or
	 * only the body cells, leaving the border on the terminal background.
	 */
	backgroundScope?: "frame" | "content";
	/** Cells of padding between the border and the body; 1 unless the caller wants the body flush. */
	paddingX?: number;
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
	const paddingX = options.paddingX ?? PANEL_PADDING_X;
	const innerWidth = Math.max(1, width - 2);
	const contentWidth = panelContentWidth(width, paddingX);
	const label = truncateToWidth(title ? ` ${title} ` : "", innerWidth, "");
	const fill = "─".repeat(Math.max(0, innerWidth - visibleWidth(label)));

	const backgroundColor = options.backgroundColor;
	const contentBackground = options.backgroundScope === "content" ? backgroundColor : undefined;
	const lines = body.map((line) => {
		const content = truncateToWidth(line, contentWidth, "");
		const padding = " ".repeat(paddingX + Math.max(0, contentWidth - visibleWidth(content)));
		const cells = `${content}${padding}`;
		const paintedCells =
			contentBackground === undefined
				? `${" ".repeat(paddingX)}${cells}`
				: theme.bg(contentBackground, `${" ".repeat(paddingX)}${cells}`);
		return border("│") + paintedCells + border("│");
	});

	const topBorder = label
		? border(corners.topLeft) + theme.bold(theme.fg("accent", label)) + border(`${fill}${corners.topRight}`)
		: border(`${corners.topLeft}${fill}${corners.topRight}`);

	const framed = [topBorder, ...lines, border(`${corners.bottomLeft}${"─".repeat(innerWidth)}${corners.bottomRight}`)];

	if (backgroundColor === undefined || options.backgroundScope === "content") return framed;
	return framed.map((line) => theme.bg(backgroundColor, line));
}
