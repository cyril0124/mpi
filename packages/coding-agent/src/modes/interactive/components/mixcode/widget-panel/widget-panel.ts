/**
 * The extension widget side panel: a right-hand column that collects the
 * above- and below-editor widgets beside the chat while it is open, so they
 * stop stacking around the composer.
 *
 * The panel is per-tab state (open flag plus a scroll offset). It renders a
 * framed column — a muted left border, a pinned dim title, one dim section
 * rule per widget, and a dim close hint — and windows its content at the
 * scroll offset, marking hidden rows with "↑ more"/"↓ more". Wide lines wrap
 * instead of truncating, because every row stays reachable through the scroll.
 *
 * Mouse: the panel owns the wheel over its rows (the chat keeps its own), and
 * it owns a text selection scoped to its column — a drag that starts on the
 * panel clamps to the panel's body cells, so chat and panel never select into
 * each other. Releasing a selection copies it, ANSI-clean, without the frame.
 */
import {
	type Component,
	sliceByColumn,
	stripTerminalSequences,
	type TuiMouseEvent,
	type TuiMouseEventResult,
	truncateToWidth,
	visibleWidth,
	wrapTextWithAnsi,
} from "@earendil-works/pi-tui";
import { theme } from "../../../theme/theme.ts";
import { sanitizeTerminalText } from "../terminal-text.ts";

/** Below this terminal width a split would crush the chat, so the panel stays hidden. */
export const WIDGET_PANEL_MIN_TERMINAL_WIDTH = 80;
/** Share of the terminal width the open panel claims. */
const WIDGET_PANEL_WIDTH_RATIO = 0.33;
/** Smallest usable panel column. */
const WIDGET_PANEL_MIN_WIDTH = 30;
/** Rows a wheel event scrolls the panel by. */
const WHEEL_SCROLL_ROWS = 3;
const PANEL_TITLE = "Widgets";
const PANEL_CLOSE_HINT = "→ to close";

/** Session state of one tab's side panel. Never persisted. */
export interface WidgetPanelTabState {
	/** Whether this tab splits the chat to show the panel. */
	open: boolean;
	/** Content row the window starts at; clamped to the overflow at render. */
	scrollOffset: number;
}

export function createWidgetPanelTabState(): WidgetPanelTabState {
	return { open: false, scrollOffset: 0 };
}

/** Column width the open panel claims for a terminal width. */
export function widgetPanelWidth(terminalWidth: number): number {
	return Math.max(WIDGET_PANEL_MIN_WIDTH, Math.floor(terminalWidth * WIDGET_PANEL_WIDTH_RATIO));
}

/** A selection endpoint in the panel's painted rows, body columns only. */
interface PanelSelectionPoint {
	row: number;
	col: number;
}

/** A live panel selection, from anchor to focus, in painted-row space. */
interface PanelSelection {
	anchor: PanelSelectionPoint;
	focus: PanelSelectionPoint;
}

export interface WidgetPanelOptions {
	/** Live widget maps of the active tab, in registration order. */
	widgets: () => { above: ReadonlyMap<string, Component>; below: ReadonlyMap<string, Component> };
	/** Session state of the active tab; undefined while no tab is attached. */
	state: () => WidgetPanelTabState | undefined;
	/** Terminal column count. */
	terminalWidth: () => number;
	/** Rows the panel column spans (the chat viewport's height). */
	viewportHeight: () => number;
	/** False while an extension input owns the composer: the panel then leaves the wheel to the chat. */
	interactive: () => boolean;
	/** Copy a finished panel selection; the host reports the outcome. */
	copySelection: (text: string) => void;
}

export class WidgetPanelComponent implements Component {
	private readonly options: WidgetPanelOptions;
	/** Live selection over the painted rows; cleared whenever those rows change. */
	private selection: PanelSelection | undefined;
	/** Body cell text of the last painted rows, ANSI included: the selection's source. */
	private renderedBodies: string[] = [];
	/** Window offset of the last paint; a change moves every row, dropping the selection. */
	private lastOffset = 0;

	constructor(options: WidgetPanelOptions) {
		this.options = options;
	}

	/** Whether the panel splits the chat at this terminal width. */
	isOpen(terminalWidth: number): boolean {
		return this.options.state()?.open === true && terminalWidth >= WIDGET_PANEL_MIN_TERMINAL_WIDTH;
	}

	/** Widgets keep their own styles; re-render their bodies and drop the selection. */
	invalidate(): void {
		const source = this.options.widgets();
		for (const component of [...source.above.values(), ...source.below.values()]) component.invalidate?.();
		this.selection = undefined;
	}

	/**
	 * The rendered rows always span the panel's own computed width, whatever
	 * width the layout passes: the column width comes from the terminal, so a
	 * measuring pass at another width cannot change it.
	 */
	render(_width: number): string[] {
		const state = this.options.state();
		const columns = this.options.terminalWidth();
		if (state?.open !== true || columns < WIDGET_PANEL_MIN_TERMINAL_WIDTH) {
			this.selection = undefined;
			this.renderedBodies = [];
			return [];
		}
		const panelWidth = widgetPanelWidth(columns);
		const height = Math.max(0, Math.floor(this.options.viewportHeight()));
		if (height === 0 || panelWidth < 4) {
			this.selection = undefined;
			this.renderedBodies = [];
			return [];
		}
		const bodyWidth = Math.max(1, panelWidth - 2);
		const border = theme.fg("borderMuted", "│");

		// The hint needs its own row and the title its own; below that, content wins.
		const hasHint = height >= 2;
		const hasTitle = height >= 3;
		const contentHeight = height - (hasHint ? 1 : 0) - (hasTitle ? 1 : 0);
		// Each painted row keeps its body cells (border and padding aside) so the
		// selection can highlight and copy exactly what the row shows.
		const content: Array<{ row: string; body: string }> = [];
		const ordered = [...this.options.widgets().above.entries(), ...this.options.widgets().below.entries()];
		for (const [index, [key, component]] of ordered.entries()) {
			if (index > 0) content.push(frameRow(border, "", panelWidth));
			content.push(frameRow(border, sectionHeader(key, bodyWidth), panelWidth));
			for (const line of component.render(bodyWidth)) {
				// Wrap rather than truncate: every row stays reachable through the
				// panel's own scroll. An empty line keeps its row as a border blank.
				const wrapped = wrapTextWithAnsi(sanitizePanelLine(line), bodyWidth);
				if (wrapped.length === 0) {
					content.push(frameRow(border, "", panelWidth));
					continue;
				}
				for (const part of wrapped) content.push(frameRow(border, part, panelWidth));
			}
		}

		// Window at the clamped offset so a roster shrink or resize can never
		// strand the offset past the end; mark the hidden edges. The markers and
		// the pinned title/close hint replace the row they cover.
		const maxOffset = Math.max(0, content.length - contentHeight);
		const offset = Math.min(Math.max(0, Math.floor(state.scrollOffset)), maxOffset);
		state.scrollOffset = offset;
		const visible = content.slice(offset, offset + contentHeight);
		if (offset > 0 && visible.length > 0) visible[0] = frameRow(border, theme.fg("dim", "↑ more"), panelWidth);
		if (offset < maxOffset && visible.length > 0) {
			visible[visible.length - 1] = frameRow(border, theme.fg("dim", "↓ more"), panelWidth);
		}
		while (visible.length < contentHeight) visible.push(frameRow(border, "", panelWidth));
		if (hasTitle) {
			visible.unshift(frameRow(border, theme.fg("dim", truncateToWidth(PANEL_TITLE, bodyWidth, "...")), panelWidth));
		}
		if (hasHint) {
			visible.push(
				frameRow(border, theme.fg("dim", truncateToWidth(PANEL_CLOSE_HINT, bodyWidth, "...")), panelWidth),
			);
		}

		// The rows changed under the selection (scroll, roster, resize): drop it,
		// so a highlight can never point at text that is no longer there.
		if (offset !== this.lastOffset) this.selection = undefined;
		this.lastOffset = offset;
		if (this.selection && this.selection.focus.row >= visible.length) this.selection = undefined;
		this.renderedBodies = visible.map((entry) => entry.body);
		return visible.map((entry, row) => this.highlightRow(entry, row, bodyWidth));
	}

	/**
	 * The panel owns its column's mouse input: the wheel scrolls it, and a
	 * left-press drag selects within the panel only. Capturing the press keeps
	 * drag and release coming here even outside the column, where the points
	 * clamp to the panel's edges instead of leaking into the chat.
	 */
	handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
		if (event.type === "wheel" && event.wheelDelta !== undefined) {
			const state = this.options.state();
			if (!state || !this.options.interactive()) return undefined;
			this.selection = undefined;
			state.scrollOffset = Math.max(0, state.scrollOffset + event.wheelDelta * WHEEL_SCROLL_ROWS);
			return { handled: true };
		}
		if (!this.options.interactive()) return undefined;
		if (event.type === "press" && event.button === "left") {
			this.selection = { anchor: this.clampPoint(event), focus: this.clampPoint(event) };
			return { handled: true, capture: true };
		}
		if (event.type === "drag" && this.selection) {
			this.selection.focus = this.clampPoint(event);
			return { handled: true };
		}
		if (event.type === "release" && this.selection) {
			this.selection.focus = this.clampPoint(event);
			const text = this.selectedText();
			if (text) this.options.copySelection(text);
			return { handled: true };
		}
		return undefined;
	}

	/** A mouse point clamped into the panel's painted rows and body columns. */
	private clampPoint(event: TuiMouseEvent): PanelSelectionPoint {
		const bodyWidth = Math.max(1, widgetPanelWidth(this.options.terminalWidth()) - 2);
		const rows = this.renderedBodies.length;
		return {
			row: Math.max(0, Math.min(rows - 1, Math.floor(event.y))),
			// Body cell 0 sits two cells in: after the border and the padding space.
			col: Math.max(0, Math.min(bodyWidth - 1, Math.floor(event.x) - 2)),
		};
	}

	/** The selection's text: body cells only, ANSI-free, trailing blanks dropped. */
	private selectedText(): string {
		const selection = this.selection;
		if (!selection) return "";
		const bodyWidth = Math.max(1, widgetPanelWidth(this.options.terminalWidth()) - 2);
		const start = orderPoints(selection)[0];
		const end = orderPoints(selection)[1];
		const parts: string[] = [];
		for (let row = start.row; row <= end.row; row++) {
			const from = row === start.row ? start.col : 0;
			const to = row === end.row ? end.col + 1 : undefined;
			const body = this.renderedBodies[row] ?? "";
			parts.push(
				stripTerminalSequences(sliceByColumn(body, from, to === undefined ? bodyWidth : to - from)).trimEnd(),
			);
		}
		return parts.join("\n").replace(/[ \t]+$/gm, "");
	}

	/** One painted row with the selection's cells inverted. */
	private highlightRow(entry: { row: string; body: string }, row: number, bodyWidth: number): string {
		const selection = this.selection;
		if (!selection) return entry.row;
		const [start, end] = orderPoints(selection);
		if (row < start.row || row > end.row) return entry.row;
		const from = row === start.row ? start.col : 0;
		const to = row === end.row ? Math.min(end.col, bodyWidth - 1) : bodyWidth - 1;
		if (to < from) return entry.row;
		const body = entry.body;
		const selected = sliceByColumn(body, from, to - from + 1);
		const before = from > 0 ? sliceByColumn(body, 0, from) : "";
		const after = to + 1 < bodyWidth ? sliceByColumn(body, to + 1, bodyWidth) : "";
		const target = `${before}${selected}${after}`;
		if (!target) return entry.row;
		// Function form: `$` in widget text must not read as a replacement pattern.
		return entry.row.replace(target, () => `${before}${reverseVideo(selected)}${after}`);
	}
}

/** Normalize anchor/focus into start/end in row-major order. */
function orderPoints(selection: PanelSelection): [PanelSelectionPoint, PanelSelectionPoint] {
	const { anchor, focus } = selection;
	return anchor.row < focus.row || (anchor.row === focus.row && anchor.col <= focus.col)
		? [anchor, focus]
		: [focus, anchor];
}

/** Reverse-video wrap that survives the segment's own SGR codes. */
function reverseVideo(text: string): string {
	let result = "\x1b[7m";
	let index = 0;
	while (index < text.length) {
		const code = /^\x1b\[[0-?]*[ -/]*[@-~]/.exec(text.slice(index));
		if (code) {
			result += code[0];
			if (code[0].endsWith("m")) result += "\x1b[7m";
			index += code[0].length;
			continue;
		}
		result += text[index];
		index += 1;
	}
	return `${result}\x1b[27m`;
}

/** One bordered panel row plus its body cells, padded to the full column width. */
function frameRow(border: string, body: string, panelWidth: number): { row: string; body: string } {
	const row = `${border} ${body}`;
	const padding = panelWidth - visibleWidth(row);
	return { row: padding > 0 ? row + " ".repeat(padding) : row, body };
}

/** `─ <key> ───` rule heading one panel section. */
function sectionHeader(key: string, bodyWidth: number): string {
	const label = truncateToWidth(sanitizePanelLine(key).trim(), Math.max(1, bodyWidth - 4), "...");
	const rule = "─".repeat(Math.max(0, bodyWidth - visibleWidth(label) - 3));
	return theme.fg("dim", `─ ${label} ${rule}`);
}

/** One rendered widget line, reduced to printable text plus SGR colours. */
function sanitizePanelLine(line: string): string {
	return sanitizeTerminalText(line)
		.replace(/[\r\n\t]+/g, " ")
		.trimEnd();
}
