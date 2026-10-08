/**
 * The trash keeps one file per deleted session. Two project directories can hold a
 * session with the same id, and the second delete must not rename its file over the
 * first one.
 */
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { listTrash, moveToTrash, restoreFromTrash, trashDir } from "../../src/core/mixcode/session-trash.ts";

let root: string;
let previousAgentDir: string | undefined;

/** A session file named the way pi writes one: `<timestamp>_<sessionId>.jsonl`. */
function sessionFile(project: string, timestamp: string, sessionId: string, body: string): string {
	const dir = join(root, project, "sessions", `--${project}--`);
	mkdirSync(dir, { recursive: true });
	const file = join(dir, `${timestamp}_${sessionId}.jsonl`);
	writeFileSync(file, `${JSON.stringify({ type: "session", id: sessionId, cwd: join(root, project) })}\n${body}\n`);
	return file;
}

function trashNames(): string[] {
	return readdirSync(trashDir()).sort();
}

function trashContents(): string[] {
	return trashNames().map((name) => readFileSync(join(trashDir(), name), "utf8"));
}

beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), "session-trash-"));
	previousAgentDir = process.env.PI_CODING_AGENT_DIR;
	process.env.PI_CODING_AGENT_DIR = join(root, "agent");
});

afterEach(() => {
	if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
	else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
	rmSync(root, { recursive: true, force: true });
});

describe("session trash", () => {
	it("keeps one file per project when both hold a session with the same id", () => {
		const first = sessionFile("alpha", "2026-10-01T10-00-00-000Z", "shared", "first session");
		const second = sessionFile("beta", "2026-10-02T11-00-00-000Z", "shared", "second session");

		moveToTrash(first, { sessionId: "shared", title: "alpha" });
		moveToTrash(second, { sessionId: "shared", title: "beta" });

		expect(trashNames()).toEqual(["2026-10-01T10-00-00-000Z_shared.jsonl", "2026-10-02T11-00-00-000Z_shared.jsonl"]);
		const bodies = trashContents();
		expect(bodies.some((body) => body.includes("first session"))).toBe(true);
		expect(bodies.some((body) => body.includes("second session"))).toBe(true);
	});

	it("restores the entry that was picked, not the first one with that id", async () => {
		const first = sessionFile("alpha", "2026-10-01T10-00-00-000Z", "shared", "first session");
		const second = sessionFile("beta", "2026-10-02T11-00-00-000Z", "shared", "second session");
		moveToTrash(first, { sessionId: "shared", title: "alpha" });
		moveToTrash(second, { sessionId: "shared", title: "beta" });

		// `beta` is the entry the index lists second, so a restore resolved by session id
		// would move `alpha`'s file back instead.
		const picked = (await listTrash()).find((entry) => entry.title === "beta")!;
		const restored = restoreFromTrash(picked.trashPath);

		expect(restored.originalPath).toBe(second);
		expect(readFileSync(second, "utf8")).toContain("second session");
		expect(existsSync(first)).toBe(false);
	});
});
