/**
 * Tab Jump: MixCode Home plus every open agent tab as a searchable list, shown as a
 * centered overlay over the composer. A row carries the tab's status glyph and title,
 * the tab's id on the right, and the filter can be narrowed to the tabs that have
 * something to report. The overlay takes the keyboard while it is up, so the composer
 * keeps its draft and never sees a key pressed into this list.
 *
 * Filtering matches the title only, and the status glyph is the one the tab bar paints,
 * so a filtered row always reads as the same tab the tab bar shows.
 */
import {
	type Component,
	fuzzyFilter,
	getKeybindings,
	type TuiMouseEvent,
	type TuiMouseEventResult,
	truncateToWidth,
	visibleWidth,
} from "@earendil-works/pi-tui";
import { HOME_TAB_ID } from "../../../../../core/mixcode/home/home-state.ts";
import { isWorkingStatus, type TabStatus } from "../../../../../core/mixcode/multi-tab/types.ts";
import { theme } from "../../../theme/theme.ts";
import { type HoverTarget, PointerHover } from "../hover/pointer-hover.ts";
import { padLine, windowStart } from "../layout-text.ts";
import { panel, panelContentWidth } from "../panel.ts";
import { highlightMatches } from "../search-highlight.ts";
import { tabStatusGlyph, tabStatusPaint } from "./tab-glyphs.ts";

/** One selectable row: a tab's identity, its title, and the status it reports. */
export interface TabJumpEntry {
	/** Tab id, or the Home surface's own id for the Home row. */
	id: string;
	title: string;
	status: TabStatus;
	unread: boolean;
	/** True while an extension dialog on the tab waits on a human; the row reads `?`. */
	waiting?: boolean;
}

/** Body lines above the first row: the search row and the blank line under it. */
const TAB_JUMP_BODY_LINES_ABOVE_ROWS = 2;

/** Id length at or below which the whole id always fits the row's right column. */
const TAB_JUMP_WHOLE_ID_LENGTH = 12;

/** Characters the id keeps when the whole one would crowd out the title. */
const TAB_JUMP_SHORT_ID_LENGTH = 8;

/** Body line a row's cells start at, inside the frame; the top border is line 0. */
const TAB_JUMP_FRAME_ROWS = 1;

/**
 * Whether the non-idle filter keeps a row: it has something to report. A tab that is
 * still coming up has not started yet, so it is not one of them; a tab parked on an
 * extension dialog is, because nothing moves until it is answered.
 */
function entryNeedsAttention(entry: TabJumpEntry): boolean {
	return (
		entry.unread ||
		entry.waiting === true ||
		entry.status === "error" ||
		entry.status === "done" ||
		isWorkingStatus(entry.status)
	);
}

/**
 * `index` folded into `[0, count)`, so a move past either end wraps to the other one.
 */
function wrapIndex(index: number, count: number): number {
	return ((index % count) + count) % count;
}

/** Style a row's text the way the tab bar styles the same tab's chip; undefined for a tab it paints plain. */
function statusStyle(entry: TabJumpEntry): ((text: string) => string) | undefined {
	return tabStatusPaint(entry.status, entry.unread, entry.waiting === true);
}

/** One row's place in the frame, for the renderer and the pointer hit test. */
interface TabJumpRow {
	/** 0-based body line inside the frame, under the top border. */
	bodyLine: number;
	entryIndex: number;
}

/** The entries the current query and filter keep, with the window the frame shows. */
interface TabJumpPlan {
	entries: TabJumpEntry[];
	rows: TabJumpRow[];
	startIndex: number;
	endIndex: number;
	showMoreAbove: boolean;
	showMoreBelow: boolean;
	empty: boolean;
}

/**
 * Searchable tab list. Enter jumps to the highlighted tab and Esc closes without
 * switching; moving the highlight never types into the query.
 */
export class TabJumpComponent implements Component {
	private readonly entries: TabJumpEntry[];
	private readonly maxVisibleRows: number;
	private readonly onActivate: (id: string) => void;
	private readonly onCancel: () => void;
	private readonly hover = new PointerHover();
	private nonIdleOnly = false;
	private query = "";
	private selectedIndex = 0;
	/** Panel width of the last render, so a pointer event can be rejected on the border columns. */
	private lastWidth = 0;

	/**
	 * `maxVisibleRows` is how many rows the list may show at once, the frame not included.
	 * The list opens on `activeId`, so the overlay starts on the tab the user is already
	 * looking at.
	 */
	constructor(
		entries: TabJumpEntry[],
		activeId: string,
		maxVisibleRows: number,
		onActivate: (id: string) => void,
		onCancel: () => void,
	) {
		this.entries = entries;
		this.maxVisibleRows = Math.max(1, maxVisibleRows);
		this.onActivate = onActivate;
		this.onCancel = onCancel;
		this.selectedIndex = Math.max(
			0,
			entries.findIndex((entry) => entry.id === activeId),
		);
	}

	/** The entries the query and the non-idle filter keep, in list order. */
	private visibleEntries(): TabJumpEntry[] {
		const base = this.nonIdleOnly ? this.entries.filter(entryNeedsAttention) : this.entries;
		return this.query ? fuzzyFilter(base, this.query, (entry) => entry.title) : base;
	}

	/** The rows this frame paints, and the window they are drawn from. */
	private plan(): TabJumpPlan {
		const entries = this.visibleEntries();
		if (entries.length === 0) {
			return {
				entries,
				rows: [],
				startIndex: 0,
				endIndex: 0,
				showMoreAbove: false,
				showMoreBelow: false,
				empty: true,
			};
		}
		const startIndex = windowStart(this.selectedIndex, entries.length, this.maxVisibleRows);
		const endIndex = Math.min(startIndex + this.maxVisibleRows, entries.length);
		const showMoreAbove = startIndex > 0;
		let bodyLine = TAB_JUMP_BODY_LINES_ABOVE_ROWS + (showMoreAbove ? 1 : 0);
		const rows: TabJumpRow[] = [];
		for (let entryIndex = startIndex; entryIndex < endIndex; entryIndex++) {
			rows.push({ bodyLine, entryIndex });
			bodyLine += 1;
		}
		return {
			entries,
			rows,
			startIndex,
			endIndex,
			showMoreAbove,
			showMoreBelow: endIndex < entries.length,
			empty: false,
		};
	}

	private selectedEntryIndex(count: number): number {
		if (count === 0) return 0;
		return wrapIndex(this.selectedIndex, count);
	}

	/** Move the highlight by `delta`, wrapping past either end. */
	private moveSelection(delta: number): void {
		const count = this.visibleEntries().length;
		if (count === 0) return;
		this.selectedIndex = wrapIndex(this.selectedEntryIndex(count) + delta, count);
	}

	/**
	 * Change the query or the filter. The highlight follows the tab it was on while that tab
	 * survives; otherwise it falls back to the first row, because the fuzzy ranking reorders
	 * the rows a bare index would have pointed into.
	 */
	private reselect(previousId: string | undefined): void {
		const entries = this.visibleEntries();
		const index = previousId === undefined ? -1 : entries.findIndex((entry) => entry.id === previousId);
		this.selectedIndex = index >= 0 ? index : 0;
	}

	/** The id of the highlighted entry, or undefined with an empty list. */
	private highlightedId(): string | undefined {
		const entries = this.visibleEntries();
		return entries[this.selectedEntryIndex(entries.length)]?.id;
	}

	/** Jump to the highlighted entry, or close when the list has nothing left to select. */
	private accept(): void {
		const entry = this.highlightedId();
		if (entry === undefined) this.onCancel();
		else this.onActivate(entry);
	}

	/**
	 * Glyph cell of a row: the tab's status, or blank for Home, which carries no status -
	 * the same rule the tab bar's chips follow.
	 */
	private glyphFor(entry: TabJumpEntry): string {
		return entry.id === HOME_TAB_ID ? " " : tabStatusGlyph(entry.status, entry.unread, entry.waiting === true);
	}

	/**
	 * Id column of a row: the whole id while it fits beside the title, and its first
	 * characters when it does not, so the title keeps the room it needs.
	 */
	private displayId(entry: TabJumpEntry, availableWidth: number): string {
		if (entry.id.length <= TAB_JUMP_WHOLE_ID_LENGTH) return entry.id;
		if (visibleWidth(entry.title) + 1 + visibleWidth(entry.id) <= availableWidth) return entry.id;
		return entry.id.slice(0, TAB_JUMP_SHORT_ID_LENGTH);
	}

	/** One row: cursor, status glyph, title, then the id against the right edge. */
	private renderRow(entry: TabJumpEntry, selected: boolean, width: number): string {
		const cursor = selected ? theme.fg("accent", "›") : " ";
		const glyph = this.glyphFor(entry);
		const style = statusStyle(entry);
		// The cursor, a space, the glyph cell and two spaces sit left of the title; the id keeps a
		// two-cell gap of its own on the right.
		const leftWidth = visibleWidth(cursor) + 1 + visibleWidth(glyph) + 2;
		const id = this.displayId(entry, width - leftWidth - 2);
		const idWidth = visibleWidth(id);
		const titleWidth = Math.max(1, width - leftWidth - idWidth - 2);
		const title = truncateToWidth(entry.title, titleWidth, "...");
		const left = `${cursor} ${style ? style(glyph) : glyph}  ${highlightMatches(title, this.query, style)}`;
		const gap = Math.max(1, width - visibleWidth(left) - idWidth);
		return `${left}${" ".repeat(gap)}${theme.fg("dim", id)}`;
	}

	/** The search row: its label, the query, and the match count against the right edge. */
	private renderSearchRow(plan: TabJumpPlan, width: number): string {
		const left = ` ${theme.fg("dim", "Search")}  ${theme.fg("accent", this.query)}`;
		const count = `${plan.entries.length}/${this.entries.length} tabs${this.nonIdleOnly ? " non-idle" : ""}`;
		const gap = Math.max(1, width - visibleWidth(left) - visibleWidth(count));
		return `${left}${" ".repeat(gap)}${theme.fg("dim", count)}`;
	}

	/**
	 * The footer names the default chords rather than the configured ones, the way the command
	 * palette's own hint does; `/hotkeys` is the report that follows a rebind.
	 */
	private renderHintLine(): string {
		return "filter · ↑↓/ctrl+j/k/tab · ctrl+f non-idle · enter jump · esc cancel";
	}

	/**
	 * Identity of the list a pointer row currently maps into. Filtering, reordering or
	 * moving the window discards the highlight before another row can inherit it.
	 */
	private hoverRevision(plan: TabJumpPlan): string {
		return JSON.stringify([this.query, this.nonIdleOnly, this.selectedIndex, plan.entries.map((entry) => entry.id)]);
	}

	/**
	 * Row cells of the frame just rendered, spanning from the inner edge of the left border to
	 * the inner edge of the right one. `... more above/below` rows are not entries and answer
	 * no pointer.
	 */
	private hoverTargets(plan: TabJumpPlan, width: number): HoverTarget[] {
		return plan.rows.map((row) => ({
			id: String(row.entryIndex),
			x: 1,
			y: row.bodyLine + TAB_JUMP_FRAME_ROWS,
			width,
		}));
	}

	invalidate(): void {
		this.hover.reset();
	}

	/**
	 * Cut a body line to the panel's inner width and mark the cut with `...`. Every body line goes
	 * through here: a long query, a narrow panel and the marker rows can all overrun the frame.
	 */
	private fitLine(line: string, width: number): string {
		return truncateToWidth(line, width, "...");
	}

	render(width: number): string[] {
		this.lastWidth = width;
		const contentWidth = panelContentWidth(width, 0);
		const plan = this.plan();
		const body: string[] = [this.renderSearchRow(plan, contentWidth), ""];
		if (plan.empty) {
			body.push(theme.fg("dim", "No matching tabs"));
		} else {
			if (plan.showMoreAbove) body.push(theme.fg("dim", `... (${plan.startIndex} more above)`));
			for (const row of plan.rows) {
				const entry = plan.entries[row.entryIndex]!;
				const selected = row.entryIndex === this.selectedEntryIndex(plan.entries.length);
				const line = this.renderRow(entry, selected, contentWidth);
				// The cut marker comes before the padding: a padded row always fits, so marking after it
				// would silently drop the marker of a selected row that overruns the panel.
				body.push(
					selected ? theme.bg("selectedBg", padLine(this.fitLine(line, contentWidth), contentWidth)) : line,
				);
			}
			if (plan.showMoreBelow) {
				body.push(theme.fg("dim", `... (${plan.entries.length - plan.endIndex} more below)`));
			}
		}
		body.push("", theme.fg("dim", this.renderHintLine()));

		const frame = panel(
			"Tab Jump",
			body.map((line) => this.fitLine(line, contentWidth)),
			width,
			{
				paddingX: 0,
				backgroundColor: "toolPendingBg",
				backgroundScope: "content",
			},
		);
		// The hover cue goes on after the frame is built, so it covers the row cells
		// and not the panel borders.
		this.hover.layout(this.hoverTargets(plan, contentWidth), this.hoverRevision(plan));
		return this.hover.paint(frame, width);
	}

	handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
		// Passive motion only moves the highlight; it never selects or accepts a row. The
		// move is always answered, so the dispatcher knows this overlay still owns the pointer.
		if (event.type === "move" && event.button === "none") {
			return { handled: true, render: this.hover.move(event.x, event.y) };
		}
		// Every other pointer event drops a highlight the pointer may have left behind.
		const cleared = this.hover.clear();
		const repaintIfCleared = (): TuiMouseEventResult | undefined =>
			cleared ? { handled: true, render: true } : undefined;
		if (event.type === "wheel" && event.wheelDelta) {
			// The pointer anywhere over the panel scrolls the list.
			this.moveSelection(event.wheelDelta < 0 ? -1 : 1);
			return { handled: true, render: true };
		}
		// A click is what the terminal reports for a press and release on one cell, so acting on it
		// alone keeps one gesture to one jump. The press still has to answer: the compositor turns a
		// release into a click only for the component the recognized press landed on.
		if (event.type === "press") return { handled: true };
		if (event.type !== "click") return repaintIfCleared();
		// The border columns belong to the frame, not to the list.
		if (event.x < 1 || event.x > this.lastWidth - 2) return repaintIfCleared();
		const hit = this.plan().rows.find((row) => row.bodyLine + TAB_JUMP_FRAME_ROWS === event.y);
		if (!hit) return repaintIfCleared();
		this.selectedIndex = hit.entryIndex;
		this.accept();
		return { handled: true };
	}

	handleInput(data: string): void {
		const keybindings = getKeybindings();
		if (keybindings.matches(data, "app.tabJump.toggleNonIdle")) {
			const previousId = this.highlightedId();
			this.nonIdleOnly = !this.nonIdleOnly;
			this.reselect(previousId);
			return;
		}
		// The movement chords are answered before Enter: the terminal encodes ctrl+j as the
		// same byte Enter carries, and ctrl+j moves the highlight rather than jumping.
		if (keybindings.matches(data, "app.tabJump.selectPrevious")) {
			this.moveSelection(-1);
			return;
		}
		if (keybindings.matches(data, "app.tabJump.selectNext")) {
			this.moveSelection(1);
			return;
		}
		if (keybindings.matches(data, "tui.select.confirm")) {
			this.accept();
			return;
		}
		if (keybindings.matches(data, "tui.select.cancel")) {
			this.onCancel();
			return;
		}
		if (keybindings.matches(data, "tui.editor.deleteCharBackward")) {
			this.setQuery(this.query.slice(0, -1));
			return;
		}
		// Only printable input types into the query; every other control key is swallowed,
		// because the composer behind the overlay must never see a key pressed here.
		if (data.length > 0 && !/[\x00-\x1f\x7f]/.test(data)) this.setQuery(this.query + data);
	}

	/** Replace the query, keeping the highlight on the tab it was on while that tab survives. */
	private setQuery(query: string): void {
		const previousId = this.highlightedId();
		this.query = query;
		this.reselect(previousId);
	}
}
