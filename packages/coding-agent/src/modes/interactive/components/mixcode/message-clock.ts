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
		const clockCells = this.clock === "" ? 0 : visibleWidth(` ${this.clock}`);
		const lines = this.body.render(Math.max(1, width - clockCells));
		if (clockCells === 0 || lines.length === 0) return lines;
		return [stampFirstRow(lines[0] ?? "", this.clock, width), ...lines.slice(1)];
	}
}

/** First row with the clock right-aligned: the body is clipped to make room, then the gap filled. */
function stampFirstRow(text: string, clock: string, width: number): string {
	const clockText = truncateToWidth(` ${clock}`, Math.max(0, width));
	const clockCells = visibleWidth(clockText);
	const bodyText = truncateToWidth(text.replace(/\s+$/u, ""), Math.max(0, width - clockCells));
	const gap = " ".repeat(Math.max(0, width - visibleWidth(bodyText) - clockCells));
	return `${bodyText}${gap}${theme.fg("dim", clockText)}`;
}
