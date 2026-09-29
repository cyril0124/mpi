/**
 * Tab bar for the multi-tab workspace: one chip per open tab, packed into rows.
 *
 * A chip's text carries its own SGR sequences, so a painter that wraps it has to
 * re-open its own sequence after every inner reset (see {@link chipPaint}).
 *
 * When the chips do not fit, {@link TabBar.findWindow} picks the window that
 * keeps the most of them around the active tab and the rest collapse into dim
 * overflow counts.
 */
import {
	type Component,
	type TuiMouseEvent,
	type TuiMouseEventResult,
	truncateToWidth,
	visibleWidth,
} from "@earendil-works/pi-tui";
import { isWorkingStatus, type TabColorName, type TabStatus } from "../../../../../core/mixcode/multi-tab/types.ts";
import { theme } from "../../../theme/theme.ts";
import { type HoverTarget, PointerHover } from "../hover/pointer-hover.ts";
import { applyActiveTabShimmer, COLORED_SHIMMER_STYLES, THEME_SHIMMER_STYLES } from "../tab-shimmer.ts";

export interface TabBarItem {
	id: string;
	title: string;
	status: TabStatus;
	unread: boolean;
	/**
	 * MRU rank among the tabs the bar does not show as active: 0 is the most
	 * recently focused one. -1 marks the active surface and every tab without a
	 * rank.
	 */
	recentRank: number;
	color?: TabColorName;
	/** Non-persisted: when this tab last took focus, starting its title shimmer. */
	activatedAt?: number;
}

export interface TabBarModel {
	tabs: readonly TabBarItem[];
	activeId: string;
	/**
	 * Leading surface chip (MixCode Home). Pinned to the first row and never
	 * hidden by agent-tab overflow; `label` is the bare name, without padding.
	 */
	home?: { id: string; label: string };
	/** Painter for the separator rule and the focus mark; defaults to a muted border. */
	rulePainter?: (text: string) => string;
	/** Row cap for the bar; the rest of the tabs collapse into overflow counts. */
	maxRows?: number;
}

/** Visible cells of one chip in the last rendered frame, in zero-based coordinates. */
interface ChipRect {
	id: string;
	row: number;
	start: number;
	end: number;
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
/** A pinned Home chip is abbreviated once it would take more than this share of the row. */
const HOME_PIN_FULL_MAX_RATIO = 0.15;
/** Abbreviated pinned Home chip. */
const HOME_COMPACT_LABEL = " H ";
/** MRU ranks the bar paints as recently focused. */
const RECENT_CHIP_RANKS = 2;

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

/** Text before the first printable cell of a painter's output (its open SGR sequence). */
function paintOpenSeq(paint: (text: string) => string): string {
	const marked = paint("\u0000");
	const index = marked.indexOf("\u0000");
	return index >= 0 ? marked.slice(0, index) : "";
}

/**
 * Chip painter that re-opens its own SGR after an inner reset. The active chip's
 * shimmer wave emits foreground, bold, and inverse resets mid-title, which would
 * otherwise strip the chip's background and text color from the rest of it.
 */
function chipPaint(base: (text: string) => string): (text: string) => string {
	const open = paintOpenSeq(base);
	if (!open) return base;
	return (text) => base(text.replace(/\x1b\[(0|22|27|39|49)m/g, (reset) => `${reset}${open}`));
}

/** Chip painter for a tab color: the color's contrast pair, reset-safe. */
export function tabColorPaint(color: TabColorName): (text: string) => string {
	const cached = tabColorPaints.get(color);
	if (cached) return cached;
	const { bg, fg } = TAB_COLOR_SGR[color];
	const start = `\x1b[${bg}m\x1b[${fg}m`;
	const paint = chipPaint((text: string) => `${start}${text}\x1b[39m\x1b[49m`);
	tabColorPaints.set(color, paint);
	return paint;
}

/** Status glyph shared by the tab chips and the Home roster cards. */
export function tabStatusGlyph(status: TabStatus, unread: boolean): string {
	if (unread && status !== "error") return GLYPHS.done;
	return GLYPHS[status];
}

function glyphPainter(item: TabBarItem): ((text: string) => string) | undefined {
	if (item.status === "error") return (text) => theme.fg("error", text);
	if (item.unread) return (text) => theme.fg("success", text);
	if (isWorkingStatus(item.status)) return (text) => theme.fg("accent", text);
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

/**
 * A chip's title. The focused chip carries the shimmer wave, which supplies its
 * own brightness steps; the chip paint around it supplies the weight and color
 * of every unlit cell. An inactive completed tab stays emphasized until it is
 * focused: bold in the success color, or on a colored chip just bold, because
 * that chip's own foreground pair already has contrast.
 */
function chipTitle(item: TabBarItem, active: boolean, completed: boolean): string {
	if (active) {
		return theme.bold(
			applyActiveTabShimmer(
				item.title,
				item.activatedAt,
				Date.now(),
				item.color ? COLORED_SHIMMER_STYLES : THEME_SHIMMER_STYLES,
			),
		);
	}
	if (item.color) return completed ? theme.bold(item.title) : item.title;
	return completed ? theme.bold(theme.fg("success", item.title)) : item.title;
}

function renderChip(item: TabBarItem, active: boolean, markPainter: (text: string) => string): string {
	const glyph = tabStatusGlyph(item.status, item.unread);
	const glyphPaint = glyphPainter(item);
	const completed = glyph === GLYPHS.done;
	const body = ` ${glyph} ${chipTitle(item, active, completed)} `;

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
		// The completion color sits in the chip paint, not around the title, so the
		// wave's inner resets re-open into it and every unlit cell keeps it; the
		// wave colors only the lit cells.
		const titleColor = completed ? "success" : "text";
		const paint = chipPaint((text: string) => theme.bg("selectedBg", theme.fg(titleColor, text)));
		const marked = `${markPainter(FOCUS_MARK)}${body.slice(1)}`;
		return paintChip(paint, marked, glyph, glyphPaint);
	}

	const recent = item.recentRank >= 0 && item.recentRank < RECENT_CHIP_RANKS;
	const paint = (text: string) => theme.bg("toolPendingBg", theme.fg(recent ? "text" : "muted", text));
	return paintChip(paint, body, glyph, glyphPaint);
}

interface Chip {
	id: string;
	text: string;
}

/** A chip window that fits, with the counts that ranked it against other windows. */
interface WindowFit {
	rows: Chip[][];
	/** Chips the window keeps visible. */
	visible: number;
	hiddenLeft: number;
	hiddenRight: number;
}

/**
 * Whether `candidate` beats `best`: more visible chips first, then the smaller
 * left/right imbalance, then fewer hidden on the left.
 */
function prefersWindow(candidate: WindowFit, best: WindowFit | undefined): boolean {
	if (!best) return true;
	if (candidate.visible !== best.visible) return candidate.visible > best.visible;
	const candidateImbalance = Math.abs(candidate.hiddenLeft - candidate.hiddenRight);
	const bestImbalance = Math.abs(best.hiddenLeft - best.hiddenRight);
	if (candidateImbalance !== bestImbalance) return candidateImbalance < bestImbalance;
	return candidate.hiddenLeft < best.hiddenLeft;
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

function overflowHint(side: "left" | "right", count: number): string | undefined {
	if (count <= 0) return undefined;
	return side === "left" ? ` +${count} ${ELLIPSIS} ` : ` ${ELLIPSIS} +${count}`;
}

/** Columns one overflow hint takes, its leading separator included. */
function overflowHintWidth(side: "left" | "right", count: number): number {
	return visibleWidth(overflowHint(side, count) ?? "");
}

/** Whether the full Home label would take more of the row than the pinned budget allows. */
function packedHomeNeedsAbbreviation(label: string, width: number): boolean {
	return visibleWidth(label) / Math.max(1, width) > HOME_PIN_FULL_MAX_RATIO;
}

export class TabBar implements Component {
	private readonly getModel: () => TabBarModel;
	private readonly onSelect: (id: string) => void;
	private hitRegions: ChipRect[] = [];
	private readonly hover = new PointerHover();
	/** Active tab of the last render; a switch cancels a highlight on the chip that lost focus. */
	private hoverRevision: string | undefined;

	constructor(getModel: () => TabBarModel, onSelect: (id: string) => void) {
		this.getModel = getModel;
		this.onSelect = onSelect;
	}

	invalidate(): void {
		this.hover.reset();
	}

	render(width: number): string[] {
		const lines = this.renderLines(width);
		this.hover.layout(this.hoverTargets(), this.hoverRevision);
		return this.hover.paint(lines, width);
	}

	/** Chip rectangles of the frame just rendered, which the pointer hit-tests against. */
	private hoverTargets(): HoverTarget[] {
		return this.hitRegions.map((region) => ({
			id: region.id,
			x: region.start,
			y: region.row,
			width: region.end - region.start + 1,
		}));
	}

	private renderLines(width: number): string[] {
		this.hitRegions = [];
		if (width <= 0) return [];
		const model = this.getModel();
		this.hoverRevision = model.activeId;
		if (model.tabs.length === 0 && !model.home) return [];
		const markPainter = model.rulePainter ?? ((text: string) => theme.fg("borderMuted", text));

		const chips: Chip[] = model.tabs.map((item) => ({
			id: item.id,
			text: renderChip(item, item.id === model.activeId, markPainter),
		}));
		const maxRows = Math.max(1, model.maxRows ?? Number.POSITIVE_INFINITY);
		const home = model.home;
		const homeActive = home !== undefined && model.activeId === home.id;
		const fullHomeText = home ? ` ${home.label} ` : undefined;
		if (chips.length === 0) {
			// Nothing to clip: the Home chip stands alone with its full label.
			if (fullHomeText === undefined || visibleWidth(fullHomeText) > width) {
				return [markPainter(RULE_CHAR.repeat(width))];
			}
			const chip = this.renderHomeChip(fullHomeText!, homeActive, markPainter);
			this.hitRegions.push({
				id: home!.id,
				row: 0,
				start: 0,
				end: Math.max(0, visibleWidth(fullHomeText!) - 1),
			});
			return [truncateToWidth(chip, width, ""), markPainter(RULE_CHAR.repeat(width))];
		}

		/** Pack the agent chips with the given leading Home chip; undefined when they do not fit. */
		const packWithHome = (homeText: string | undefined): { rows: Chip[][]; prefix: number } | undefined => {
			const prefix = homeText === undefined ? 0 : visibleWidth(homeText) + (chips.length > 0 ? 1 : 0);
			const rows = packRows(chips, () => width - prefix, maxRows);
			return rows ? { rows, prefix } : undefined;
		};

		let homeText = fullHomeText;
		let packed = packWithHome(homeText);
		if (!packed && home && !homeActive && packedHomeNeedsAbbreviation(fullHomeText!, width)) {
			homeText = HOME_COMPACT_LABEL;
			packed = packWithHome(homeText);
		}
		const prefix =
			packed?.prefix ?? (homeText === undefined ? 0 : visibleWidth(homeText) + (chips.length > 0 ? 1 : 0));

		// Fast path: everything fits without hiding chips.
		let rows = packed?.rows;
		let hiddenLeft = 0;
		let hiddenRight = 0;

		if (!rows) {
			const activeIndex = chips.findIndex((chip) => chip.id === model.activeId);
			const preferred = activeIndex >= 0 ? activeIndex : 0;
			const candidate = this.findWindow(chips, preferred, width, maxRows, prefix);
			rows = candidate?.rows;
			hiddenLeft = candidate?.hiddenLeft ?? 0;
			hiddenRight = candidate?.hiddenRight ?? 0;
		}

		// Wrapped rows indent to the column where the first agent chip starts: past
		// the Home chip, its gutter, and any left-overflow hint.
		const indent = Math.max(0, Math.min(prefix + overflowHintWidth("left", hiddenLeft), width - 1));

		if (!rows) {
			// Nothing fits: keep the active chip alone, truncated if needed.
			const activeIndex = chips.findIndex((chip) => chip.id === model.activeId);
			const chip = chips[activeIndex >= 0 ? activeIndex : 0]!;
			const text =
				visibleWidth(chip.text) > Math.max(1, width - prefix)
					? truncateToWidth(chip.text, Math.max(1, width - prefix), ELLIPSIS)
					: chip.text;
			this.hitRegions.push({
				id: chip.id,
				row: 0,
				start: prefix,
				end: prefix + Math.max(0, visibleWidth(text) - 1),
			});
			rows = [[{ id: chip.id, text }]];
		}

		const lines: string[] = [];
		for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
			const isFirst = rowIndex === 0;
			const isLast = rowIndex === rows.length - 1;
			const rowChips = rows[rowIndex]!;
			let line = isFirst ? "" : " ".repeat(indent);
			let x = visibleWidth(line);
			if (isFirst && homeText !== undefined) {
				const homeChip = this.renderHomeChip(homeText, homeActive, markPainter);
				line += homeChip;
				this.hitRegions.push({ id: home!.id, row: 0, start: 0, end: Math.max(0, visibleWidth(homeText) - 1) });
				x += visibleWidth(homeText);
			}
			const leftHint = overflowHint("left", hiddenLeft);
			if (isFirst && leftHint !== undefined) {
				line += theme.fg("dim", leftHint);
				x += visibleWidth(leftHint);
			}
			if (isFirst && homeText !== undefined && rowChips.length > 0) {
				line += " ";
				x += 1;
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
			const rightHint = overflowHint("right", hiddenRight);
			if (isLast && rightHint !== undefined) line += theme.fg("dim", rightHint);
			lines.push(truncateToWidth(line, width, ""));
		}
		lines.push(markPainter(RULE_CHAR.repeat(width)));
		return lines;
	}

	/**
	 * Home chip painter. Active Home uses the same selected background and focus
	 * mark as an active agent chip; a pinned inactive Home keeps its own accent
	 * pair so it stays distinguishable from the agent chips beside it.
	 */
	private renderHomeChip(text: string, active: boolean, markPainter: (text: string) => string): string {
		if (active) {
			const marked = `${markPainter(FOCUS_MARK)}${text.slice(1)}`;
			return theme.bg("selectedBg", theme.fg("text", theme.bold(marked)));
		}
		return theme.bg("toolPendingBg", theme.fg("accent", text));
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
		maxRows: number,
		prefix = 0,
	): WindowFit | undefined {
		let best: WindowFit | undefined;
		for (let start = 0; start <= preferred; start += 1) {
			for (let end = preferred; end < chips.length; end += 1) {
				const hiddenLeft = start;
				const hiddenRight = chips.length - 1 - end;
				// Home, its gutter, and the left hint occupy the first row, and the
				// wrapped rows indent to that same column, so every row shares one
				// budget. The right hint is reserved on every row so the last row fits.
				const budget = Math.max(
					1,
					width - prefix - overflowHintWidth("left", hiddenLeft) - overflowHintWidth("right", hiddenRight),
				);
				const rows = packRows(chips.slice(start, end + 1), () => budget, maxRows);
				if (!rows) continue;
				const candidate: WindowFit = { rows, visible: end - start + 1, hiddenLeft, hiddenRight };
				if (prefersWindow(candidate, best)) best = candidate;
			}
		}
		return best;
	}

	handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
		// Passive motion only moves the highlight; it never activates a tab. The move is
		// always answered, so the dispatcher knows this component still owns the pointer.
		if (event.type === "move" && event.button === "none") {
			return { handled: true, render: this.hover.move(event.x, event.y) };
		}
		// Every other pointer event drops a highlight the pointer may have left behind.
		const cleared = this.hover.clear();
		const repaintIfCleared = (): TuiMouseEventResult | undefined =>
			cleared ? { handled: true, render: true } : undefined;
		if (event.button !== "left" || (event.type !== "click" && event.type !== "press")) return repaintIfCleared();
		const region = this.chipAt(event.x, event.y);
		if (!region) return repaintIfCleared();
		this.onSelect(region.id);
		return { handled: true };
	}

	/** Chip whose visible cells hold the pointer in the last rendered frame. */
	private chipAt(x: number, y: number): ChipRect | undefined {
		if (y < 0) return undefined;
		return this.hitRegions.find((entry) => entry.row === y && x >= entry.start && x <= entry.end);
	}
}
