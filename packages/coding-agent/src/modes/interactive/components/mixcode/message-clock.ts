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
 * `left` clipped to make room for `right` at the end of a `width`-column row,
 * with the gap filled in between and `right` painted dim. `right` arrives with
 * its own leading space; an empty one still leaves that space in place.
 */
export function rightAlignDim(left: string, right: string, width: number): string {
	const clock = truncateToWidth(` ${right}`, Math.max(0, width));
	const clockCells = visibleWidth(clock);
	const clippedLeft = truncateToWidth(left.replace(/\s+$/u, ""), Math.max(0, width - clockCells));
	const fill = " ".repeat(Math.max(0, width - visibleWidth(clippedLeft) - clockCells));
	return `${clippedLeft}${fill}${theme.fg("dim", clock)}`;
}

/**
 * A message body whose first row ends with `clock` at the right edge.
 *
 * The body renders the clock's own cells narrower, so nothing it draws can reach them, and
 * the row is filled to the full width so the block's background stays unbroken.
 */
export class ClockedMessageBody implements Component {
	private readonly body: Component;
	private readonly clock: string;

	constructor(body: Component, clock: string) {
		this.body = body;
		this.clock = clock;
	}

	invalidate(): void {
		this.body.invalidate?.();
	}

	render(width: number): string[] {
		if (this.clock === "") return this.body.render(width);
		// Reserve the clock's own cells once: the body is sized for them and the row
		// is assembled from the same truncated clock text, so the two agree at any width.
		const clockText = truncateToWidth(` ${this.clock}`, Math.max(0, width));
		const clockCells = visibleWidth(clockText);
		const lines = this.body.render(Math.max(1, width - clockCells));
		if (clockCells === 0 || lines.length === 0) return lines;
		return [rightAlignDim(lines[0] ?? "", this.clock, width), ...lines.slice(1)];
	}
}
