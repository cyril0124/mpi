import type { TuiSelectionLine } from "./selection-types.ts";

/** Any SGR sequence, including colon-separated parameters. */
const SGR_SEQUENCE_PATTERN = /\x1b\[[0-9;:]*m/g;
/** Sentinel a selection wrap is probed with to read its opening sequence. */
const SELECTION_STYLE_PROBE = "\x01";

/**
 * Apply a host selection wrap to one line, re-opening its style after every SGR inside the
 * slice so an inner reset cannot drop it. The wrap is probed with a sentinel to read its
 * opening sequence, so the host keeps a plain `(text, line) => string`.
 */
export function applyHostSelectionHighlight(
	highlight: (text: string, line: TuiSelectionLine) => string,
	text: string,
	line: TuiSelectionLine,
): string {
	const marked = highlight(SELECTION_STYLE_PROBE, line);
	const index = marked.indexOf(SELECTION_STYLE_PROBE);
	const open = index > 0 ? marked.slice(0, index) : "";
	if (!open || !text.includes("\x1b")) return highlight(text, line);
	return highlight(
		text.replace(SGR_SEQUENCE_PATTERN, (sequence) => `${sequence}${open}`),
		line,
	);
}
