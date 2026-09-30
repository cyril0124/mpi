/**
 * Workdir picker: a centered overlay that browses directories and hands back the
 * one to move the active tab into.
 *
 * The browsing directory is what Enter applies; Tab walks into the highlighted
 * row. Those are two different answers, which is why the picker keeps its own row
 * model instead of reusing a select list: Tab is navigation here, not selection.
 * Rows answer the keyboard only, like this fork's other pickers; the workdir
 * badge in the dock is what answers the pointer.
 */
import { basename, sep } from "node:path";
import { type Component, getKeybindings, truncateToWidth } from "@earendil-works/pi-tui";
import { theme } from "../../../theme/theme.ts";
import { primaryKeyGlyphText } from "../key-hints.ts";
import { padLine, windowStart } from "../layout-text.ts";
import { panel, panelContentWidth } from "../panel.ts";
import {
	parentWorkdir,
	readWorkdirListing,
	rowIndexOfLabel,
	substringMatchPositions,
	type WorkdirListing,
	type WorkdirRow,
	workdirBreadcrumb,
	workdirRows,
} from "./workdir-picker-model.ts";

/** Picker width as a share of the terminal. */
export const WORKDIR_PICKER_WIDTH_PERCENT = 78;

/** Share of the terminal height the picker may take, its frame included. */
export const WORKDIR_PICKER_HEIGHT_PERCENT = 80;

/**
 * Listing rows one window holds: at most half the terminal, never fewer than 5. The
 * window is the listing's own budget; the panel frame sits on top of it inside the
 * overlay's height.
 */
export function workdirWindowRows(terminalRows: number): number {
	return Math.max(5, Math.floor(terminalRows / 2));
}

/** Row glyphs: the folder marks a directory, the page a typed path or a read error. */
const DIRECTORY_ICON = "\u{1F4C1}";
const ENTRY_ICON = "\u{1F4C4}";

export interface WorkdirPickerOptions {
	/** Directory the picker opens on, normally the active tab's workdir. */
	startDir: string;
	/** Rows of the terminal the picker is drawn in; its window keeps to half of them. */
	terminalRows: () => number;
	/** The directory to move the tab into; the host closes the overlay and applies it. */
	onChoose: (dir: string) => void;
	onCancel: () => void;
}

export class WorkdirPickerComponent implements Component {
	private readonly terminalRows: () => number;
	private readonly onChoose: (dir: string) => void;
	private readonly onCancel: () => void;
	private browsingDir: string;
	private query = "";
	private showHidden = false;
	private selectedIndex = 0;
	/** Listing of the current browsing directory, reused across filter keystrokes. */
	private listingCache?: { browsingDir: string; showHidden: boolean; listing: WorkdirListing };
	/** Rows of the last (browsing directory, hidden flag, query), so a repaint of the same
	 * frame does not rebuild them. */
	private rowsCache?: { browsingDir: string; showHidden: boolean; query: string; rows: WorkdirRow[] };

	constructor(options: WorkdirPickerOptions) {
		this.browsingDir = options.startDir;
		this.terminalRows = options.terminalRows;
		this.onChoose = options.onChoose;
		this.onCancel = options.onCancel;
	}

	/** Drop both caches: a repaint after a resize reads the directory and rebuilds the rows again. */
	invalidate(): void {
		this.listingCache = undefined;
		this.rowsCache = undefined;
	}

	render(width: number): string[] {
		const contentWidth = panelContentWidth(width);
		const rows = this.rows();
		// Read per render, so a resize while the picker is open re-windows it.
		const maxVisibleRows = workdirWindowRows(this.terminalRows());
		const start = windowStart(this.selectedIndex, rows.length, maxVisibleRows);
		const end = Math.min(start + maxVisibleRows, rows.length);

		const body: string[] = [this.renderBreadcrumb(), this.renderFilterLine(), ""];
		if (rows.length === 0) {
			// An empty row list means either an empty directory or a filter that matched nothing.
			body.push(theme.fg("dim", this.query.trim() ? "  (nothing matches)" : "  (no subdirectories)"));
		} else {
			if (start > 0) body.push(theme.fg("dim", `  ... (${start} more above)`));
			for (let index = start; index < end; index++) {
				body.push(this.renderRow(rows[index]!, index === this.selectedIndex, contentWidth));
			}
			if (end < rows.length) body.push(theme.fg("dim", `  ... (${rows.length - end} more below)`));
		}
		body.push("", ...this.renderHints(rows.filter((row) => row.kind === "dir").length));
		return panel("Change Workdir", body, width);
	}

	handleInput(data: string): void {
		const keybindings = getKeybindings();
		if (keybindings.matches(data, "tui.select.cancel")) {
			this.onCancel();
			return;
		}
		if (keybindings.matches(data, "tui.select.up")) {
			this.move(-1);
			return;
		}
		if (keybindings.matches(data, "tui.select.down")) {
			this.move(1);
			return;
		}
		if (keybindings.matches(data, "app.workdir.parent")) {
			this.goToParent();
			return;
		}
		if (keybindings.matches(data, "app.workdir.enterDir")) {
			this.enterHighlighted();
			return;
		}
		if (keybindings.matches(data, "app.workdir.toggleHidden")) {
			this.showHidden = !this.showHidden;
			this.selectedIndex = 0;
			return;
		}
		if (keybindings.matches(data, "app.workdir.clearQuery")) {
			this.setQuery("");
			return;
		}
		if (keybindings.matches(data, "tui.select.confirm")) {
			this.choose();
			return;
		}
		if (keybindings.matches(data, "tui.editor.deleteCharBackward")) {
			this.setQuery(this.query.slice(0, -1));
			return;
		}
		// A printable keystroke filters. Control characters are swallowed here, so the
		// picker cannot fall through to the composer with them.
		if (data.length > 0 && !/[\x00-\x1f\x7f]/.test(data)) this.setQuery(this.query + data);
	}

	/** The browsing directory's listing, read once per directory/visibility change. */
	private listing(): WorkdirListing {
		const cache = this.listingCache;
		if (cache && cache.browsingDir === this.browsingDir && cache.showHidden === this.showHidden) {
			return cache.listing;
		}
		const listing = readWorkdirListing(this.browsingDir, this.showHidden);
		this.listingCache = { browsingDir: this.browsingDir, showHidden: this.showHidden, listing };
		return listing;
	}

	private rows(): WorkdirRow[] {
		const cache = this.rowsCache;
		if (
			cache &&
			cache.browsingDir === this.browsingDir &&
			cache.showHidden === this.showHidden &&
			cache.query === this.query
		) {
			return cache.rows;
		}
		const rows = workdirRows(this.browsingDir, this.query, () => this.listing());
		this.rowsCache = {
			browsingDir: this.browsingDir,
			showHidden: this.showHidden,
			query: this.query,
			rows,
		};
		return rows;
	}

	private setQuery(query: string): void {
		this.query = query;
		this.selectedIndex = 0;
	}

	/** Move the highlight by `delta` rows, wrapping around the list. */
	private move(delta: number): void {
		const count = this.rows().length;
		if (count === 0) {
			this.selectedIndex = 0;
			return;
		}
		this.selectedIndex = (this.selectedIndex + delta + count) % count;
	}

	/** Walk up one directory, keeping the directory just left under the highlight. */
	private goToParent(): void {
		const parent = parentWorkdir(this.browsingDir);
		if (parent === undefined) return;
		const leaving = basename(this.browsingDir);
		this.browsingDir = parent;
		this.query = "";
		this.selectedIndex = rowIndexOfLabel(this.rows(), `${leaving}/`);
	}

	/** Tab: walk into the highlighted directory. A custom-path row has none to enter. */
	private enterHighlighted(): void {
		const row = this.rows()[this.selectedIndex];
		if (!row || row.kind !== "dir") return;
		this.browsingDir = row.value;
		this.query = "";
		this.selectedIndex = 0;
	}

	/** Enter: the browsing directory, or the typed path when the row offers one. */
	private choose(): void {
		const row = this.rows()[this.selectedIndex];
		if (row?.kind === "custom") {
			this.onChoose(row.value);
			return;
		}
		this.onChoose(this.browsingDir);
	}

	private renderBreadcrumb(): string {
		const segments = workdirBreadcrumb(this.browsingDir);
		return segments
			.map((segment, index) =>
				index === segments.length - 1 ? theme.fg("warning", segment) : theme.fg("accent", segment),
			)
			.join(theme.fg("dim", ` ${sep} `));
	}

	private renderFilterLine(): string {
		return this.query ? `${theme.fg("dim", "filter:")} ${this.query}` : theme.fg("dim", "type to filter");
	}

	/** The row markup: the selection marker, the glyph, the highlighted label and the description. */
	private renderRow(row: WorkdirRow, selected: boolean, contentWidth: number): string {
		const icon = row.kind === "dir" ? DIRECTORY_ICON : ENTRY_ICON;
		const line = `${selected ? ">" : " "} ${icon} ${this.highlightMatch(row.label)}  ${theme.fg("dim", row.description)}`;
		const clipped = truncateToWidth(line, contentWidth, "");
		if (!selected) return clipped;
		// Fill the row before painting it, so the highlight covers the row and not just its text.
		return theme.bg("selectedBg", padLine(clipped, contentWidth));
	}

	/** Paint the run of a label the filter matched, in one piece per contiguous run. */
	private highlightMatch(label: string): string {
		const positions = new Set(substringMatchPositions(this.query.trim(), label));
		if (positions.size === 0) return label;
		let painted = "";
		let cursor = 0;
		let index = 0;
		while (index < label.length) {
			if (!positions.has(index)) {
				index++;
				continue;
			}
			let end = index;
			while (end + 1 < label.length && positions.has(end + 1)) end++;
			painted += label.slice(cursor, index) + theme.bold(theme.fg("accent", label.slice(index, end + 1)));
			cursor = end + 1;
			index = end + 1;
		}
		return painted + label.slice(cursor);
	}

	/**
	 * The key hints, in two rows: the panel is too narrow for one row naming all six
	 * actions, and a clipped hint silently drops one. Keys are read from the bindings, so a
	 * rebound key keeps the row accurate, and one key per action keeps both rows short.
	 */
	private renderHints(dirCount: number): string[] {
		const hidden = this.showHidden ? "on" : "off";
		const actions = [
			`${primaryKeyGlyphText("app.workdir.parent")} parent`,
			`${primaryKeyGlyphText("app.workdir.enterDir")} enter`,
			`${primaryKeyGlyphText("tui.select.confirm")} set`,
		].join(" \u00b7 ");
		const state = [
			`${primaryKeyGlyphText("app.workdir.toggleHidden")} hidden(${hidden})`,
			`${primaryKeyGlyphText("app.workdir.clearQuery")} clear`,
			`${primaryKeyGlyphText("tui.select.cancel")} cancel`,
		].join(" \u00b7 ");
		return [
			theme.fg("dim", `${dirCount} ${dirCount === 1 ? "dir" : "dirs"} \u00b7 ${actions}`),
			theme.fg("dim", state),
		];
	}
}
