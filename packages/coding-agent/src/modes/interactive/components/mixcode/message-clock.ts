/**
 * The send time a message block carries on its first row.
 *
 * A message block is a background-filled surface with no reading of when it was written.
 * MixCode puts the send time at the right end of the block's first row, in the terminal's own
 * locale, so a long conversation can be read by when it happened without opening a session
 * listing.
 */
import { type Component, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { theme } from "../../theme/theme.ts";

/**
 * Short month and day plus the local clock, e.g. `Aug 9, 5:07 PM`. Empty for a
 * missing or unusable value, which leaves the block exactly as it was.
 */
export function formatMessageClock(timestamp?: number): string {
	if (timestamp === undefined || !Number.isFinite(timestamp)) return "";
	return new Date(timestamp).toLocaleString(undefined, {
		month: "short",
		day: "numeric",
		hour: "numeric",
		minute: "2-digit",
	});
}

/**
 * Paints the clock dim, the default for a body that paints no background of its own.
 */
function paintDim(text: string): string {
	return theme.fg("dim", text);
}

/** Whether a rendered row carries anything a reader can see, colors aside. */
function hasVisibleContent(row: string): boolean {
	return (
		row
			.replace(/\x1b\][^\x07]*\x07/g, "")
			.replace(/\x1b\[[0-9;]*m/g, "")
			.trim() !== ""
	);
}

/**
 * `left` clipped to make room for `right` at the end of a `width`-column row,
 * with the gap filled in between and `right` painted dim. `right` arrives with
 * its own leading space; an empty one still leaves that space in place.
 */
export function rightAlignDim(left: string, right: string, width: number): string {
	const clock = truncateToWidth(` ${right}`, Math.max(0, width));
	const clockCells = visibleWidth(clock);
	const clippedLeft = truncateToWidth(left.replace(/\s+$/u, ""), Math.max(0, width - clockCells));
	const fill = " ".repeat(Math.max(0, width - visibleWidth(clippedLeft) - clockCells));
	return `${clippedLeft}${paintDim(`${fill}${clock}`)}`;
}

/**
 * A message body whose first text row ends with `clock` at the right edge of the
 * body's content area.
 *
 * Blank rows ahead of the text keep no clock, and the body renders the clock's own cells
 * narrower, so nothing it draws can reach them. A body that pads its own rows, like the
 * Markdown block, keeps that padding: `insetRight` cells stay after the clock.
 */
export class ClockedMessageBody implements Component {
	private readonly body: Component;
	private readonly clock: string;
	/** Paints the clock and its gap, so a background-filled body keeps its surface. */
	private readonly paintRight: ((text: string) => string) | undefined;
	/** Cells the body keeps after the clock, its own right padding. */
	private readonly insetRight: number;

	constructor(body: Component, clock: string, paintRight?: (text: string) => string, insetRight = 0) {
		this.body = body;
		this.clock = clock;
		this.paintRight = paintRight;
		this.insetRight = insetRight;
	}

	invalidate(): void {
		this.body.invalidate?.();
	}

	render(width: number): string[] {
		if (this.clock === "") return this.body.render(width);
		// The body keeps one column, so the clock's cells and the body's always add up to `width`.
		const clockText = truncateToWidth(` ${this.clock}`, Math.max(0, width - 1));
		const clockCells = visibleWidth(clockText);
		const bodyWidth = Math.max(1, width - clockCells);
		const lines = this.body.render(bodyWidth);
		const clockRow = lines.findIndex(hasVisibleContent);
		if (clockCells === 0 || clockRow < 0) return lines;
		const paint = this.paintRight ?? paintDim;
		const keepRight = Math.min(this.insetRight, bodyWidth);
		// The body is narrower by the clock's cells, so every row that carries no clock is
		// filled out with the same painter. On the clock's own row the body keeps its content
		// and drops the padding the clock takes over.
		return lines.map((line, index) => {
			if (index !== clockRow) return `${line}${paint(" ".repeat(clockCells))}`;
			const left = truncateToWidth(line, bodyWidth - keepRight, "", true);
			return `${left}${paint(`${clockText}${" ".repeat(keepRight)}`)}`;
		});
	}
}
