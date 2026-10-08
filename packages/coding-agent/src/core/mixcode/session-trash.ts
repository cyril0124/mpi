/**
 * Soft delete for session files.
 *
 * Deleting a session moves its `.jsonl` into `<stateDir>/trash/` and records it in
 * `trash-index.jsonl`, so an accidental `/delete-session` can be undone with
 * `/resume-trash`. The trash is capped at 2 GiB: once the indexed size exceeds the
 * cap, the oldest entries are evicted first.
 *
 * The state directory is the one this fork shares with mixcode-pi, so both agents
 * read the same trash. Every move and every index read-modify-write runs inside one
 * `<file>.lock` section, so a file that moves into the trash always lands in the
 * index, and two instances writing the same index cannot drop an entry.
 *
 * A file keeps its own name in the trash: the session id is not unique across project
 * directories, so a name built from it alone would let one delete overwrite another.
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, statSync, unlinkSync } from "node:fs";
import { basename, dirname, join, resolve, sep } from "node:path";
import { atomicWrite, mixcodeRootStateDir, withStateLock } from "./multi-tab/mixcode-state.ts";

export interface TrashEntry {
	sessionId: string;
	title: string;
	/** ISO 8601. */
	deletedAt: string;
	originalPath: string;
	trashPath: string;
	/** Bytes. */
	size: number;
}

/** Total trash size cap; the oldest entries are evicted first when exceeded. */
export const TRASH_SIZE_LIMIT_BYTES = 2 * 1024 * 1024 * 1024;

/** `<stateDir>/trash`: where soft-deleted session files live. */
export function trashDir(): string {
	return join(mixcodeRootStateDir(), "trash");
}

/** `<stateDir>/trash-index.jsonl`: metadata for the files in the trash dir. */
export function trashIndexPath(): string {
	return join(mixcodeRootStateDir(), "trash-index.jsonl");
}

/**
 * True when the path names a file inside the trash dir. Paths are compared
 * resolved, as given, with no symlink resolution.
 */
export function isInTrash(file: string): boolean {
	return resolve(file).startsWith(resolve(trashDir()) + sep);
}

/**
 * Move a session file into the trash and record it in the index, then enforce the
 * size cap. The whole step runs under the index lock. Works across filesystems: a
 * rename that fails with `EXDEV` is retried as a copy plus unlink.
 */
export function moveToTrash(file: string, meta: { sessionId: string; title: string }): void {
	withStateLock(indexLockPath(), () => {
		const size = statSync(file).size;
		// A session past the cap would be evicted by its own move, so refuse it here: the
		// caller then reports the permanent fallback instead of a restorable move.
		if (size > TRASH_SIZE_LIMIT_BYTES) throw new Error("Session is larger than the trash size limit");
		mkdirSync(trashDir(), { recursive: true });
		const trashPath = trashPathFor(file);
		movePath(file, trashPath);

		const entry: TrashEntry = {
			sessionId: meta.sessionId,
			title: meta.title,
			deletedAt: new Date().toISOString(),
			originalPath: file,
			trashPath,
			size,
		};
		// Re-trashing the same session replaces its old entry instead of stacking a
		// second one that no restore could pair with a file.
		const entries = readIndex().filter((item) => item.trashPath !== trashPath);
		entries.push(entry);
		// The entry lands before eviction runs: an eviction that fails partway must
		// not leave the file that just moved in without an index entry.
		writeIndex(entries);
		evictOverLimit(entries);
	});
}

/**
 * Drop one file from the trash for good, removing every index entry that points
 * at it. Deleting a row in the `/resume-trash` selector lands here: the file is
 * already in the trash, so this is the permanent half of the recycle bin.
 * Returns false when the file was already gone.
 */
export function purgeFromTrash(trashPath: string): boolean {
	return withStateLock(indexLockPath(), () => {
		let removed = true;
		try {
			unlinkSync(trashPath);
		} catch (error) {
			if (!isErrno(error, "ENOENT")) throw error;
			removed = false;
		}
		writeIndex(readIndex().filter((entry) => entry.trashPath !== trashPath));
		return removed;
	});
}

/** Trashed sessions, newest first. */
export async function listTrash(): Promise<TrashEntry[]> {
	return readIndex().sort((a, b) => Date.parse(b.deletedAt) - Date.parse(a.deletedAt));
}

/**
 * Restore a trashed session to its original path and drop its index entry, under
 * the index lock. Throws when the trash path has no entry.
 */
export function restoreFromTrash(trashPath: string): TrashEntry {
	return withStateLock(indexLockPath(), () => {
		const entries = readIndex();
		const index = entries.findIndex((entry) => entry.trashPath === trashPath);
		if (index < 0) throw new Error(`Trash file ${trashPath} not found`);

		const entry = entries[index]!;
		mkdirSync(dirname(entry.originalPath), { recursive: true });
		movePath(entry.trashPath, entry.originalPath);

		entries.splice(index, 1);
		writeIndex(entries);
		return entry;
	});
}

/**
 * Where a session file lands in the trash: its own name, because `<sessionId>.jsonl` is not
 * unique across project directories, and the second delete would overwrite the first file.
 * A name another file already holds takes a numeric suffix.
 */
function trashPathFor(file: string): string {
	const stem = basename(file).replace(/\.jsonl$/, "");
	let candidate = join(trashDir(), `${stem}.jsonl`);
	for (let suffix = 2; existsSync(candidate); suffix += 1) {
		candidate = join(trashDir(), `${stem}-${suffix}.jsonl`);
	}
	return candidate;
}

/** Rename across filesystems by copying and unlinking. */
function movePath(from: string, to: string): void {
	try {
		renameSync(from, to);
	} catch (error) {
		if (!isErrno(error, "EXDEV")) throw error;
		copyFileSync(from, to);
		unlinkSync(from);
	}
}

/** Cap the indexed size at `TRASH_SIZE_LIMIT_BYTES`, dropping the oldest files. */
function evictOverLimit(entries: TrashEntry[]): void {
	const oldestFirst = entries.slice().sort((a, b) => Date.parse(a.deletedAt) - Date.parse(b.deletedAt));
	let totalSize = oldestFirst.reduce((sum, entry) => sum + entry.size, 0);

	const evicted = new Set<string>();
	for (const entry of oldestFirst) {
		if (totalSize <= TRASH_SIZE_LIMIT_BYTES) break;
		try {
			unlinkSync(entry.trashPath);
		} catch (error) {
			// Best effort: a file that cannot be removed keeps its entry, and eviction
			// stops there rather than deleting newer sessions behind it. Dropping the
			// entry would lose the file with nothing pointing at it, and cascading
			// would turn an unwritable trash into a delete of the newest session.
			if (!isErrno(error, "ENOENT")) break;
		}
		evicted.add(entry.trashPath);
		totalSize -= entry.size;
	}

	if (evicted.size > 0) writeIndex(entries.filter((entry) => !evicted.has(entry.trashPath)));
}

/** `<stateDir>/trash-index.jsonl.lock`: the lock guarding the index. */
function indexLockPath(): string {
	return `${trashIndexPath()}.lock`;
}

function readIndex(): TrashEntry[] {
	let text: string;
	try {
		text = readFileSync(trashIndexPath(), "utf8");
	} catch (error) {
		if (isErrno(error, "ENOENT")) return [];
		throw error;
	}
	const entries: TrashEntry[] = [];
	for (const line of text.split("\n")) {
		if (line.trim().length === 0) continue;
		try {
			entries.push(JSON.parse(line) as TrashEntry);
		} catch {
			// A damaged line is skipped rather than failing the caller: the file it
			// described is still in the trash dir, and the next write drops the line.
		}
	}
	return entries;
}

function writeIndex(entries: TrashEntry[]): void {
	const text = entries.map((entry) => JSON.stringify(entry)).join("\n");
	atomicWrite(trashIndexPath(), text.length > 0 ? `${text}\n` : "");
}

function isErrno(error: unknown, code: string): boolean {
	return (error as NodeJS.ErrnoException).code === code;
}
