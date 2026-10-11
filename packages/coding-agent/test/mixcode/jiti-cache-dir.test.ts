import {
	chmodSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	rmSync,
	statSync,
	utimesSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CLEANUP_INTERVAL_MS, MAX_ENTRY_AGE_MS, resolveJitiCacheDir } from "../../src/core/mixcode/jiti-cache-dir.ts";

const realAgentDir = process.env.PI_CODING_AGENT_DIR;
const realRuntimeDir = process.env.XDG_RUNTIME_DIR;
const realTmpdir = process.env.TMPDIR;
let root: string;
let agentDir: string;
let runtimeDir: string;
let cacheDir: string;

/** Narrow the option to a path, the way the jiti call sites consume it. */
function cacheDirOrFail(): string {
	const cacheDir = resolveJitiCacheDir();
	if (cacheDir === false) {
		throw new Error("expected a writable cache directory");
	}
	return cacheDir;
}

/** Write a jiti-style cache entry with an explicit age. */
function writeEntry(name: string, ageMs: number): string {
	const entry = join(cacheDir, name);
	writeFileSync(entry, "// cached transform\n");
	const stamp = new Date(Date.now() - ageMs);
	utimesSync(entry, stamp, stamp);
	return entry;
}

/** Backdate the cleanup marker so the next resolve is allowed to trim. */
function openCleanupInterval(): void {
	const marker = join(cacheDir, ".cleanup-marker");
	const stamp = new Date(Date.now() - CLEANUP_INTERVAL_MS - 1000);
	utimesSync(marker, stamp, stamp);
}

beforeEach(() => {
	root = mkdtempSync(join(realTmpdir ?? "/tmp", "jiti-cache-dir-test-"));
	agentDir = join(root, "agent");
	runtimeDir = join(root, "runtime");
	mkdirSync(agentDir);
	// A real session has a runtime dir, so the fixture has one too and the tests assert it stays empty.
	mkdirSync(runtimeDir);
	cacheDir = join(agentDir, "cache", "jiti");
	process.env.PI_CODING_AGENT_DIR = agentDir;
	process.env.XDG_RUNTIME_DIR = runtimeDir;
});

afterEach(() => {
	for (const [name, value] of [
		["PI_CODING_AGENT_DIR", realAgentDir],
		["XDG_RUNTIME_DIR", realRuntimeDir],
		["TMPDIR", realTmpdir],
	] as const) {
		if (value === undefined) {
			delete process.env[name];
		} else {
			process.env[name] = value;
		}
	}
	rmSync(root, { recursive: true, force: true });
});

describe("resolveJitiCacheDir", () => {
	it("creates the cache under the agent dir and writes nothing into the runtime dir", () => {
		expect(cacheDirOrFail()).toBe(cacheDir);

		expect(statSync(cacheDir).isDirectory()).toBe(true);
		expect(readdirSync(runtimeDir)).toEqual([]);
	});

	it("disables the cache instead of using a shared tmpdir", () => {
		// Pin the tmpdir to a directory that looks exactly like the one jiti would have used.
		const shared = join(root, "shared-tmp");
		mkdirSync(join(shared, "jiti"), { recursive: true });
		process.env.TMPDIR = shared;
		process.env.PI_CODING_AGENT_DIR = join(root, "occupied-by-a-file");
		writeFileSync(process.env.PI_CODING_AGENT_DIR, "");

		// `false` disables jiti's disk cache; it never falls back to the shared tmpdir.
		expect(resolveJitiCacheDir()).toBe(false);
		expect(readdirSync(join(shared, "jiti"))).toEqual([]);
	});

	it.skipIf(process.getuid?.() === 0)("disables the cache when the cache dir cannot be written", () => {
		mkdirSync(cacheDir, { recursive: true });
		chmodSync(cacheDir, 0o500);

		try {
			expect(resolveJitiCacheDir()).toBe(false);
		} finally {
			chmodSync(cacheDir, 0o700);
		}
	});

	it("drops entries older than the cutoff and keeps everything else", () => {
		cacheDirOrFail();
		openCleanupInterval();
		const stale = writeEntry("stale.abc123.mjs", MAX_ENTRY_AGE_MS + 60_000);
		const staleCjs = writeEntry("stale.def456.cjs", MAX_ENTRY_AGE_MS + 60_000);
		const staleJsx = writeEntry("stale.jkl012.mjsx", MAX_ENTRY_AGE_MS + 60_000);
		const fresh = writeEntry("fresh.ghi789.cjs", MAX_ENTRY_AGE_MS - 60_000);
		const foreign = writeEntry("notes.txt", MAX_ENTRY_AGE_MS + 60_000);

		cacheDirOrFail();

		expect(existsSync(stale)).toBe(false);
		expect(existsSync(staleCjs)).toBe(false);
		expect(existsSync(staleJsx)).toBe(false);
		expect(existsSync(fresh)).toBe(true);
		expect(existsSync(foreign)).toBe(true);
	});

	it("keeps stale entries while the cleanup interval is still open", () => {
		cacheDirOrFail();
		const stale = writeEntry("stale.abc123.mjs", MAX_ENTRY_AGE_MS + 60_000);

		cacheDirOrFail();

		expect(existsSync(stale)).toBe(true);
	});
});
