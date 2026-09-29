/**
 * Two ways a session's working directory reaches disk.
 *
 * Reopening a session at another directory keeps that directory in memory only,
 * so a later resume of the same file would read the old directory back out of the
 * header and start there. `persistSessionCwd` rewrites that header, through a
 * temporary file and a rename, so a crash midway cannot leave a half-written
 * session behind. A file that does not parse as a session is left untouched, and
 * the error is reported to the caller.
 *
 * A session started without a file has no header to rewrite, so
 * `writeSessionFile` writes the whole file the move needs under a header that
 * records the new directory.
 */
import { existsSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
	CURRENT_SESSION_VERSION,
	getDefaultSessionDir,
	type SessionEntry,
	type SessionHeader,
} from "../session-manager.ts";

/** Set the session header's `cwd` to `cwd`, leaving every other entry as it was. */
export async function persistSessionCwd(sessionFile: string, cwd: string): Promise<void> {
	if (!existsSync(sessionFile)) return;
	const text = await readFile(sessionFile, "utf-8");
	const newline = text.indexOf("\n");
	const firstLine = newline === -1 ? text : text.slice(0, newline);
	const rest = newline === -1 ? "\n" : text.slice(newline);

	let header: unknown;
	try {
		header = JSON.parse(firstLine);
	} catch (error) {
		throw new Error(`Invalid session header in ${sessionFile}`, { cause: error });
	}
	if (!isSessionHeader(header)) throw new Error(`Session file is missing a session header: ${sessionFile}`);
	if (header.cwd === cwd) return;

	const temporary = `${sessionFile}.${process.pid}.tmp`;
	await writeFile(temporary, `${JSON.stringify({ ...header, cwd })}${rest}`);
	await rename(temporary, sessionFile);
}

function isSessionHeader(value: unknown): value is { type: "session"; cwd?: string } {
	return (
		typeof value === "object" &&
		value !== null &&
		!Array.isArray(value) &&
		(value as { type?: unknown }).type === "session"
	);
}

/**
 * Write a session file for a session that has none, so it can be reopened at `cwd`.
 *
 * A tab started with `--no-session` lives in memory only, and moving such a tab
 * needs a file to reopen. The entries it already holds are written under a header
 * that records `cwd`, so the moved session resumes where it was moved to, and the
 * file is placed where a new session in `cwd` would go.
 *
 * Returns the file path; the caller opens it.
 */
export async function writeSessionFile(options: {
	/** Directory the moved session starts in. */
	cwd: string;
	/** Agent directory the session directory is derived from. */
	agentDir: string;
	/** Header of the in-memory session, when it has one. */
	header: SessionHeader | null;
	/** Entries of the in-memory session, the header excluded. */
	entries: readonly SessionEntry[];
}): Promise<string> {
	const directory = getDefaultSessionDir(options.cwd, options.agentDir);
	await mkdir(directory, { recursive: true });
	const timestamp = new Date().toISOString();
	const id = options.header?.id ?? crypto.randomUUID();
	const fileTimestamp = timestamp.replace(/[:.]/g, "-");
	const sessionFile = join(directory, `${fileTimestamp}_${id}.jsonl`);
	const header: SessionHeader = {
		...options.header,
		type: "session",
		version: options.header?.version ?? CURRENT_SESSION_VERSION,
		id,
		timestamp: options.header?.timestamp ?? timestamp,
		cwd: options.cwd,
	};
	const lines = [header, ...options.entries].map((entry) => JSON.stringify(entry));
	await writeFile(sessionFile, `${lines.join("\n")}\n`);
	return sessionFile;
}
