/**
 * Delete a session `.jsonl` file: try the `trash` CLI first, then unlink.
 *
 * Shared by the session selector and the multi-tab `/delete-session` command.
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { unlink } from "node:fs/promises";

export interface DeleteSessionResult {
	ok: boolean;
	method: "trash" | "unlink";
	/** False when the path did not exist, so nothing was removed. */
	removed: boolean;
	error?: string;
}

export async function deleteSessionFile(sessionPath: string): Promise<DeleteSessionResult> {
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
