/**
 * Console notice panel: the bottom-centered box that relocated console lines are
 * painted into while the TUI owns the screen.
 *
 * The panel is not part of the transcript. It floats above whatever the screen
 * shows, keeps the composer usable (the overlay does not take focus), wraps a long
 * line instead of cutting it, and caps itself at about 60% of the terminal so a
 * long diagnostic cannot cover the whole screen.
 */
import { type Component, type OverlayOptions, visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import { theme } from "../../../theme/theme.ts";
import { panel } from "../panel.ts";

export const CONSOLE_NOTICE_TITLE = "Notice";
/** Keys the panel answers, spelled out in its hint line. */
export const CONSOLE_NOTICE_HINT = "c/y copy · Esc/q close";

const MAX_WIDTH_RATIO = 0.6;
const MAX_HEIGHT_RATIO = 0.6;
const MIN_BOX_WIDTH = 24;
/** Panel chrome: top border, blank separator, hint line, bottom border. */
const PANEL_CHROME_LINES = 4;

/** Tallest the panel may grow, in rows, for the current terminal. */
export function consoleNoticeMaxHeight(): number {
	const rows = Math.max(1, process.stdout.rows || 24);
	return Math.max(6, Math.floor(rows * MAX_HEIGHT_RATIO));
}

/**
 * Where the panel sits and how wide it is for `text`: bottom-centered, fitted to
 * the longest line up to 60% of the terminal width, never narrower than the title
 * or the hint.
 */
export function consoleNoticeOverlayOptions(text: string): OverlayOptions {
	const columns = Math.max(1, process.stdout.columns || 80);
	const cap = Math.max(MIN_BOX_WIDTH, Math.floor(columns * MAX_WIDTH_RATIO));
	// +4: two border columns and one space of inner padding on each side.
	const longestLine = Math.max(
		visibleWidth(CONSOLE_NOTICE_TITLE) + 4,
		visibleWidth(CONSOLE_NOTICE_HINT) + 4,
		...text.split(/\r?\n/).map((line) => visibleWidth(line) + 4),
	);
	return {
		anchor: "bottom-center",
		width: Math.min(cap, Math.max(MIN_BOX_WIDTH, longestLine)),
		maxHeight: consoleNoticeMaxHeight(),
		margin: 1,
		offsetY: -4,
		nonCapturing: true,
	};
}

/**
 * Body of the panel for `text`: every line wrapped to the box width, oldest lines
 * dropped with a dim indicator when the wrapped text cannot fit `maxHeight`.
 */
export function renderConsoleNotice(text: string, width: number, maxHeight: number): string[] {
	const innerWidth = Math.max(1, width - 4);
	const wrapped = text.split(/\r?\n/).flatMap((line) => {
		const rows = wrapTextWithAnsi(line, innerWidth);
		return rows.length > 0 ? rows : [""];
	});

	let body: string[];
	if (wrapped.length > maxHeight - PANEL_CHROME_LINES) {
		// Keep the newest lines; the indicator takes the row it needs.
		const keep = Math.max(0, maxHeight - PANEL_CHROME_LINES - 1);
		const hidden = wrapped.length - keep;
		body = [
			theme.fg("dim", `(${hidden} earlier ${hidden === 1 ? "line" : "lines"} hidden · c/y copy all)`),
			...wrapped.slice(wrapped.length - keep),
		];
	} else {
		body = wrapped;
	}

	return panel(CONSOLE_NOTICE_TITLE, [...body, "", theme.fg("dim", CONSOLE_NOTICE_HINT)], width);
}

/** The panel's text, one line per console call, grown as lines arrive. */
export class ConsoleNotice implements Component {
	private text: string;

	constructor(line: string) {
		this.text = line;
	}

	append(line: string): void {
		this.text = `${this.text}\n${line}`;
	}

	getText(): string {
		return this.text;
	}

	invalidate(): void {}

	render(width: number): string[] {
		return renderConsoleNotice(this.text, width, consoleNoticeMaxHeight());
	}
}
