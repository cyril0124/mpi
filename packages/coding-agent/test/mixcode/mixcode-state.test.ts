import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	forgetOpenTabs,
	openTabsFilePath,
	readOpenTabs,
	readTabMeta,
	resolveSessionPath,
	saveTabMeta,
	scopedStateDir,
	stateFilePath,
	writeOpenTabs,
} from "../../src/core/mixcode/multi-tab/mixcode-state.ts";

/**
 * These files are read and written by mixcode as well, so their paths, key
 * names, and value shapes are an external contract. Each case pins one part.
 */
let root = "";
let workdir = "";

/** Raw write into the scoped directory, creating it when it does not exist yet. */
function writeRaw(path: string, contents: string): void {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, contents, "utf-8");
}

beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), "mixcode-state-"));
	workdir = join(root, "project");
	mkdirSync(workdir, { recursive: true });
	vi.stubEnv("PI_CODING_AGENT_DIR", join(root, "agent"));
});

afterEach(() => {
	vi.unstubAllEnvs();
	rmSync(root, { recursive: true, force: true });
});

describe("state location", () => {
	it("scopes a workdir to a 16-character digest under the shared root", () => {
		const scoped = scopedStateDir(workdir);
		expect(scoped.startsWith(`${join(root, "agent", "mixcode-pi", "workdirs")}/`)).toBe(true);
		expect(scoped.split("/").pop()).toMatch(/^[0-9a-f]{16}$/);
		expect(openTabsFilePath(workdir)).toBe(join(scoped, "open_tabs.json"));
		expect(stateFilePath(workdir)).toBe(join(scoped, "mixcode_state.json"));
	});

	it("normalizes trailing slashes and surrounding whitespace before hashing", () => {
		expect(scopedStateDir(`${workdir}///`)).toBe(scopedStateDir(workdir));
		expect(scopedStateDir(` ${workdir} `)).toBe(scopedStateDir(workdir));
		expect(scopedStateDir(`${workdir}/other`)).not.toBe(scopedStateDir(workdir));
	});
});

describe("open_tabs.json", () => {
	it("round-trips the ordered set and drops blanks and duplicates", () => {
		writeOpenTabs(workdir, ["b", "a", "a", "", "   ", "c"], "b");
		const result = readOpenTabs(workdir);
		expect(result.kind).toBe("ok");
		if (result.kind !== "ok") return;
		expect(result.snapshot.sessionIds).toEqual(["b", "a", "c"]);
		expect(result.snapshot.activeSessionId).toBe("b");
		expect(result.snapshot.version).toBe(1);
		expect(typeof result.snapshot.updatedAt).toBe("string");
	});

	it("reports a missing file as missing and an unreadable one as invalid", () => {
		expect(readOpenTabs(workdir).kind).toBe("missing");
		const path = openTabsFilePath(workdir);
		writeRaw(path, "{ not json");
		expect(readOpenTabs(workdir).kind).toBe("invalid");
		writeRaw(path, JSON.stringify({ version: 1, sessionIds: ["a"] }));
		expect(readOpenTabs(workdir).kind).toBe("invalid");
		writeRaw(path, JSON.stringify({ version: 2, sessionIds: ["a"], updatedAt: "x" }));
		expect(readOpenTabs(workdir).kind).toBe("invalid");
		writeRaw(path, JSON.stringify({ version: 1, sessionIds: [1], updatedAt: "x" }));
		expect(readOpenTabs(workdir).kind).toBe("invalid");
	});

	it("refuses to overwrite a snapshot it cannot read", () => {
		const path = openTabsFilePath(workdir);
		writeRaw(path, "{ not json");
		expect(() => writeOpenTabs(workdir, ["new"])).toThrow(/open_tabs\.json/);
		expect(readFileSync(path, "utf-8")).toBe("{ not json");
	});

	it("forgets named sessions without touching the rest of the set", () => {
		writeOpenTabs(workdir, ["a", "b", "c"], "b");
		forgetOpenTabs(workdir, ["b", "  ", "gone"]);
		const result = readOpenTabs(workdir);
		expect(result.kind).toBe("ok");
		if (result.kind !== "ok") return;
		expect(result.snapshot.sessionIds).toEqual(["a", "c"]);
		// The dropped id was the active one, so the snapshot carries no active tab.
		expect(result.snapshot.activeSessionId).toBeUndefined();
	});
});

describe("mixcode_state.json", () => {
	it("writes the shared keys and leaves a generated position title out", () => {
		writeOpenTabs(workdir, ["s1", "s2"], "s2");
		saveTabMeta(workdir, [
			{ sessionId: "s1", title: "Agent-01", autoTitle: true, workdir },
			{ sessionId: "s2", title: "chosen", workdir, color: "red", unread: true },
		]);
		const state = JSON.parse(readFileSync(stateFilePath(workdir), "utf-8"));
		expect(Object.keys(state).sort()).toEqual([
			"children",
			"startup_workdir",
			"tab_colors",
			"tab_title_locked",
			"tab_titles",
			"unseen_done",
			"workdirs",
		]);
		expect(state.children).toEqual(["s1", "s2"]);
		expect(state.tab_titles).toEqual({ s2: "chosen" });
		expect(state.tab_colors).toEqual({ s2: "red" });
		expect(state.unseen_done).toEqual(["s2"]);
		expect(state.workdirs).toEqual({ s1: workdir, s2: workdir });
	});

	it("keeps a title the user typed that looks like a generated one", () => {
		saveTabMeta(workdir, [{ sessionId: "s1", title: "Agent-01", workdir }]);
		const state = JSON.parse(readFileSync(stateFilePath(workdir), "utf-8"));
		expect(state.tab_titles).toEqual({ s1: "Agent-01" });
	});

	it("drops a color outside the palette and ignores ids that are not open", () => {
		saveTabMeta(workdir, [{ sessionId: "s1", title: "tab", workdir }]);
		const path = stateFilePath(workdir);
		const state = JSON.parse(readFileSync(path, "utf-8"));
		state.tab_colors = { s1: "banana", gone: "red" };
		writeRaw(path, JSON.stringify(state));
		const meta = readTabMeta(workdir);
		expect(meta.get("s1")?.color).toBeUndefined();
		expect(meta.has("gone")).toBe(false);
	});
});

describe("session file resolution", () => {
	it("returns the newest file for an id and ignores unrelated names", () => {
		const dir = join(root, "sessions");
		mkdirSync(dir, { recursive: true });
		writeFileSync(join(dir, "2026-01-01T00-00-00-000Z_abc.jsonl"), "", "utf-8");
		writeFileSync(join(dir, "2026-02-01T00-00-00-000Z_abc.jsonl"), "", "utf-8");
		writeFileSync(join(dir, "2026-03-01T00-00-00-000Z_other.jsonl"), "", "utf-8");
		writeFileSync(join(dir, "abc.jsonl"), "", "utf-8");
		expect(resolveSessionPath(dir, "abc")).toBe(join(dir, "2026-02-01T00-00-00-000Z_abc.jsonl"));
		expect(resolveSessionPath(dir, "gone")).toBeUndefined();
		expect(resolveSessionPath(join(root, "absent"), "abc")).toBeUndefined();
	});
});
