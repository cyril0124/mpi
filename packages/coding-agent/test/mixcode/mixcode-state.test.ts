import fs, { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	forgetOpenTabs,
	openTabsFilePath,
	readOpenTabs,
	readTabMeta,
	replaceOpenTabSessionIds,
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

	it("copies metadata to the canonical id before replacing membership and preserves peer state", () => {
		const recordedId = "recorded";
		const canonicalId = "canonical";
		const peerId = "peer";
		writeOpenTabs(workdir, [peerId, recordedId], recordedId);
		saveTabMeta(workdir, [
			{
				sessionId: recordedId,
				title: "Recovered title",
				color: "blue",
				workdir: join(root, "original-project"),
				titleLocked: true,
				unread: true,
			},
			{ sessionId: peerId, title: "Peer title", color: "green", unread: true },
		]);
		const path = stateFilePath(workdir);
		const state = JSON.parse(readFileSync(path, "utf-8"));
		writeRaw(path, JSON.stringify({ ...state, foreign_extension: { keep: ["unknown", "data"] } }));
		const openPath = openTabsFilePath(workdir);
		const membership = JSON.parse(readFileSync(openPath, "utf-8"));
		writeRaw(openPath, JSON.stringify({ ...membership, peer_extension: { version: 7, order: [peerId] } }));

		const publishedPaths: string[] = [];
		const originalRename = fs.renameSync;
		const rename = vi.spyOn(fs, "renameSync").mockImplementation((from, to) => {
			originalRename(from, to);
			publishedPaths.push(String(to));
		});
		syncBuiltinESMExports();
		try {
			replaceOpenTabSessionIds(workdir, [{ from: recordedId, to: canonicalId }]);
		} finally {
			rename.mockRestore();
			syncBuiltinESMExports();
		}
		expect(publishedPaths).toEqual([path, openPath]);

		expect(readOpenTabs(workdir)).toMatchObject({
			kind: "ok",
			snapshot: { sessionIds: [peerId, canonicalId], activeSessionId: canonicalId },
		});
		expect(readTabMeta(workdir).get(canonicalId)).toEqual({
			sessionId: canonicalId,
			title: "Recovered title",
			color: "blue",
			workdir: join(root, "original-project"),
			titleLocked: true,
			unread: true,
		});
		const migrated = JSON.parse(readFileSync(path, "utf-8"));
		expect(migrated.children).toEqual([peerId, canonicalId]);
		expect(migrated.tab_titles).toMatchObject({ [recordedId]: "Recovered title", [canonicalId]: "Recovered title" });
		expect(migrated.tab_colors).toMatchObject({ [recordedId]: "blue", [canonicalId]: "blue", [peerId]: "green" });
		expect(migrated.workdirs).toMatchObject({
			[recordedId]: join(root, "original-project"),
			[canonicalId]: join(root, "original-project"),
		});
		expect(migrated.tab_title_locked).toMatchObject({ [recordedId]: true, [canonicalId]: true });
		expect(migrated.unseen_done).toEqual([recordedId, peerId, canonicalId]);
		expect(migrated.foreign_extension).toEqual({ keep: ["unknown", "data"] });
		expect(JSON.parse(readFileSync(openPath, "utf-8")).peer_extension).toEqual({ version: 7, order: [peerId] });
	});

	it("does not publish renamed membership when metadata cannot be written", () => {
		writeOpenTabs(workdir, ["recorded", "peer"], "recorded");
		saveTabMeta(workdir, [{ sessionId: "recorded", title: "Retained", unread: true }]);
		const metadataPath = stateFilePath(workdir);
		const membershipPath = openTabsFilePath(workdir);
		const originalMetadata = readFileSync(metadataPath, "utf-8");
		const originalMembership = readFileSync(membershipPath, "utf-8");
		const originalRename = fs.renameSync;
		const failure = new Error("metadata publication failed");
		const rename = vi.spyOn(fs, "renameSync").mockImplementation((from, to) => {
			if (String(to) === metadataPath) throw failure;
			originalRename(from, to);
		});
		syncBuiltinESMExports();
		try {
			expect(() => replaceOpenTabSessionIds(workdir, [{ from: "recorded", to: "canonical" }])).toThrow(failure);
			expect(readFileSync(metadataPath, "utf-8")).toBe(originalMetadata);
			expect(readFileSync(membershipPath, "utf-8")).toBe(originalMembership);
			expect(existsSync(`${metadataPath}.lock`)).toBe(false);
			expect(existsSync(`${membershipPath}.lock`)).toBe(false);
		} finally {
			rename.mockRestore();
			syncBuiltinESMExports();
		}
	});

	it("shares one wait budget across both migration locks and leaves data retryable after timeout", () => {
		writeOpenTabs(workdir, ["recorded", "peer"], "recorded");
		saveTabMeta(workdir, [{ sessionId: "recorded", title: "Retained", color: "blue", unread: true }]);
		const membershipPath = openTabsFilePath(workdir);
		const metadataPath = stateFilePath(workdir);
		const originalMembership = readFileSync(membershipPath, "utf-8");
		const originalMetadata = readFileSync(metadataPath, "utf-8");
		const stateLock = `${metadataPath}.lock`;
		const openLock = `${membershipPath}.lock`;
		const owner = JSON.stringify({ pid: process.pid });
		writeRaw(stateLock, owner);
		writeRaw(openLock, owner);
		let now = 0;
		const clock = vi.spyOn(Date, "now").mockImplementation(() => now);
		const wait = vi.spyOn(Atomics, "wait").mockImplementation(() => {
			now += 1000;
			if (now === 4000) rmSync(stateLock);
			return "timed-out";
		});
		try {
			expect(() => replaceOpenTabSessionIds(workdir, [{ from: "recorded", to: "canonical" }])).toThrow(openLock);
			expect(now).toBe(5000);
			expect(wait).toHaveBeenCalledTimes(5);
			expect(existsSync(stateLock)).toBe(false);
			expect(readFileSync(openLock, "utf-8")).toBe(owner);
			expect(readFileSync(membershipPath, "utf-8")).toBe(originalMembership);
			expect(readFileSync(metadataPath, "utf-8")).toBe(originalMetadata);
		} finally {
			clock.mockRestore();
			wait.mockRestore();
		}
		rmSync(openLock);
		replaceOpenTabSessionIds(workdir, [{ from: "recorded", to: "canonical" }]);
		expect(readOpenTabs(workdir)).toMatchObject({
			kind: "ok",
			snapshot: { sessionIds: ["canonical", "peer"], activeSessionId: "canonical" },
		});
		expect(readTabMeta(workdir).get("canonical")).toMatchObject({ title: "Retained", color: "blue", unread: true });
	});

	it.each([false, true])("keeps explicit destination metadata and an open destination's unread=%s", (targetUnread) => {
		const recordedId = "recorded";
		const canonicalId = "canonical";
		writeOpenTabs(workdir, [recordedId, canonicalId, "peer"], recordedId);
		saveTabMeta(workdir, [
			{ sessionId: recordedId, title: "Recorded title", color: "blue", workdir: "/recorded", unread: !targetUnread },
			{
				sessionId: canonicalId,
				title: "Canonical title",
				color: "red",
				workdir: "/canonical",
				unread: targetUnread,
			},
		]);

		replaceOpenTabSessionIds(workdir, [{ from: recordedId, to: canonicalId }]);

		const state = JSON.parse(readFileSync(stateFilePath(workdir), "utf-8"));
		expect(readOpenTabs(workdir)).toMatchObject({
			kind: "ok",
			snapshot: { sessionIds: [canonicalId, "peer"], activeSessionId: canonicalId },
		});
		expect(readTabMeta(workdir).get(canonicalId)).toMatchObject({
			title: "Canonical title",
			color: "red",
			workdir: "/canonical",
			unread: targetUnread,
		});
		expect(state.unseen_done).toEqual(targetUnread ? [canonicalId] : [recordedId]);
	});

	it("skips stale, repeated, and same-id mappings without rewriting either file", () => {
		const peerId = "peer";
		const recordedId = "recorded";
		const canonicalId = "canonical";
		writeOpenTabs(workdir, [peerId, recordedId], peerId);
		saveTabMeta(workdir, [{ sessionId: recordedId, title: "Keep alias", color: "blue", unread: true }]);
		const openPath = openTabsFilePath(workdir);
		const metaPath = stateFilePath(workdir);
		const membership = JSON.parse(readFileSync(openPath, "utf-8"));
		writeRaw(openPath, JSON.stringify({ ...membership, updatedAt: "2026-01-01T00:00:00.000Z" }));
		const originalOpenTabs = readFileSync(openPath, "utf-8");
		const originalMeta = readFileSync(metaPath, "utf-8");
		replaceOpenTabSessionIds(workdir, [{ from: "stale", to: "new" }]);
		expect(readFileSync(openPath, "utf-8")).toBe(originalOpenTabs);
		expect(readFileSync(metaPath, "utf-8")).toBe(originalMeta);

		replaceOpenTabSessionIds(workdir, [{ from: recordedId, to: canonicalId }]);
		const migratedOpenTabs = readFileSync(openPath, "utf-8");
		const migratedMeta = readFileSync(metaPath, "utf-8");
		replaceOpenTabSessionIds(workdir, [
			{ from: recordedId, to: canonicalId },
			{ from: peerId, to: peerId },
		]);

		expect(readFileSync(openPath, "utf-8")).toBe(migratedOpenTabs);
		expect(readFileSync(metaPath, "utf-8")).toBe(migratedMeta);
		expect(readOpenTabs(workdir)).toMatchObject({
			kind: "ok",
			snapshot: { sessionIds: [peerId, canonicalId], activeSessionId: peerId },
		});
	});

	it("does not create missing cosmetic state or overwrite a corrupt state file", () => {
		const missingSource = "missing-source";
		writeOpenTabs(workdir, [missingSource], missingSource);
		const missingStateFile = stateFilePath(workdir);
		expect(existsSync(missingStateFile)).toBe(false);

		replaceOpenTabSessionIds(workdir, [{ from: missingSource, to: "missing-canonical" }]);
		expect(existsSync(missingStateFile)).toBe(false);
		expect(readOpenTabs(workdir)).toMatchObject({
			kind: "ok",
			snapshot: { sessionIds: ["missing-canonical"], activeSessionId: "missing-canonical" },
		});

		const corruptWorkdir = join(root, "corrupt-project");
		mkdirSync(corruptWorkdir);
		writeOpenTabs(corruptWorkdir, ["corrupt-source"], "corrupt-source");
		const corruptStateFile = stateFilePath(corruptWorkdir);
		const corruptState = "{ malformed cosmetic state";
		writeRaw(corruptStateFile, corruptState);
		replaceOpenTabSessionIds(corruptWorkdir, [{ from: "corrupt-source", to: "corrupt-canonical" }]);

		expect(readFileSync(corruptStateFile, "utf-8")).toBe(corruptState);
		expect(readOpenTabs(corruptWorkdir)).toMatchObject({
			kind: "ok",
			snapshot: { sessionIds: ["corrupt-canonical"], activeSessionId: "corrupt-canonical" },
		});
	});

	it("leaves absent membership and invalid cosmetics intact instead of inventing metadata", () => {
		const path = stateFilePath(workdir);
		const original = {
			children: ["recorded", "peer"],
			tab_titles: ["foreign shape"],
			tab_colors: { recorded: "not-a-color", peer: "green" },
			workdirs: { recorded: 42, peer: "/peer" },
			tab_title_locked: { recorded: "true", peer: true },
			unseen_done: { recorded: true, unknown: ["retain"] },
			foreign_extension: { recorded: "retain" },
		};
		const originalBytes = JSON.stringify(original);
		writeRaw(path, originalBytes);
		replaceOpenTabSessionIds(workdir, [{ from: "recorded", to: "canonical" }]);
		expect(readOpenTabs(workdir)).toEqual({ kind: "missing" });
		expect(readFileSync(path, "utf-8")).toBe(originalBytes);

		writeOpenTabs(workdir, ["recorded", "peer"], "peer");
		replaceOpenTabSessionIds(workdir, [{ from: "recorded", to: "canonical" }]);
		expect(JSON.parse(readFileSync(path, "utf-8"))).toEqual({ ...original, children: ["canonical", "peer"] });
		expect(readTabMeta(workdir).get("canonical")).toEqual({ sessionId: "canonical", unread: false });
		expect(readTabMeta(workdir).get("peer")).toMatchObject({ color: "green", workdir: "/peer", titleLocked: true });
	});

	it("copies only valid missing metadata keys while preserving explicit falsy destinations", () => {
		writeOpenTabs(workdir, ["recorded", "peer"], "recorded");
		const path = stateFilePath(workdir);
		const original = {
			children: ["recorded", "peer"],
			tab_titles: { recorded: "Source title", canonical: "", peer: "Peer title" },
			tab_colors: { recorded: "blue", canonical: null, peer: "green" },
			workdirs: { recorded: workdir, peer: "/peer" },
			tab_title_locked: { recorded: false, peer: true },
			unseen_done: ["canonical", "peer"],
			foreign_extension: { nested: { recorded: "leave unchanged" } },
		};
		writeRaw(path, JSON.stringify(original));

		replaceOpenTabSessionIds(workdir, [{ from: "recorded", to: "canonical" }]);

		expect(JSON.parse(readFileSync(path, "utf-8"))).toEqual({
			...original,
			children: ["canonical", "peer"],
			workdirs: { ...original.workdirs, canonical: workdir },
			tab_title_locked: { ...original.tab_title_locked, canonical: false },
		});
		expect(readTabMeta(workdir).get("canonical")).toEqual({ sessionId: "canonical", workdir, unread: true });
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
