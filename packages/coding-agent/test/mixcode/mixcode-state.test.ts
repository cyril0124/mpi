import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	deleteWorkspaceRecord,
	openTabsFilePath,
	readOpenTabs,
	readTabMeta,
	readWorkspaces,
	resolveSessionPath,
	saveTabLayout,
	scopedStateDir,
	stateFilePath,
	upsertWorkspace,
	workspacesFilePath,
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
		expect(workspacesFilePath(workdir)).toBe(join(scoped, "workspaces.json"));
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
});

describe("mixcode_state.json", () => {
	it("writes the six shared keys and leaves a generated position title out", () => {
		saveTabLayout(workdir, {
			activeSessionId: "s2",
			tabs: [
				{ sessionId: "s1", title: "Agent-01", autoTitle: true, workdir },
				{ sessionId: "s2", title: "chosen", workdir, color: "red", unread: true },
			],
		});
		const state = JSON.parse(readFileSync(stateFilePath(workdir), "utf-8"));
		expect(Object.keys(state).sort()).toEqual([
			"children",
			"startup_workdir",
			"tab_colors",
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
		saveTabLayout(workdir, {
			tabs: [{ sessionId: "s1", title: "Agent-01", workdir }],
		});
		const state = JSON.parse(readFileSync(stateFilePath(workdir), "utf-8"));
		expect(state.tab_titles).toEqual({ s1: "Agent-01" });
	});

	it("drops a color outside the palette and ignores ids that are not open", () => {
		saveTabLayout(workdir, { tabs: [{ sessionId: "s1", title: "tab", workdir }] });
		const path = stateFilePath(workdir);
		const state = JSON.parse(readFileSync(path, "utf-8"));
		state.tab_colors = { s1: "banana", gone: "red" };
		writeRaw(path, JSON.stringify(state));
		const meta = readTabMeta(workdir);
		expect(meta.get("s1")?.color).toBeUndefined();
		expect(meta.has("gone")).toBe(false);
	});
});

describe("workspaces.json", () => {
	const record = (name: string, sessionId = "s1") => ({
		name,
		startup_workdir: workdir,
		updated_at: "2026-01-01T00:00:00.000Z",
		tabs: [{ session_id: sessionId, title: "t", workdir }],
	});

	it("stores a top-level array and replaces a record of the same name", () => {
		upsertWorkspace(workdir, record("beta"));
		upsertWorkspace(workdir, record("alpha"));
		upsertWorkspace(workdir, record("alpha", "s2"));
		const stored = JSON.parse(readFileSync(workspacesFilePath(workdir), "utf-8"));
		expect(Array.isArray(stored)).toBe(true);
		expect(stored.map((item: { name: string }) => item.name)).toEqual(["alpha", "beta"]);
		expect(stored[0].tabs[0].session_id).toBe("s2");
	});

	it("normalizes records on write", () => {
		upsertWorkspace(workdir, {
			name: " padded ",
			startup_workdir: `${workdir}///`,
			updated_at: "2026-01-01T00:00:00.000Z",
			tabs: [
				{ session_id: " s1 ", title: "t", workdir: `${workdir}///` },
				{ session_id: "   ", title: "blank", workdir },
			],
		});
		const [stored] = JSON.parse(readFileSync(workspacesFilePath(workdir), "utf-8"));
		expect(stored.name).toBe("padded");
		expect(stored.startup_workdir).toBe(workdir);
		expect(stored.tabs).toHaveLength(1);
		expect(stored.tabs[0].session_id).toBe("s1");
		expect(stored.tabs[0].workdir).toBe(workdir);
		expect(() => upsertWorkspace(workdir, record("   "))).toThrow(/name/i);
	});

	it("rejects an entry whose tabs are not an array", () => {
		writeRaw(workspacesFilePath(workdir), JSON.stringify([{ name: "broken", tabs: {} }]));
		expect(() => readWorkspaces(workdir)).toThrow(/tabs must be an array/);
	});

	it("deletes by name, removes the file with the last record, and rejects unknown names", () => {
		upsertWorkspace(workdir, record("only"));
		expect(() => deleteWorkspaceRecord(workdir, "missing")).toThrow(/Unknown workspace: missing/);
		deleteWorkspaceRecord(workdir, "only");
		expect(readWorkspaces(workdir)).toEqual([]);
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
