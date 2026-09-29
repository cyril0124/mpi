/**
 * Listing rules behind the workdir picker: which directories a browsing
 * directory offers, how a typed query narrows them, and how a path is resolved
 * against a base directory. Kept apart from the component so the rules can be
 * exercised without a terminal.
 */
import { type Dirent, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, resolve, sep } from "node:path";
import { resolvePath } from "../../../../../utils/paths.ts";
import { formatCwdForFooter } from "../../footer.ts";

/** What one directory read produced: names, or the reason it could not be read. */
export interface WorkdirListing {
	/** Subdirectory names, name-sorted; dot-directories only when they were asked for. */
	dirs: string[];
	/** Set when the directory could not be read; the picker then offers this one message. */
	error?: string;
}

/** One picker row. `kind` decides what choosing the row does. */
export interface WorkdirRow {
	kind: "dir" | "custom" | "error";
	/** Absolute path the row stands for, or the browsing directory for an error row. */
	value: string;
	/** Label shown in the row; directory labels end in the path separator's slash. */
	label: string;
	/** Dim helper text to the right of the label. */
	description: string;
}

/** Read one directory listing, hiding dot-directories unless `showHidden`. */
export function readWorkdirListing(browsingDir: string, showHidden: boolean): WorkdirListing {
	let entries: Dirent[];
	try {
		entries = readdirSync(browsingDir, { withFileTypes: true });
	} catch (error) {
		const code = (error as NodeJS.ErrnoException).code ?? "unknown error";
		return { dirs: [], error: `parent unreadable: ${browsingDir} (${code})` };
	}
	const dirs = entries
		.filter((entry) => entry.isDirectory())
		.filter((entry) => showHidden || !entry.name.startsWith("."))
		.map((entry) => entry.name)
		.sort((a, b) => a.localeCompare(b));
	return { dirs };
}

/**
 * Home directory the picker collapses, expands and highlights against. Read per
 * call and from the same variables the dock's meta row uses, so the breadcrumb
 * and the workdir badge never disagree about where `~` is.
 */
export function pickerHome(): string {
	return process.env.HOME || process.env.USERPROFILE || homedir();
}

/**
 * Resolve a workdir input: `~` expands to the home directory, an absolute path
 * stands on its own, and anything else resolves against `base`. Surrounding
 * whitespace is dropped.
 */
export function resolveWorkdirInput(base: string, input: string): string {
	return resolvePath(input.trim(), base, { homeDir: pickerHome() });
}

/**
 * A query holding a path separator, or starting with `~`, names a path directly
 * instead of filtering the listing.
 */
export function isDirectPathQuery(query: string): boolean {
	return query.includes("/") || query.startsWith("~");
}

/**
 * Indices of the query's first case-insensitive contiguous match in `text`. The
 * listing filters by plain substring, so the highlight marks the same run.
 */
export function substringMatchPositions(query: string, text: string): number[] {
	if (!query) return [];
	const index = text.toLowerCase().indexOf(query.toLowerCase());
	if (index === -1) return [];
	return Array.from({ length: query.length }, (_, offset) => index + offset);
}

/** The rows a browsing directory and query produce. The listing is read only when the query
 * filters one: a path-shaped query never consults it. */
export function workdirRows(browsingDir: string, query: string, readListing: () => WorkdirListing): WorkdirRow[] {
	// Surrounding whitespace is dropped once, so it neither narrows the listing nor
	// turns a path into a relative one.
	const needle = query.trim();
	if (needle && isDirectPathQuery(needle)) {
		return [
			{
				kind: "custom",
				value: resolveWorkdirInput(browsingDir, needle),
				label: needle,
				description: "custom path",
			},
		];
	}
	const listing = readListing();
	if (listing.error !== undefined) {
		return [{ kind: "error", value: browsingDir, label: browsingDir, description: `error: ${listing.error}` }];
	}
	const filter = needle.toLowerCase();
	return listing.dirs
		.filter((name) => !filter || name.toLowerCase().includes(filter))
		.map((name) => ({
			kind: "dir" as const,
			value: resolve(browsingDir, name),
			label: `${name}/`,
			description: "directory",
		}));
}

/** Index of the row whose label is `label`, or 0 when no row carries it. */
export function rowIndexOfLabel(rows: readonly WorkdirRow[], label: string): number {
	const index = rows.findIndex((row) => row.label === label);
	return index >= 0 ? index : 0;
}

/**
 * Home-collapsed breadcrumb segments: `~` inside the home directory, the
 * absolute path otherwise, with the first absolute segment carrying its own
 * leading slash so the root never renders as `/ / tmp`.
 */
export function workdirBreadcrumb(browsingDir: string, home: string = pickerHome()): string[] {
	const collapsed = formatCwdForFooter(browsingDir, home);
	if (collapsed === "~" || collapsed.startsWith(`~${sep}`)) return collapsed.split(sep).filter(Boolean);
	const parts = collapsed.split(sep).filter(Boolean);
	if (parts.length === 0) return [sep];
	return [`${sep}${parts[0]}`, ...parts.slice(1)];
}

/** The parent of a browsing directory, or undefined at the filesystem root. */
export function parentWorkdir(browsingDir: string): string | undefined {
	const parent = dirname(browsingDir);
	return parent === browsingDir ? undefined : parent;
}
