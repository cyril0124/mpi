/**
 * Tab bar for the multi-tab workspace: a status glyph per chip, recency-based
 * emphasis, an optional per-tab color, a focus mark on the active chip,
 * click-to-focus, wrapping rows, overflow counts, and a separator rule.
 */
import {
	type Component,
	type TuiMouseEvent,
	type TuiMouseEventResult,
	truncateToWidth,
	visibleWidth,
} from "@earendil-works/pi-tui";
import type { TabColorName, TabStatus } from "../../../../../core/mixcode/multi-tab/types.ts";
import { theme } from "../../../theme/theme.ts";

export interface TabBarItem {
	id: string;
	title: string;
	status: TabStatus;
	unread: boolean;
	/** MRU rank: 0/1 are the two most recently focused inactive tabs; -1 = other. */
	recentRank: number;
	color?: TabColorName;
}

export interface TabBarModel {
	tabs: readonly TabBarItem[];
	activeId: string;
	/** Painter for the separator rule and the focus mark; defaults to a muted border. */
	rulePainter?: (text: string) => string;
	/** Row cap for the bar; the rest of the tabs collapse into overflow counts. */
	maxRows?: number;
}

const GLYPHS: Record<TabStatus, string> = {
	idle: "-",
	running: "\u25cf",
	thinking: "\u25cf",
	error: "x",
	done: "\u2713",
};

/** Marks the active chip by replacing its leading space. */
const FOCUS_MARK = "\u258c";
const FOCUS_MARK_INNER = "\u2590";
const RULE_CHAR = "\u2500";
const ELLIPSIS = "\u2026";

/** ANSI 16-color background/foreground pairs. */
const TAB_COLOR_SGR: Record<TabColorName, { bg: number; fg: number }> = {
	red: { bg: 41, fg: 97 },
	green: { bg: 42, fg: 30 },
	yellow: { bg: 43, fg: 30 },
	blue: { bg: 44, fg: 97 },
	magenta: { bg: 45, fg: 97 },
	cyan: { bg: 46, fg: 30 },
	white: { bg: 47, fg: 30 },
	gray: { bg: 100, fg: 97 },
};

const tabColorPaints = new Map<TabColorName, (text: string) => string>();

/** Chip painter for a tab color; re-opens the background after inner SGR resets. */
function tabColorPaint(color: TabColorName): (text: string) => string {
	const cached = tabColorPaints.get(color);
	if (cached) return cached;
	const { bg, fg } = TAB_COLOR_SGR[color];
	const start = `\x1b[${bg}m\x1b[${fg}m`;
	const paint = (text: string) =>
		`${start}${text
			.replace(/\x1b\[0m/g, `\x1b[0m${start}`)
			.replace(/\x1b\[39m/g, `\x1b[39m${start}`)
			.replace(/\x1b\[49m/g, `\x1b[49m${start}`)}\x1b[39m\x1b[49m`;
	tabColorPaints.set(color, paint);
	return paint;
}

/** Text before the first printable cell of a painter's output (its open SGR sequence). */
function paintOpenSeq(paint: (text: string) => string): string {
	const marked = paint("\u0000");
	const index = marked.indexOf("\u0000");
	return index >= 0 ? marked.slice(0, index) : "";
}

function glyphFor(item: TabBarItem): string {
	if (item.unread && item.status !== "error") return GLYPHS.done;
	return GLYPHS[item.status];
}

function glyphPainter(item: TabBarItem): ((text: string) => string) | undefined {
	if (item.status === "error") return (text) => theme.fg("error", text);
	if (item.unread) return (text) => theme.fg("success", text);
	if (item.status === "running" || item.status === "thinking") return (text) => theme.fg("accent", text);
	return undefined;
}

/** Paint a chip body, keeping a status color on the leading glyph. */
function paintChip(
	paint: (text: string) => string,
	body: string,
	glyph: string,
	glyphPaint?: (t: string) => string,
): string {
	const painted = paint(body);
	if (!glyphPaint) return painted;
	const open = paintOpenSeq(paint);
	const index = painted.indexOf(glyph);
	if (index < 0) return painted;
	return `${painted.slice(0, index)}${glyphPaint(glyph)}${open}${painted.slice(index + glyph.length)}`;
}

function renderChip(item: TabBarItem, active: boolean, markPainter: (text: string) => string): string {
	const glyph = glyphFor(item);
	const glyphPaint = glyphPainter(item);
	// A completed tab stays emphasized until it is focused: bold label, plain
	// foreground, success-colored glyph.
	const completed = glyph === GLYPHS.done;
	// A completed tab keeps its emphasis until it is focused: bold label in the
	// completion color, regardless of recency.
	const label = (text: string) => {
		if (completed) return theme.bold(theme.fg("success", text));
		return active ? theme.bold(text) : text;
	};
	// A colored chip keeps its own foreground pair, so completion shows there as
	// the glyph plus a bold label rather than a recolored label.
	const coloredLabel = (text: string) => (active || completed ? theme.bold(text) : text);
	const body = ` ${glyph} ${(item.color ? coloredLabel : label)(item.title)} `;

	if (item.color) {
		const paint = tabColorPaint(item.color);
		// A colored chip keeps its own foreground pair for the whole chip, glyph
		// included: the completion color does not clear the pair's contrast, so
		// completion shows through the glyph and a bold title only.
		if (!active) return paintChip(paint, body, glyph, undefined);
		// The colored focus mark sits inside the color pair, so the chip keeps its
		// background across the mark.
		return paintChip(paint, `${FOCUS_MARK_INNER}${body.slice(1)}`, glyph, undefined);
	}

	if (active) {
		const paint = (text: string) => theme.bg("selectedBg", theme.fg("text", text));
		const marked = `${markPainter(FOCUS_MARK)}${body.slice(1)}`;
		return paintChip(paint, marked, glyph, glyphPaint);
	}

	const recent = item.recentRank === 0 || item.recentRank === 1;
	const paint = (text: string) => theme.bg("toolPendingBg", theme.fg(recent ? "text" : "muted", text));
	return paintChip(paint, body, glyph, glyphPaint);
}

interface Chip {
	id: string;
	text: string;
}

/** Greedy row packing; a chip is never split. Undefined when a chip cannot fit its row. */
function packRows(
	chips: readonly Chip[],
	budgetForRow: (rowIndex: number) => number,
	maxRows: number,
): Chip[][] | undefined {
	const rows: Chip[][] = [];
	let row: Chip[] = [];
	let used = 0;
	for (const chip of chips) {
		const width = visibleWidth(chip.text);
		const budget = budgetForRow(rows.length);
		if (used > 0 && used + 1 + width > budget) {
			rows.push(row);
			if (rows.length >= maxRows) return undefined;
			row = [];
			used = 0;
			if (width > budgetForRow(rows.length)) return undefined;
		} else if (used === 0 && width > budget) {
			return undefined;
		}
		row.push(chip);
		used = used === 0 ? width : used + 1 + width;
	}
	if (row.length > 0) rows.push(row);
	return rows.length > 0 ? rows : undefined;
}

function hintWidth(kind: "left" | "right", count: number): number {
	if (count <= 0) return 0;
	return kind === "left" ? 1 + visibleWidth(`+${count} ${ELLIPSIS} `) : visibleWidth(` ${ELLIPSIS} +${count}`);
}

export class TabBar implements Component {
	private readonly getModel: () => TabBarModel;
	private readonly onSelect: (id: string) => void;
	private hitRegions: Array<{ id: string; row: number; start: number; end: number }> = [];

	constructor(getModel: () => TabBarModel, onSelect: (id: string) => void) {
		this.getModel = getModel;
		this.onSelect = onSelect;
	}

	invalidate(): void {
		// No cached state to invalidate.
	}

	render(width: number): string[] {
		this.hitRegions = [];
		if (width <= 0) return [];
		const model = this.getModel();
		if (model.tabs.length === 0) return [];
		const markPainter = model.rulePainter ?? ((text: string) => theme.fg("borderMuted", text));

		const chips: Chip[] = model.tabs.map((item) => ({
			id: item.id,
			text: renderChip(item, item.id === model.activeId, markPainter),
		}));
		const indent = Math.max(0, Math.min(visibleWidth(chips[0]!.text) + 1, width - 1));
		const maxRows = Math.max(1, model.maxRows ?? Number.POSITIVE_INFINITY);

		// Fast path: everything fits without hiding chips.
		let rows = packRows(chips, (rowIndex) => (rowIndex === 0 ? width : width - indent), maxRows);
		let hiddenLeft = 0;
		let hiddenRight = 0;

		if (!rows) {
			const activeIndex = chips.findIndex((chip) => chip.id === model.activeId);
			const preferred = activeIndex >= 0 ? activeIndex : 0;
			const candidate = this.findWindow(chips, preferred, width, indent, maxRows);
			rows = candidate?.rows;
			hiddenLeft = candidate?.hiddenLeft ?? 0;
			hiddenRight = candidate?.hiddenRight ?? 0;
		}

		if (!rows) {
			// Nothing fits: keep the active chip alone, truncated if needed.
			const activeIndex = chips.findIndex((chip) => chip.id === model.activeId);
			const chip = chips[activeIndex >= 0 ? activeIndex : 0]!;
			const text = visibleWidth(chip.text) > width ? truncateToWidth(chip.text, width, ELLIPSIS) : chip.text;
			this.hitRegions.push({ id: chip.id, row: 0, start: 0, end: Math.max(0, visibleWidth(text) - 1) });
			rows = [[{ id: chip.id, text }]];
		}

		const lines: string[] = [];
		for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
			const isFirst = rowIndex === 0;
			const isLast = rowIndex === rows.length - 1;
			const rowChips = rows[rowIndex]!;
			let line = isFirst ? "" : " ".repeat(indent);
			let x = visibleWidth(line);
			if (isFirst && hiddenLeft > 0) {
				const hint = `+${hiddenLeft} ${ELLIPSIS} `;
				line += ` ${theme.fg("dim", hint)}`;
				x += hintWidth("left", hiddenLeft);
			}
			for (let index = 0; index < rowChips.length; index += 1) {
				const chip = rowChips[index]!;
				if (index > 0) {
					line += " ";
					x += 1;
				}
				const chipWidth = visibleWidth(chip.text);
				this.hitRegions.push({ id: chip.id, row: rowIndex, start: x, end: x + chipWidth - 1 });
				line += chip.text;
				x += chipWidth;
			}
			if (isLast && hiddenRight > 0) {
				line += theme.fg("dim", ` ${ELLIPSIS} +${hiddenRight}`);
			}
			lines.push(truncateToWidth(line, width, ""));
		}
		lines.push(markPainter(RULE_CHAR.repeat(width)));
		return lines;
	}

	/**
	 * Smallest window of chips that contains `preferred` and fits the width,
	 * preferring more visible chips, then a smaller left/right imbalance, then
	 * fewer hidden on the left.
	 */
	private findWindow(
		chips: readonly Chip[],
		preferred: number,
		width: number,
		indent: number,
		maxRows: number,
	): { rows: Chip[][]; hiddenLeft: number; hiddenRight: number } | undefined {
		let best: { rows: Chip[][]; hiddenLeft: number; hiddenRight: number } | undefined;
		for (let start = 0; start <= preferred; start += 1) {
			for (let end = preferred; end < chips.length; end += 1) {
				const hiddenLeft = start;
				const hiddenRight = chips.length - 1 - end;
				const left = hintWidth("left", hiddenLeft);
				const right = hintWidth("right", hiddenRight);
				const rows = packRows(
					chips.slice(start, end + 1),
					(rowIndex) => {
						// The left hint occupies the first row only; the right hint is
						// reserved on every row so the last row always has room.
						const reserveLeft = rowIndex === 0 ? left : 0;
						const budget = Math.max(1, width - reserveLeft - right);
						return rowIndex === 0 ? budget : Math.min(budget, Math.max(1, width - indent - right));
					},
					maxRows,
				);
				if (!rows) continue;
				const visible = end - start + 1;
				if (
					!best ||
					visible > best.rows.flat().length ||
					(visible === best.rows.flat().length &&
						(Math.abs(hiddenLeft - hiddenRight) < Math.abs(best.hiddenLeft - best.hiddenRight) ||
							(Math.abs(hiddenLeft - hiddenRight) === Math.abs(best.hiddenLeft - best.hiddenRight) &&
								hiddenLeft < best.hiddenLeft)))
				) {
					best = { rows, hiddenLeft, hiddenRight };
				}
			}
		}
		return best;
	}

	handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
		if (event.button !== "left") return undefined;
		if (event.type !== "click" && event.type !== "press") return undefined;
		const row = event.y < 0 ? -1 : event.y;
		if (row < 0) return undefined;
		const region = this.hitRegions.find(
			(entry) => entry.row === row && event.x >= entry.start && event.x <= entry.end,
		);
		if (!region) return undefined;
		this.onSelect(region.id);
		return { handled: true };
	}
}
