/**
 * Shared per-workdir tab state.
 *
 * pi and mixcode-pi (`mpi`) read the same agent directory, so keeping the same
 * layout on disk lets tabs opened in one agent appear in the other:
 *
 *   <agentDir>/mixcode-pi/workdirs/<sha16(workdir)>/
 *     open_tabs.json     { version, sessionIds: string[], updatedAt }  (open set and order)
 *     mixcode_state.json { children, workdirs, tab_titles, tab_colors, startup_workdir, unseen_done }
 *     workspaces.json    named layouts (snake_case fields)
 */
import { createHash } from "node:crypto";
import { existsSync, linkSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
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

export function openTabsFilePath(workdir: string): string {
	return join(scopedStateDir(workdir), "open_tabs.json");
}

export function stateFilePath(workdir: string): string {
	return join(scopedStateDir(workdir), "mixcode_state.json");
}

/** Default tab title for a 1-based position: `Agent-NN`. */
export function defaultAgentTitle(index: number): string {
	return `Agent-${String(index).padStart(2, "0")}`;
}

export function workspacesFilePath(workdir: string): string {
	return join(scopedStateDir(workdir), "workspaces.json");
}

function ensureDir(filePath: string): void {
	mkdirSync(join(filePath, ".."), { recursive: true });
}

function atomicWrite(filePath: string, contents: string): void {
	ensureDir(filePath);
	const temp = `${filePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
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
 * Atomically replace the open-tab set under the shared lock file. Refuses to
 * write over a snapshot it cannot read, so another agent's tab list is never
 * silently dropped because of a partial or foreign file.
 */
export function writeOpenTabs(workdir: string, sessionIds: readonly string[], activeSessionId?: string): void {
	const filePath = openTabsFilePath(workdir);
	const existing = readOpenTabs(workdir);
	if (existing.kind === "invalid") throw new Error(existing.error);
	const snapshot: OpenTabsSnapshot = {
		version: OPEN_TABS_VERSION,
		sessionIds: [...new Set(sessionIds.filter((id) => id.trim()))],
		updatedAt: new Date().toISOString(),
		...(activeSessionId?.trim() ? { activeSessionId } : {}),
	};
	withStateLock(`${filePath}.lock`, () => {
		atomicWrite(filePath, `${JSON.stringify(snapshot, null, 2)}\n`);
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

function asRecord(value: unknown): Record<string, unknown> {
	return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

/** Tab titles/colors/workdirs/unread from `mixcode_state.json`, keyed by session id. */
export function readTabMeta(workdir: string): Map<string, MixcodeTabMeta> {
	const state = readStateJson(workdir);
	const titles = asRecord(state.tab_titles);
	const colors = asRecord(state.tab_colors);
	const workdirs = asRecord(state.workdirs);
	const unseen = new Set(Array.isArray(state.unseen_done) ? state.unseen_done.map(String) : []);
	const children = Array.isArray(state.children) ? state.children.map(String).filter((id) => id.trim()) : [];
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

export interface TabLayoutEntry {
	sessionId: string;
	title?: string;
	workdir: string;
	color?: TabColorName;
	unread?: boolean;
}

/**
 * Persist the open-tab layout: `open_tabs.json` holds the set and its order,
 * `mixcode_state.json` holds titles, colors, workdirs, and unread badges. State
 * fields written by another reader are preserved.
 */
export function saveTabLayout(
	workdir: string,
	layout: { tabs: readonly TabLayoutEntry[]; activeSessionId?: string },
): void {
	writeOpenTabs(
		workdir,
		layout.tabs.map((tab) => tab.sessionId),
		layout.activeSessionId,
	);

	const existing = readStateJson(workdir);
	// A default `Agent-NN` title is derived from the tab's position, so it is not
	// recorded as a custom title; only names the user or the agent chose are.
	const customTitles = layout.tabs
		.filter((tab, index) => tab.title?.trim() && tab.title.trim() !== defaultAgentTitle(index + 1))
		.map((tab) => [tab.sessionId, tab.title!.trim()]);
	const next: Record<string, unknown> = {
		...existing,
		children: layout.tabs.map((tab) => tab.sessionId),
		workdirs: Object.fromEntries(layout.tabs.map((tab) => [tab.sessionId, tab.workdir])),
		tab_titles: Object.fromEntries(customTitles),
		tab_colors: Object.fromEntries(
			layout.tabs.filter((tab) => tab.color).map((tab) => [tab.sessionId, tab.color as TabColorName]),
		),
		startup_workdir: normalizeWorkdir(workdir),
		unseen_done: layout.tabs.filter((tab) => tab.unread).map((tab) => tab.sessionId),
	};
	atomicWrite(stateFilePath(workdir), `${JSON.stringify(next, null, 2)}\n`);
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

function writeWorkspaces(workdir: string, workspaces: readonly MixcodeWorkspace[]): void {
	const cleaned = workspaces
		.map((workspace) => normalizeWorkspace(workspace))
		.filter((workspace): workspace is MixcodeWorkspace => workspace !== undefined);
	atomicWrite(workspacesFilePath(workdir), `${JSON.stringify(cleaned, null, 2)}\n`);
}

export function upsertWorkspace(workdir: string, record: MixcodeWorkspace): void {
	const normalized = normalizeWorkspace(record);
	if (!normalized) throw new Error("Workspace name cannot be empty");
	const next = readWorkspaces(workdir).filter((workspace) => workspace.name !== normalized.name);
	next.push(normalized);
	next.sort((a, b) => a.name.localeCompare(b.name));
	writeWorkspaces(workdir, next);
}

/** Remove a saved layout. Unknown names are an error; removing the last one deletes the file. */
export function deleteWorkspaceRecord(workdir: string, name: string): void {
	const existing = readWorkspaces(workdir);
	const next = existing.filter((workspace) => workspace.name !== name);
	if (next.length === existing.length) throw new Error(`Unknown workspace: ${name}`);
	if (next.length === 0) {
		rmSync(workspacesFilePath(workdir), { force: true });
		return;
	}
	writeWorkspaces(workdir, next);
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
	const quarantine = `${lockPath}.reclaim.${process.pid}.${crypto.randomUUID()}`;
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
	const temp = `${lockPath}.${process.pid}.${crypto.randomUUID()}.tmp`;
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
