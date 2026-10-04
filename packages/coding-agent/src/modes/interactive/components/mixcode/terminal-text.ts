/**
 * Terminal-text guard for text the fork prints that it did not author: extension
 * widget rows and provider-supplied names.
 *
 * Such text must stay on its own row and inside its columns: an escape sequence
 * it did not intend to colour with could move the cursor, clear the screen, or
 * break the column arithmetic the layout already did. SGR colour sequences are
 * the one exception, because styling is what the sequence is normally there for;
 * the cursor marker is the second, because the renderer reads it back out.
 */
import { CURSOR_MARKER } from "@earendil-works/pi-tui";

/**
 * Keep printable text, SGR colour sequences and the cursor marker; drop every
 * other escape sequence and control character. Newlines, carriage returns and
 * tabs survive for the caller to collapse. An unterminated escape sequence ends
 * the text there rather than leaving a half-parsed one.
 */
export function sanitizeTerminalText(text: string): string {
	let output = "";
	for (let index = 0; index < text.length; index += 1) {
		const char = text[index];
		if (char !== "\x1b") {
			if (char !== undefined && isPrintableOrWhitespace(char)) output += char;
			continue;
		}

		const next = text[index + 1];
		if (next === "[") {
			const end = findCsiEnd(text, index + 2);
			if (end === -1) break;
			const sequence = text.slice(index, end + 1);
			if (isSgrSequence(sequence)) output += sequence;
			index = end;
			continue;
		}

		if (next === "]" || next === "P" || next === "X" || next === "^" || next === "_") {
			const end = findStringControlEnd(text, index + 2);
			if (end === -1) break;
			const sequence = text.slice(index, end + 1);
			// The focused-input marker is the one string-control sequence the
			// renderer reads back out, so it survives.
			if (sequence === CURSOR_MARKER) output += sequence;
			index = end;
			continue;
		}

		// A lone ESC, or one introducing something unrecognized: drop the ESC and
		// let the next character be handled on its own.
		if (next !== undefined) index += 1;
	}
	return output;
}

/** First byte that ends a CSI sequence: any final byte in `0x40`-`0x7e`. */
function findCsiEnd(text: string, start: number): number {
	for (let index = start; index < text.length; index += 1) {
		const code = text.charCodeAt(index);
		if (code >= 0x40 && code <= 0x7e) return index;
	}
	return -1;
}

function isSgrSequence(sequence: string): boolean {
	return /^\x1b\[[0-9;:]*m$/.test(sequence);
}

/** First BEL or ST that ends an OSC, DCS, SOS, PM or APC sequence. */
function findStringControlEnd(text: string, start: number): number {
	for (let index = start; index < text.length; index += 1) {
		if (text[index] === "\x07") return index;
		if (text[index] === "\x1b" && text[index + 1] === "\\") return index + 1;
	}
	return -1;
}

/** Printable characters start at U+0020; DEL and the C0 controls are not printable. */
function isPrintableOrWhitespace(char: string): boolean {
	const code = char.charCodeAt(0);
	// Newline, carriage return and tab survive for the caller to collapse; every
	// other control character, DEL included, is dropped.
	if (code === 0x7f) return false;
	return code >= 0x20 || char === "\n" || char === "\r" || char === "\t";
}

/**
 * Matches any SGR sequence, including the resets that end a paint (`0`, `22`,
 * `27`, `39`, `49`) and 256-color or truecolor selections.
 */
export const SGR_SEQUENCE = /\x1b\[[0-9;:]*m/g;

/**
 * Matches only the SGR sequences that turn an attribute back off: a full reset,
 * and the individual closes for bold, inverse, foreground, and background.
 */
export const SGR_RESET_SEQUENCE = /\x1b\[(?:0|22|27|39|49)m/g;

/**
 * Wrap `text` in `open`, re-opening `open` after every reset the text carries: an
 * inner reset would otherwise end the paint early, leaving a background,
 * underline, or chip color covering only the text before it. Sequences that open
 * a style are left alone, so a nested foreground keeps its own color until it
 * resets.
 */
export function reopenAfterReset(open: string, text: string): string {
	return `${open}${text.replace(SGR_RESET_SEQUENCE, (sequence) => `${sequence}${open}`)}`;
}
