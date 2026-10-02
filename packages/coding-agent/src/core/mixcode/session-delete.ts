/**
 * Delete a session `.jsonl` file: move it to the fork's own trash first, then try
 * the `trash` CLI, then unlink.
 *
 * The first step is what `/resume-trash` reads back; the other two only run when
 * the session cannot be moved (for example a full disk), so a delete never leaves
 * the session half-removed.
 *
 * Shared by the session selector and the multi-tab `/delete-session` command.
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { unlink } from "node:fs/promises";
import { basename } from "node:path";
import { isInTrash, moveToTrash, purgeFromTrash } from "./session-trash.ts";

export interface DeleteSessionResult {
	ok: boolean;
	method: "mixcode-trash" | "trash" | "unlink";
	/** False when the path did not exist, so nothing was removed. */
	removed: boolean;
	error?: string;
}

/** Optional metadata for the trash index entry. */
export interface DeleteSessionMeta {
	/** Tab or session display name; falls back to the session id. */
	title?: string;
}

/** Delete a session file, moving it to the fork's trash when possible. */
export async function deleteSessionFile(sessionPath: string, meta?: DeleteSessionMeta): Promise<DeleteSessionResult> {
	const sessionId = sessionIdFromPath(sessionPath);
	// A path already in the trash is the permanent half of the recycle bin.
	if (isInTrash(sessionPath)) {
		try {
			return { ok: true, method: "unlink", removed: purgeFromTrash(sessionPath) };
		} catch (error) {
			return {
				ok: false,
				method: "unlink",
				removed: false,
				error: error instanceof Error ? error.message : String(error),
			};
		}
	}
	try {
		moveToTrash(sessionPath, { sessionId, title: meta?.title?.trim() || sessionId });
		return { ok: true, method: "mixcode-trash", removed: true };
	} catch {
		// Fall through to the system trash CLI, then a permanent unlink.
	}

	const existed = existsSync(sessionPath);
	const done = (method: "trash" | "unlink"): DeleteSessionResult => ({ ok: true, method, removed: existed });

	// Try `trash` first (if installed)
	const trashArgs = sessionPath.startsWith("-") ? ["--", sessionPath] : [sessionPath];
	const trashResult = spawnSync("trash", trashArgs, { encoding: "utf-8" });

	const getTrashErrorHint = (): string | null => {
		const parts: string[] = [];
		if (trashResult.error) {
			parts.push(trashResult.error.message);
		}
		const stderr = trashResult.stderr?.trim();
		if (stderr) {
			parts.push(stderr.split("\n")[0] ?? stderr);
		}
		if (parts.length === 0) return null;
		return `trash: ${parts.join(" · ").slice(0, 200)}`;
	};

	// If trash reports success, or the file is gone afterwards, treat it as successful
	if (trashResult.status === 0 || !existsSync(sessionPath)) {
		return done("trash");
	}

	// Fallback to permanent deletion
	try {
		await unlink(sessionPath);
		return done("unlink");
	} catch (err) {
		const unlinkError = err instanceof Error ? err.message : String(err);
		const trashErrorHint = getTrashErrorHint();
		const error = trashErrorHint ? `${unlinkError} (${trashErrorHint})` : unlinkError;
		return { ok: false, method: "unlink", removed: false, error };
	}
}

/** Session files are named `<timestamp>_<sessionId>.jsonl`; keep the id part. */
function sessionIdFromPath(sessionPath: string): string {
	const stem = basename(sessionPath).replace(/\.jsonl$/, "");
	const separator = stem.indexOf("_");
	return separator < 0 ? stem : stem.slice(separator + 1);
}
