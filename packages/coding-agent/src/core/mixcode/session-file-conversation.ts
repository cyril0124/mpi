/**
 * Tell a session file that holds conversation turns from one that holds none.
 *
 * A session file can exist with only its header and setup entries: a restore that
 * rebuilt a deleted session's id, or a tab whose first message never came. Reading
 * the turns decides whether the file is someone's work or a placeholder. The scan
 * stops at the first message entry and reads each byte once, so a long conversation
 * costs one pass over its lines.
 */
import { closeSync, existsSync, openSync, readSync } from "node:fs";
import { StringDecoder } from "node:string_decoder";

/** Bytes per read while scanning for the first message entry. */
const CONVERSATION_SCAN_CHUNK_BYTES = 64 * 1024;

/**
 * True when the session file at `filePath` holds at least one message entry. A missing file holds
 * none. A path that exists but cannot be read throws, and the caller decides what that means:
 * answering false would send an unreadable file to the trash.
 */
export function sessionFileHasConversation(filePath: string): boolean {
	if (!existsSync(filePath)) return false;
	const fd = openSync(filePath, "r");
	try {
		const decoder = new StringDecoder("utf8");
		const buffer = Buffer.allocUnsafe(CONVERSATION_SCAN_CHUNK_BYTES);
		// The line being read, kept as fragments: a line longer than one chunk must not be
		// re-scanned and re-flattened on every read.
		let parts: string[] = [];
		for (;;) {
			const bytesRead = readSync(fd, buffer, 0, buffer.length, null);
			const text = bytesRead === 0 ? decoder.end() : decoder.write(buffer.subarray(0, bytesRead));
			const scan = scanCompleteLines(text, parts);
			parts = scan.rest;
			if (scan.foundMessage) return true;
			// The last read consumed the file: whatever is left is a line without a final newline.
			if (bytesRead === 0) return isMessageEntryLine(parts.join(""));
		}
	} finally {
		closeSync(fd);
	}
}

/** Scan every complete line of `chunk`, returning the fragments of the trailing partial line. */
function scanCompleteLines(chunk: string, parts: string[]): { foundMessage: boolean; rest: string[] } {
	let from = 0;
	for (;;) {
		const lineEnd = chunk.indexOf("\n", from);
		if (lineEnd === -1) {
			if (chunk.length > from) parts.push(chunk.slice(from));
			return { foundMessage: false, rest: parts };
		}
		const tail = chunk.slice(from, lineEnd);
		const line = parts.length === 0 ? tail : parts.join("") + tail;
		parts = [];
		from = lineEnd + 1;
		if (isMessageEntryLine(line)) return { foundMessage: true, rest: parts };
	}
}

/** A malformed or non-JSON line is not a message entry: the scan keeps looking. */
function isMessageEntryLine(line: string): boolean {
	if (!line.trim()) return false;
	try {
		const entry = JSON.parse(line) as { type?: unknown };
		return entry.type === "message";
	} catch {
		return false;
	}
}
