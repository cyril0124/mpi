/**
 * User-message preview model.
 *
 * While vim mode walks the chat with `right` / `shift+right`, a panel at the
 * bottom right lists the user messages around the one the viewport landed on,
 * with a trailing row for the newest output. This module owns the panel's
 * labels, its row budget and the window over the list; rendering lives in
 * `UserMessagePreviewPanel`.
 */
import { truncateToWidth } from "@earendil-works/pi-tui";

/** Title shown in the panel's top border. */
export const USER_MESSAGE_PREVIEW_TITLE = "User Messages";
/** How long the panel stays on screen after a jump. */
export const USER_MESSAGE_PREVIEW_TTL_MS = 1_800;
/** Panel width in columns, unless the frame is narrower. */
export const USER_MESSAGE_PREVIEW_WIDTH = 34;
/** Narrowest frame that still reads as a box; a narrower one draws nothing. */
export const USER_MESSAGE_PREVIEW_MIN_WIDTH = 4;
/** Columns a label may use; the rest of the width is frame and padding. */
export const USER_MESSAGE_PREVIEW_LABEL_WIDTH = 28;
/** Row that stands for the newest output, the position past the last message. */
export const USER_MESSAGE_PREVIEW_NEWEST_LABEL = "<NEWEST>";

/** Row budget used when the transcript viewport height is unknown. */
const FALLBACK_PREVIEW_ROWS = 5;
/** Bounds of the row budget taken from a known viewport height. */
const MIN_PREVIEW_ROWS = 3;
const MAX_PREVIEW_ROWS = 7;
/** Rows the panel's own frame and the gap above the dock occupy in that height. */
const VIEWPORT_ROWS_RESERVED = 2;
/** Row label for a message whose text has no visible line. */
const EMPTY_MESSAGE_LABEL = "(empty user message)";

/**
 * Rows the panel may show, from the transcript viewport height. The panel sits
 * inside the transcript region, so its budget grows with that region and stops
 * at a height that still reads as a hint rather than a list view.
 */
export function userMessagePreviewRows(viewportHeight: number | undefined): number {
	if (viewportHeight === undefined || viewportHeight <= 0) return FALLBACK_PREVIEW_ROWS;
	return Math.max(MIN_PREVIEW_ROWS, Math.min(MAX_PREVIEW_ROWS, viewportHeight - VIEWPORT_ROWS_RESERVED));
}

/**
 * Label for one message: its first non-empty text line, or a placeholder, clipped to the
 * panel's label width so a caller that builds one label per message holds columns, not lines.
 */
export function userMessagePreviewLabel(text: string): string {
	const firstLine = text.trim().split(/\r?\n/)[0]?.trim() ?? "";
	return truncateToWidth(firstLine || EMPTY_MESSAGE_LABEL, USER_MESSAGE_PREVIEW_LABEL_WIDTH);
}

export interface UserMessagePreviewWindow {
	/** Panel body rows, clipped to the row budget. */
	lines: string[];
	/** Index of the selected row within `lines`. */
	highlightedIndex: number;
}

/**
 * Window over `labels` plus the trailing newest-output row, centred on
 * `selectedIndex` while it fits. `maxRows` bounds the returned rows and includes
 * the clip hint rows, so a window that is cut reports how much is missing.
 */
export function userMessagePreviewWindow(
	labels: readonly string[],
	selectedIndex: number,
	maxRows: number,
): UserMessagePreviewWindow {
	const entries = [...labels, USER_MESSAGE_PREVIEW_NEWEST_LABEL];
	const selected = Math.max(0, Math.min(selectedIndex, entries.length - 1));
	let start = Math.max(0, selected - Math.floor(maxRows / 2));
	let end = Math.min(entries.length, start + maxRows);
	start = Math.max(0, end - maxRows);

	// The hint rows themselves consume the budget, which can push another row out of
	// the window; settle once the window stops moving.
	for (;;) {
		const older = start;
		const newer = entries.length - end;
		const hintRows = (older > 0 ? 1 : 0) + (newer > 0 ? 1 : 0);
		const messageRows = Math.max(1, maxRows - hintRows);
		const nextStart = Math.max(0, Math.min(selected - Math.floor(messageRows / 2), entries.length - messageRows));
		const nextEnd = Math.min(entries.length, nextStart + messageRows);
		if (nextStart === start && nextEnd === end) break;
		start = nextStart;
		end = nextEnd;
	}

	const lines: string[] = [];
	if (start > 0) lines.push(`↑ ${start} older above`);
	const highlightedIndex = lines.length + selected - start;
	for (let index = start; index < end; index++) {
		lines.push(truncateToWidth(entries[index]!, USER_MESSAGE_PREVIEW_LABEL_WIDTH));
	}
	if (end < entries.length) lines.push(`↓ ${entries.length - end} newer below`);
	return { lines, highlightedIndex };
}
