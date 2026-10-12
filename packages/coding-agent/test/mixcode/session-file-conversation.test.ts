/**
 * Reading a session file far enough to tell turns from a placeholder: a restore
 * that rebuilt a deleted session's id writes the header and setup entries only, and
 * the scan has to treat those as empty while it stops at the first real message.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { sessionFileHasConversation } from "../../src/core/mixcode/session-file-conversation.ts";

let root = "";

beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), "session-file-history-"));
});

afterEach(() => {
	rmSync(root, { recursive: true, force: true });
});

/** Write a session file and return its path. */
function writeSession(name: string, lines: string[]): string {
	const filePath = join(root, name);
	writeFileSync(filePath, lines.join("\n"), "utf-8");
	return filePath;
}

/** One setup entry, the shape a rebuilt session holds between header and messages. */
function setupEntry(index: number): string {
	return JSON.stringify({ type: "model_change", id: `s${index}`, parentId: null });
}

describe("sessionFileHasConversation", () => {
	it("reads a header and setup entries as no history", () => {
		const filePath = writeSession("placeholder.jsonl", [
			JSON.stringify({ type: "session", id: "01a1", version: 3 }),
			setupEntry(1),
			setupEntry(2),
			"",
		]);
		expect(sessionFileHasConversation(filePath)).toBe(false);
	});

	it("finds a message entry", () => {
		const filePath = writeSession("chat.jsonl", [
			JSON.stringify({ type: "session", id: "01a1", version: 3 }),
			JSON.stringify({ type: "message", id: "m1", message: { role: "user", content: "hi" } }),
		]);
		expect(sessionFileHasConversation(filePath)).toBe(true);
	});

	it("finds a message entry in a later chunk", () => {
		const lines = [JSON.stringify({ type: "session", id: "01a1", version: 3 })];
		// Well past the 64 KiB read size, so the scan spans several chunks.
		for (let index = 0; index < 4000; index += 1) {
			lines.push(JSON.stringify({ type: "custom", id: `c${index}`, padding: "x".repeat(40) }));
		}
		lines.push(JSON.stringify({ type: "message", id: "m1", message: { role: "user", content: "hi" } }));
		expect(sessionFileHasConversation(writeSession("late.jsonl", lines))).toBe(true);
	});

	it("finds a message entry in a last line without a newline", () => {
		const filePath = join(root, "unterminated.jsonl");
		writeFileSync(
			filePath,
			`${JSON.stringify({ type: "session", id: "01a1", version: 3 })}\n${JSON.stringify({ type: "message", id: "m1", message: { role: "assistant", content: "hi" } })}`,
			"utf-8",
		);
		expect(sessionFileHasConversation(filePath)).toBe(true);
	});

	it("skips malformed lines and reports a missing file as empty", () => {
		const filePath = writeSession("damaged.jsonl", [
			"{not json",
			"",
			JSON.stringify({ type: "session", id: "01a1" }),
		]);
		expect(sessionFileHasConversation(filePath)).toBe(false);
		expect(sessionFileHasConversation(join(root, "gone.jsonl"))).toBe(false);
	});
});
