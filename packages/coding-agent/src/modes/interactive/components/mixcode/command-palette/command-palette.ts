/**
 * Command palette: a searchable list of the slash commands the UI can run, shown
 * as a centered overlay so it floats over the draft instead of replacing it. The
 * chosen command is submitted through the editor's normal submit path, so its
 * argument parsing, gating and error reporting apply unchanged.
 *
 * Filtering matches the command name only. A description must never decide which
 * rows survive, or the highlight would light up in a column that took no part in
 * the match.
 */
import {
	type Component,
	fuzzyFilter,
	getKeybindings,
	Input,
	type SelectItem,
	SelectList,
	type SelectListLayoutOptions,
	type TuiMouseEvent,
	type TuiMouseEventResult,
} from "@earendil-works/pi-tui";
import { getSelectListTheme, theme } from "../../../theme/theme.ts";
import { panel, panelContentWidth } from "../panel.ts";

/** One runnable entry, addressed by its command name without the leading slash. */
export interface CommandPaletteEntry {
	name: string;
	description?: string;
}

const PALETTE_SELECT_LIST_LAYOUT: SelectListLayoutOptions = {
	minPrimaryColumnWidth: 14,
	maxPrimaryColumnWidth: 40,
};

/** Rendered lines above the first command row: the top border, search row and separator. */
const PALETTE_LINES_ABOVE_ROWS = 3;

/**
 * Rows the panel spends on chrome, leaving `rowBudget - PALETTE_FRAME_ROWS` for list
 * rows: the two border rows, the search row, the separator, the blank line, the hint,
 * and the row the list keeps for its scroll indicator.
 */
const PALETTE_FRAME_ROWS = 7;

/** Display label for a command row, e.g. `model` -> `/model`. */
function commandLabel(name: string): string {
	return `/${name}`;
}

/** Indices where `token` appears in `text` in order, or undefined when it does not. */
function subsequenceIndices(token: string, text: string): number[] | undefined {
	const indices: number[] = [];
	let cursor = 0;
	for (const character of token) {
		const index = text.indexOf(character, cursor);
		if (index === -1) return undefined;
		indices.push(index);
		cursor = index + 1;
	}
	return indices;
}

/** The letters/digits transposition pi-tui's `fuzzyFilter` also accepts, e.g. `4gpt` for `gpt-4`. */
function transposedToken(token: string): string | undefined {
	const lettersFirst = token.match(/^([a-z]+)([0-9]+)$/);
	if (lettersFirst) return `${lettersFirst[2]}${lettersFirst[1]}`;
	const digitsFirst = token.match(/^([0-9]+)([a-z]+)$/);
	if (digitsFirst) return `${digitsFirst[2]}${digitsFirst[1]}`;
	return undefined;
}

/**
 * Indices in `text` where the query matched, tokenising exactly as pi-tui's `fuzzyFilter`
 * does (`packages/tui/src/fuzzy.ts`): tokens split on whitespace and slashes, every
 * token must appear in order, and a token of letters and digits may match transposed.
 * `FuzzyMatch` exposes only `{matches, score}` and no match positions, so this copy
 * exists to know which characters to highlight; a change to the library's matching
 * rules must be mirrored here.
 */
function matchedIndices(query: string, text: string): Set<number> {
	const haystack = text.toLowerCase();
	const indices = new Set<number>();
	for (const token of query
		.trim()
		.toLowerCase()
		.split(/[\s/]+/)) {
		if (!token) continue;
		const direct = subsequenceIndices(token, haystack);
		if (direct) {
			for (const index of direct) indices.add(index);
			continue;
		}
		const transposed = transposedToken(token);
		const swapped = transposed ? subsequenceIndices(transposed, haystack) : undefined;
		if (!swapped) return new Set();
		for (const index of swapped) indices.add(index);
	}
	return indices;
}

/** Paint the characters the query matched, the way the rest of the UI marks search hits. */
function highlightMatches(text: string, query: string): string {
	const indices = matchedIndices(query, text);
	if (indices.size === 0) return text;
	let painted = "";
	for (let index = 0; index < text.length; index++) {
		const character = text[index]!;
		painted += indices.has(index) ? theme.bg("searchMatchBg", theme.fg("searchMatchText", character)) : character;
	}
	return painted;
}

/**
 * Searchable command list. Enter runs the highlighted command and Esc closes
 * without running anything; the search input owns the query text and forwards its
 * submit to the list, so moving the highlight never types into the query.
 */
export class CommandPaletteComponent implements Component {
	private readonly entries: CommandPaletteEntry[];
	private readonly maxVisibleRows: number;
	private readonly onRun: (name: string) => void;
	private readonly onCancel: () => void;
	private readonly searchInput: Input;
	private selectList: SelectList;
	/** Rows painted by the last render, which is what a pointer row maps into. */
	private lastRowCount = 0;
	private query = "";

	/** `rowBudget` is every row the panel may occupy, its frame included. */
	constructor(entries: CommandPaletteEntry[], rowBudget: number, onRun: (name: string) => void, onCancel: () => void) {
		this.entries = entries;
		this.maxVisibleRows = Math.max(1, rowBudget - PALETTE_FRAME_ROWS);
		this.onRun = onRun;
		this.onCancel = onCancel;

		this.searchInput = new Input();
		// Enter belongs to the list: the search input only owns the query text.
		this.searchInput.onSubmit = () => this.selectList.handleInput("\r");

		this.selectList = this.buildSelectList(entries);
	}

	private buildSelectList(entries: CommandPaletteEntry[]): SelectList {
		const items: SelectItem[] = entries.map((entry) => ({
			value: entry.name,
			label: commandLabel(entry.name),
			description: entry.description,
		}));
		const list = new SelectList(
			items,
			Math.min(Math.max(items.length, 1), this.maxVisibleRows),
			getSelectListTheme(),
			{
				...PALETTE_SELECT_LIST_LAYOUT,
				truncatePrimary: ({ text }) => highlightMatches(text, this.query),
			},
		);
		list.onSelect = (item) => this.onRun(item.value);
		list.onCancel = this.onCancel;
		return list;
	}

	private applyFilter(query: string): void {
		const filtered = query ? fuzzyFilter(this.entries, query, (entry) => commandLabel(entry.name)) : this.entries;
		this.selectList = this.buildSelectList(filtered);
	}

	invalidate(): void {
		this.searchInput.invalidate?.();
		this.selectList.invalidate?.();
	}

	render(width: number): string[] {
		const contentWidth = panelContentWidth(width);
		const rows = this.selectList.render(contentWidth);
		this.lastRowCount = rows.length;

		return panel(
			"Command Palette",
			[
				...this.searchInput.render(contentWidth),
				theme.fg("borderMuted", "─".repeat(contentWidth)),
				...rows,
				"",
				theme.fg("dim", "  ↑↓ select   enter run   esc close"),
			],
			width,
		);
	}

	handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
		if (event.y < PALETTE_LINES_ABOVE_ROWS) return undefined;
		return this.selectList.handleMouse({
			...event,
			y: event.y - PALETTE_LINES_ABOVE_ROWS,
			height: this.lastRowCount,
		});
	}

	handleInput(data: string): void {
		const keybindings = getKeybindings();
		// Arrows move the highlight and Esc closes; everything else, Enter
		// included, belongs to the search input, whose submit forwards to the
		// list so the query text survives navigation.
		const isNavigation =
			keybindings.matches(data, "tui.select.up") ||
			keybindings.matches(data, "tui.select.down") ||
			keybindings.matches(data, "tui.select.cancel");
		if (isNavigation) {
			this.selectList.handleInput(data);
			return;
		}
		this.searchInput.handleInput(data);
		this.query = this.searchInput.getValue();
		this.applyFilter(this.query);
	}
}
