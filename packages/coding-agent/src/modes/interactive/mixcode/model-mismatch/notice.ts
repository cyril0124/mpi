/**
 * The response-reported model notice: some gateways answer with a concrete model
 * other than the one requested, such as a dated snapshot or a routed alias. The
 * transcript says so under that reply instead of leaving the swap invisible.
 */
import type { AssistantMessage } from "@earendil-works/pi-ai/compat";
import { CURSOR_MARKER, stripTerminalSequences } from "@earendil-works/pi-tui";

const SGR_SEQUENCE = /^\x1b\[[0-9;:]*m$/;

/**
 * Drop raw control bytes and escape sequences from provider-supplied text, so a
 * gateway cannot paint or move the cursor through a model name. Newlines,
 * carriage returns and tabs survive for the caller to collapse; colour sequences
 * and the cursor marker survive for `stripTerminalSequences`. An unterminated
 * escape sequence ends the text there rather than leaving a half-parsed one.
 */
function sanitizeTerminalText(text: string): string {
	let output = "";
	for (let index = 0; index < text.length; index++) {
		const char = text[index]!;
		if (char !== "\x1b") {
			if (isPrintableOrWhitespace(char)) output += char;
			continue;
		}

		const next = text[index + 1];
		if (next === "[") {
			const end = findCsiEnd(text, index + 2);
			if (end === -1) break;
			const sequence = text.slice(index, end + 1);
			if (SGR_SEQUENCE.test(sequence)) output += sequence;
			index = end;
			continue;
		}

		if (next === "]" || next === "P" || next === "X" || next === "^" || next === "_") {
			const end = findStringControlEnd(text, index + 2);
			if (end === -1) break;
			const sequence = text.slice(index, end + 1);
			if (sequence === CURSOR_MARKER) output += sequence;
			index = end;
			continue;
		}

		if (next !== undefined) index++;
	}
	return output;
}

/** Bytes at or above the space, plus the whitespace the caller collapses. */
function isPrintableOrWhitespace(char: string): boolean {
	const code = char.charCodeAt(0);
	return code >= 0x20 || char === "\n" || char === "\r" || char === "\t";
}

/** Index of the byte that ends a CSI sequence, or -1 when it never ends. */
function findCsiEnd(text: string, start: number): number {
	for (let index = start; index < text.length; index++) {
		const code = text.charCodeAt(index);
		if (code >= 0x40 && code <= 0x7e) return index;
	}
	return -1;
}

/** Index of the byte that ends an OSC or APC string, or -1 when it never ends. */
function findStringControlEnd(text: string, start: number): number {
	for (let index = start; index < text.length; index++) {
		if (text[index] === "\x07") return index;
		if (text[index] === "\x1b" && text[index + 1] === "\\") return index + 1;
	}
	return -1;
}

/** A name safe to print: terminal controls removed, whitespace collapsed. */
function toDisplayName(name: string): string {
	return stripTerminalSequences(sanitizeTerminalText(name)).replace(/\s+/g, " ").trim();
}

/**
 * The `[Model mismatch]` line for a finished assistant message, or undefined when
 * the provider echoed the requested name. Names are compared literally, so a
 * different snapshot or gateway alias produces a notice rather than being
 * classified as a substitution.
 */
export function responseModelNoticeText(message: AssistantMessage): string | undefined {
	const reported = message.responseModel;
	const differsFromRequest =
		message.stopReason !== "pending" &&
		typeof reported === "string" &&
		reported.trim().length > 0 &&
		reported !== message.model;
	if (!differsFromRequest) return undefined;

	const reportedName = toDisplayName(reported);
	if (!reportedName) return undefined;
	return `[Model mismatch] requested ${toDisplayName(message.model)} → returned ${reportedName} · via ${toDisplayName(message.provider)}`;
}
