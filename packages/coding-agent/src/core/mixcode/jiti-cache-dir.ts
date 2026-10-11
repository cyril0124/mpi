/**
 * Where jiti keeps its disk cache of transformed extension modules, and how that cache is trimmed.
 *
 * jiti's own default is `<os.tmpdir()>/jiti`, which is wrong on a shared host: `/tmp` is not the
 * user's own space, and that directory can already exist and belong to another user. jiti turns
 * `fsCache` off when its probe of that directory fails, so the cache silently disappears and every
 * boot re-transforms every extension in pure JS.
 *
 * The cache therefore lives under the agent dir, beside the other `<agentDir>/cache/<owner>`
 * directories. It is persistent, so it may sit on a network filesystem and cost a few hundred
 * milliseconds to read at boot; that is still cheaper than re-transforming extensions. Entries are
 * keyed by module path, so a deleted or renamed module leaves its file behind forever, which is why
 * stale entries are trimmed by write time.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { getAgentDir } from "../../config.ts";

/**
 * The extensions jiti writes for cached transforms. It appends an `x` when its jsx option is on, so
 * the `.mjsx`/`.cjsx` spellings are reachable through `JITI_JSX=1`. Anything else in the directory
 * is left alone.
 */
const CACHE_FILE_EXTENSIONS = [".mjs", ".cjs", ".mjsx", ".cjsx"];

/** Entries last written more than this long ago are dropped. */
export const MAX_ENTRY_AGE_MS = 30 * 24 * 60 * 60 * 1000;

/** Trimming runs at most this often, across processes, gated by {@link CLEANUP_MARKER}. */
export const CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000;

const CLEANUP_MARKER = ".cleanup-marker";

/**
 * Drop cache entries whose write time is older than {@link MAX_ENTRY_AGE_MS}. Bounded by
 * {@link CLEANUP_INTERVAL_MS} so many short-lived processes do not each walk the directory.
 *
 * Best effort, and unsynchronized with other processes: jiti tests `existsSync` and then reads
 * without a catch, so a boot starting while this walk runs can fail one extension load for that
 * boot rather than re-transform it. The walk is short and runs at most once per day.
 */
function trimStaleEntries(cacheDir: string): void {
	try {
		const marker = path.join(cacheDir, CLEANUP_MARKER);
		const lastRun = fs.statSync(marker, { throwIfNoEntry: false })?.mtimeMs ?? 0;
		if (Date.now() - lastRun < CLEANUP_INTERVAL_MS) {
			return;
		}
		// Claim the interval before walking, so a crash halfway through does not retry every boot.
		fs.writeFileSync(marker, "");

		const cutoff = Date.now() - MAX_ENTRY_AGE_MS;
		for (const name of fs.readdirSync(cacheDir)) {
			if (!CACHE_FILE_EXTENSIONS.includes(path.extname(name))) {
				continue;
			}
			const entry = path.join(cacheDir, name);
			try {
				if (fs.statSync(entry).mtimeMs < cutoff) {
					fs.rmSync(entry, { force: true });
				}
			} catch {
				// Another process removed the entry first.
			}
		}
	} catch {
		// An unusable cache dir is not worth failing startup over; the next boot tries again.
	}
}

/** Cache dirs already proven writable in this process, so the probe stays off the hot path. */
const writableCacheDirs = new Set<string>();

/**
 * The directory to hand jiti as its `cache` option, or `false` to run without a disk cache when the
 * agent dir cannot hold one. Never falls back to the shared tmpdir.
 */
export function resolveJitiCacheDir(): string | false {
	const cacheDir = path.join(getAgentDir(), "cache", "jiti");
	if (!writableCacheDirs.has(cacheDir)) {
		try {
			fs.mkdirSync(cacheDir, { recursive: true });
			// `accessSync(W_OK)` does not prove that jiti's later `writeFileSync` succeeds (an
			// exhausted quota, a revoked network mount, Windows ACLs), and jiti does not catch that
			// failure, so prove it by writing. The probe name keeps it out of the trim.
			const probe = path.join(cacheDir, ".write-probe");
			fs.writeFileSync(probe, "");
			fs.rmSync(probe, { force: true });
		} catch {
			return false;
		}
		writableCacheDirs.add(cacheDir);
	}

	trimStaleEntries(cacheDir);
	return cacheDir;
}
