/**
 * Terminal-text guard for extension-supplied widget text.
 *
 * A widget renders into the chat frame, so a line it returns must stay on its own
 * row: an escape sequence it did not intend to colour with could move the cursor,
 * clear the screen, or break the column arithmetic the layout already did.
 * SGR colour sequences are the one exception, because styling a widget body is
 * what the sequence is normally there for.
 */
import { CURSOR_MARKER } from "@earendil-works/pi-tui";

/**
 * Keep printable text and SGR colour sequences; drop every other escape
 * sequence and control character.
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

function isPrintableOrWhitespace(char: string): boolean {
	const code = char.charCodeAt(0);
	return code >= 0x20 || char === "\n" || char === "\r" || char === "\t";
}
