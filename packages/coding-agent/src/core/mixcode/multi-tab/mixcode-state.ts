/**
 * Shared per-workdir tab state, and the cross-agent lock that guards it.
 *
 * pi and mixcode-pi (`mpi`) read the same agent directory, so keeping the same
 * layout on disk lets tabs opened in one agent appear in the other:
 *
 *   <agentDir>/mixcode-pi/workdirs/<sha16(workdir)>/
 *     open_tabs.json     { version, sessionIds: string[], updatedAt }  (open set and order)
 *     mixcode_state.json { children, workdirs, tab_titles, tab_colors, startup_workdir, unseen_done }
 *     workspaces.json    named layouts (snake_case fields)
 *
 * `open_tabs.json` holds the authoritative shared order. Normal UI mutations
 * publish deltas under its lock; explicit workspace replacement writes a new set.
 * `mixcode_state.json` merges changed per-session metadata under a separate lock.
 * `workspaces.json` locks the entire named-layout read-modify-write.
 */
import { createHash, randomUUID } from "node:crypto";
import { existsSync, linkSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { getAgentDir } from "../../../config.ts";
import { stripBom } from "../../../utils/text.ts";
import { isTabColorName, type TabColorName } from "./types.ts";

export const OPEN_TABS_VERSION = 1;

/** Root state dir shared with mixcode-pi. */
export function mixcodeRootStateDir(): string {
	return join(getAgentDir(), "mixcode-pi");
}

/** Match mixcode-pi's workdir normalization before hashing. */
function normalizeWorkdir(workdir: string): string {
	return workdir.trim().replace(/\/+$/, "");
}

/** `<root>/workdirs/<sha16>`, hashed the same way as mixcode-pi so both agents share a directory. */
export function scopedStateDir(workdir: string): string {
	const digest = createHash("sha256").update(normalizeWorkdir(workdir)).digest("hex").slice(0, 16);
	return join(mixcodeRootStateDir(), "workdirs", digest);
}

/** `open_tabs.json`: the open session ids and their order. */
export function openTabsFilePath(workdir: string): string {
	return join(scopedStateDir(workdir), "open_tabs.json");
}

/** `mixcode_state.json`: titles, colors, workdirs and unread badges per tab. */
export function stateFilePath(workdir: string): string {
	return join(scopedStateDir(workdir), "mixcode_state.json");
}

/** `workspaces.json`: the named layouts of `mixcode-pi`. */
export function workspacesFilePath(workdir: string): string {
	return join(scopedStateDir(workdir), "workspaces.json");
}

function ensureDir(filePath: string): void {
	mkdirSync(dirname(filePath), { recursive: true });
}

function atomicWrite(filePath: string, contents: string): void {
	ensureDir(filePath);
	const temp = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
	writeFileSync(temp, contents, "utf-8");
	renameSync(temp, filePath);
}

// ---------------------------------------------------------------------------
// open_tabs.json
// ---------------------------------------------------------------------------

export interface OpenTabsSnapshot {
	version: typeof OPEN_TABS_VERSION;
	sessionIds: string[];
	updatedAt: string;
	/** Extra key pi writes for its own restore; readers that do not know it ignore it. */
	activeSessionId?: string;
}

export type OpenTabsReadResult =
	| { kind: "missing" }
	| { kind: "ok"; snapshot: OpenTabsSnapshot }
	| { kind: "invalid"; error: string };

/** Ordered open session ids, distinguishing "no file yet" from "file is unreadable". */
export function readOpenTabs(workdir: string): OpenTabsReadResult {
	const filePath = openTabsFilePath(workdir);
	if (!existsSync(filePath)) return { kind: "missing" };
	let parsed: Partial<OpenTabsSnapshot>;
	try {
		parsed = JSON.parse(stripBom(readFileSync(filePath, "utf-8"))) as Partial<OpenTabsSnapshot>;
	} catch (error) {
		return { kind: "invalid", error: `${filePath}: ${error instanceof Error ? error.message : String(error)}` };
	}
	if (
		parsed.version !== OPEN_TABS_VERSION ||
		!Array.isArray(parsed.sessionIds) ||
		!parsed.sessionIds.every((id) => typeof id === "string") ||
		typeof parsed.updatedAt !== "string"
	) {
		return { kind: "invalid", error: `Invalid open tabs snapshot: ${filePath}` };
	}
	return {
		kind: "ok",
		snapshot: {
			version: OPEN_TABS_VERSION,
			sessionIds: [...new Set(parsed.sessionIds.filter((id) => id.trim()))],
			updatedAt: parsed.updatedAt,
			...(typeof parsed.activeSessionId === "string" && parsed.activeSessionId.trim()
				? { activeSessionId: parsed.activeSessionId }
				: {}),
		},
	};
}

/**
 * Replace the whole open-tab set under the shared lock. Refuses to write over a
 * snapshot it cannot read, so a partial or foreign file cannot drop another
 * agent's list. Callers that change one tab at a time use `mutateOpenTabs`,
 * which keeps a peer's entries.
 */
export function writeOpenTabs(workdir: string, sessionIds: readonly string[], activeSessionId?: string): void {
	const filePath = openTabsFilePath(workdir);
	const snapshot: OpenTabsSnapshot = {
		version: OPEN_TABS_VERSION,
		sessionIds: [...new Set(sessionIds.filter((id) => id.trim()))],
		updatedAt: new Date().toISOString(),
		...(activeSessionId?.trim() ? { activeSessionId } : {}),
	};
	withStateLock(`${filePath}.lock`, () => {
		const existing = readOpenTabs(workdir);
		if (existing.kind === "invalid") throw new Error(existing.error);
		atomicWrite(filePath, `${JSON.stringify(snapshot, null, 2)}\n`);
	});
}

/**
 * Locked read-modify-write on open_tabs.json. The mutator receives the current
 * ordered set and may add, remove, or reorder entries in-place. The result is
 * written back atomically. Returns the new ordered id list.
 *
 * Missing file: treated as empty set (first writer creates it). Invalid file:
 * throws rather than silently overwriting a potentially readable snapshot.
 */
export function mutateOpenTabs(
	workdir: string,
	mutator: (ids: Set<string>) => void,
	activeSessionId?: string,
): string[] {
	const filePath = openTabsFilePath(workdir);
	return withStateLock(`${filePath}.lock`, () => {
		const existing = readOpenTabs(workdir);
		if (existing.kind === "invalid") throw new Error(existing.error);
		const ids = new Set(existing.kind === "ok" ? existing.snapshot.sessionIds : []);
		mutator(ids);
		const sessionIds = [...ids];
		const active = activeSessionId ?? (existing.kind === "ok" ? existing.snapshot.activeSessionId : undefined);
		const snapshot: OpenTabsSnapshot = {
			version: OPEN_TABS_VERSION,
			sessionIds,
			updatedAt: new Date().toISOString(),
			...(active && ids.has(active) ? { activeSessionId: active } : {}),
		};
		ensureDir(filePath);
		atomicWrite(filePath, `${JSON.stringify(snapshot, null, 2)}\n`);
		return sessionIds;
	});
}

// ---------------------------------------------------------------------------
// mixcode_state.json
// ---------------------------------------------------------------------------

export interface MixcodeTabMeta {
	sessionId: string;
	title?: string;
	color?: TabColorName;
	workdir?: string;
	unread: boolean;
}

/**
 * The tolerant reader of `mixcode_state.json`: a missing, corrupt, or non-object
 * file reads as `{}` instead of failing. Everything it holds is cosmetic (titles,
 * colors, workdirs, unread badges), so a bad file costs a lost label, not the tab.
 * `readOpenTabs` and `readWorkspaces` guard data the user would notice losing, so
 * they report corruption instead.
 */
function readStateJson(workdir: string): Record<string, unknown> {
	const filePath = stateFilePath(workdir);
	if (!existsSync(filePath)) return {};
	try {
		const parsed = JSON.parse(stripBom(readFileSync(filePath, "utf-8"))) as unknown;
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
		return parsed as Record<string, unknown>;
	} catch {
		return {};
	}
}

/** `value` as a plain object, or `{}` for anything else (null, arrays, primitives). */
export function asRecord(value: unknown): Record<string, unknown> {
	return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

/** Tab titles/colors/workdirs/unread from `mixcode_state.json`, keyed by session id. */
export function readTabMeta(workdir: string): Map<string, MixcodeTabMeta> {
	const state = readStateJson(workdir);
	const titles = asRecord(state.tab_titles);
	const colors = asRecord(state.tab_colors);
	const workdirs = asRecord(state.workdirs);
	const unseen = new Set(Array.isArray(state.unseen_done) ? state.unseen_done.map(String) : []);
	// Membership comes from open_tabs.json (authoritative for which tabs are open);
	// `children` in mixcode_state.json is only a fallback for a state file written
	// before the open-tabs membership existed / when open_tabs.json is missing.
	const openTabs = readOpenTabs(workdir);
	const children =
		openTabs.kind === "ok"
			? openTabs.snapshot.sessionIds
			: Array.isArray(state.children)
				? state.children.map(String).filter((id) => id.trim())
				: [];
	const meta = new Map<string, MixcodeTabMeta>();
	for (const sessionId of children) {
		const title = typeof titles[sessionId] === "string" ? (titles[sessionId] as string).trim() : undefined;
		// Unknown names (removed or renamed palette entries) are dropped rather than
		// failing startup or reaching the renderer, which has no paint for them.
		const storedColor = colors[sessionId];
		const color = isTabColorName(storedColor) ? storedColor : undefined;
		const tabWorkdir = typeof workdirs[sessionId] === "string" ? (workdirs[sessionId] as string) : undefined;
		meta.set(sessionId, {
			sessionId,
			...(title ? { title } : {}),
			...(color ? { color } : {}),
			...(tabWorkdir ? { workdir: tabWorkdir } : {}),
			unread: unseen.has(sessionId),
		});
	}
	return meta;
}

/**
 * A tab layout to persist: the workdir is always known there, the badge only
 * when the tab has one, and `autoTitle` reports whether `title` is a generated
 * `Agent-NN` rather than a name the user or the agent chose. Every other field
 * matches {@link MixcodeTabMeta}.
 */
export type TabLayoutEntry = Omit<MixcodeTabMeta, "workdir" | "unread"> & {
	workdir: string;
	unread?: boolean;
	autoTitle?: boolean;
};

/** A metadata patch: omitted fields are preserved, explicit undefined clears a value. */
export type TabMetaUpdate = Pick<TabLayoutEntry, "sessionId"> & Partial<Omit<TabLayoutEntry, "sessionId">>;

/**
 * Write the given tabs' cosmetic metadata: titles, colors, workdirs, and unread
 * badges. A field absent from an entry keeps whatever another writer left, and
 * `open_tabs.json` is untouched, so a peer's membership survives.
 */
export function saveTabMeta(workdir: string, tabs: readonly TabMetaUpdate[]): void {
	const stateFile = stateFilePath(workdir);
	withStateLock(`${stateFile}.lock`, () => {
		const existing = readStateJson(workdir);
		const mergedTitles = { ...asRecord(existing.tab_titles) };
		const mergedColors = { ...asRecord(existing.tab_colors) };
		const mergedWorkdirs = { ...asRecord(existing.workdirs) };
		for (const tab of tabs) {
			if ("title" in tab || "autoTitle" in tab) {
				if (tab.title?.trim() && !tab.autoTitle) mergedTitles[tab.sessionId] = tab.title.trim();
				else delete mergedTitles[tab.sessionId];
			}
			if ("color" in tab) {
				if (tab.color) mergedColors[tab.sessionId] = tab.color;
				else delete mergedColors[tab.sessionId];
			}
			if (tab.workdir !== undefined) mergedWorkdirs[tab.sessionId] = tab.workdir;
		}
		const unseen = new Set(Array.isArray(existing.unseen_done) ? existing.unseen_done.map(String) : []);
		for (const tab of tabs) {
			if (!("unread" in tab)) continue;
			if (tab.unread) unseen.add(tab.sessionId);
			else unseen.delete(tab.sessionId);
		}
		const shared = readOpenTabs(workdir);
		if (shared.kind === "invalid") throw new Error(shared.error);
		const children =
			shared.kind === "ok"
				? shared.snapshot.sessionIds
				: [
						...new Set([
							...(Array.isArray(existing.children) ? existing.children.map(String) : []),
							...tabs.map((tab) => tab.sessionId),
						]),
					];
		const next: Record<string, unknown> = {
			...existing,
			children,
			workdirs: mergedWorkdirs,
			tab_titles: mergedTitles,
			tab_colors: mergedColors,
			startup_workdir: normalizeWorkdir(workdir),
			unseen_done: [...unseen].filter((id) => children.includes(id)),
		};
		atomicWrite(stateFile, `${JSON.stringify(next, null, 2)}\n`);
	});
}

// ---------------------------------------------------------------------------
// workspaces.json (snake_case schema)
// ---------------------------------------------------------------------------

export interface MixcodeWorkspaceModel {
	provider: string;
	model_id: string;
	display_name: string;
	context_window: number;
	reasoning?: boolean;
	thinking_level_map?: unknown;
}

export interface MixcodeWorkspaceTab {
	session_id: string;
	session_path?: string;
	title?: string;
	workdir?: string;
	model?: MixcodeWorkspaceModel;
	thinking_level?: string;
}

export interface MixcodeWorkspace {
	name: string;
	startup_workdir: string;
	updated_at: string;
	active_session_id?: string;
	tabs: MixcodeWorkspaceTab[];
}

/** Saved layouts from `workspaces.json`. Throws when the file is unreadable or malformed. */
export function readWorkspaces(workdir: string): MixcodeWorkspace[] {
	const filePath = workspacesFilePath(workdir);
	if (!existsSync(filePath)) return [];
	try {
		const parsed = JSON.parse(stripBom(readFileSync(filePath, "utf-8"))) as unknown;
		if (!Array.isArray(parsed)) throw new Error("top level must be an array");
		const entries = parsed.filter(
			(entry) => entry && typeof entry === "object" && typeof entry.name === "string",
		) as MixcodeWorkspace[];
		for (const entry of entries) {
			if (!Array.isArray(entry.tabs)) throw new Error(`workspaces[${entry.name}].tabs must be an array`);
		}
		return entries;
	} catch (error) {
		throw new Error(`Invalid workspace file: ${filePath}: ${error instanceof Error ? error.message : String(error)}`);
	}
}

/** Drop blank names and tabs without a session id, and normalize the paths. */
function normalizeWorkspace(record: MixcodeWorkspace): MixcodeWorkspace | undefined {
	const name = record.name?.trim();
	if (!name) return undefined;
	const tabs = (Array.isArray(record.tabs) ? record.tabs : [])
		.filter((tab) => typeof tab.session_id === "string" && tab.session_id.trim())
		.map((tab) => ({
			...tab,
			session_id: tab.session_id.trim(),
			...(tab.session_path?.trim() ? { session_path: tab.session_path.trim() } : {}),
			...(tab.workdir ? { workdir: normalizeWorkdir(tab.workdir) } : {}),
		}));
	return { ...record, name, startup_workdir: normalizeWorkdir(record.startup_workdir ?? ""), tabs };
}

/** Write the cleaned workspace list without acquiring a lock (caller holds one). */
function writeWorkspacesUnlocked(workdir: string, workspaces: readonly MixcodeWorkspace[]): void {
	const cleaned = workspaces
		.map((workspace) => normalizeWorkspace(workspace))
		.filter((workspace): workspace is MixcodeWorkspace => workspace !== undefined);
	atomicWrite(workspacesFilePath(workdir), `${JSON.stringify(cleaned, null, 2)}\n`);
}

/** Insert or replace a saved layout by name, keeping the file sorted. Throws on an empty name. */
export function upsertWorkspace(workdir: string, record: MixcodeWorkspace): void {
	const normalized = normalizeWorkspace(record);
	if (!normalized) throw new Error("Workspace name cannot be empty");
	const filePath = workspacesFilePath(workdir);
	withStateLock(`${filePath}.lock`, () => {
		const next = readWorkspaces(workdir).filter((workspace) => workspace.name !== normalized.name);
		next.push(normalized);
		next.sort((a, b) => a.name.localeCompare(b.name));
		writeWorkspacesUnlocked(workdir, next);
	});
}

/** Remove a saved layout. Unknown names are an error; removing the last one deletes the file. */
export function deleteWorkspaceRecord(workdir: string, name: string): void {
	const filePath = workspacesFilePath(workdir);
	withStateLock(`${filePath}.lock`, () => {
		const existing = readWorkspaces(workdir);
		const next = existing.filter((workspace) => workspace.name !== name);
		if (next.length === existing.length) throw new Error(`Unknown workspace: ${name}`);
		if (next.length === 0) {
			rmSync(filePath, { force: true });
			return;
		}
		writeWorkspacesUnlocked(workdir, next);
	});
}

// ---------------------------------------------------------------------------
// Session id -> file resolution (open_tabs.json stores ids only)
// ---------------------------------------------------------------------------

/**
 * Find the newest `<timestamp>_<sessionId>.jsonl` in a session directory. The
 * timestamp prefix sorts lexically, so the last match is the current file.
 */
export function resolveSessionPath(sessionDir: string, sessionId: string): string | undefined {
	if (!sessionId.trim() || !existsSync(sessionDir)) return undefined;
	const suffix = `_${sessionId}.jsonl`;
	const matches = readdirSync(sessionDir)
		.filter((name) => name.endsWith(suffix))
		.sort();
	return matches.length > 0 ? join(sessionDir, matches[matches.length - 1]!) : undefined;
}

// ---------------------------------------------------------------------------
// Locking (pid lock shared with the other agent that reads these files)
// ---------------------------------------------------------------------------

function sleepMs(ms: number): void {
	Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function readLockPid(lockPath: string): number | undefined {
	try {
		const parsed = JSON.parse(readFileSync(lockPath, "utf-8")) as { pid?: unknown };
		return typeof parsed.pid === "number" ? parsed.pid : undefined;
	} catch {
		return undefined;
	}
}

function isProcessAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		return (error as NodeJS.ErrnoException).code === "EPERM";
	}
}

/**
 * Take a suspected-stale lock aside by rename, re-check it, and drop it only when
 * it is still stale. Renaming (not unlinking) keeps two reclaimers from deleting
 * each other's freshly published lock.
 */
function tryReclaimStaleLock(lockPath: string): boolean {
	const quarantine = `${lockPath}.reclaim.${process.pid}.${randomUUID()}`;
	try {
		renameSync(lockPath, quarantine);
	} catch {
		return false;
	}
	const holder = readLockPid(quarantine);
	if (holder !== undefined && isProcessAlive(holder)) {
		try {
			renameSync(quarantine, lockPath);
		} catch {
			try {
				linkSync(quarantine, lockPath);
				rmSync(quarantine, { force: true });
			} catch {
				// Path occupied; keep the quarantined record rather than destroy it.
			}
		}
		return false;
	}
	rmSync(quarantine, { force: true });
	return true;
}

/** Publish the lock through a temp file plus `link`, so the path is never seen empty. */
function tryAcquireLock(lockPath: string, payload: string): boolean {
	const temp = `${lockPath}.${process.pid}.${randomUUID()}.tmp`;
	try {
		writeFileSync(temp, payload, "utf-8");
		try {
			linkSync(temp, lockPath);
			return true;
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
			const holder = readLockPid(lockPath);
			if (holder === undefined || !isProcessAlive(holder)) tryReclaimStaleLock(lockPath);
			return false;
		}
	} finally {
		rmSync(temp, { force: true });
	}
}

/** Cap the wait so a live-but-stuck lock holder cannot freeze the TUI thread. */
const LOCK_WAIT_TIMEOUT_MS = 5_000;

/**
 * Exclusive lock on `<file>.lock`. A live holder is waited for; only a dead or
 * unreadable holder is reclaimed.
 */
function withStateLock<T>(lockPath: string, fn: () => T): T {
	ensureDir(lockPath);
	const payload = `${JSON.stringify({ pid: process.pid })}\n`;
	const deadline = Date.now() + LOCK_WAIT_TIMEOUT_MS;
	while (!tryAcquireLock(lockPath, payload)) {
		if (Date.now() >= deadline) throw new Error(`Timed out waiting for state lock: ${lockPath}`);
		sleepMs(20);
	}
	try {
		return fn();
	} finally {
		const holder = readLockPid(lockPath);
		if (holder === undefined || holder === process.pid) {
			try {
				rmSync(lockPath, { force: true });
			} catch {
				// Already gone.
			}
		}
	}
}
