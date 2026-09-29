/**
 * `/settings` as a framed MixCode panel: a surface holding a dim filter line, one
 * section per settings file with that file's path under its heading, `›` rows with
 * a label and a value column, the selected item's description, and a key-hint
 * footer.
 *
 * The settings themselves are the app's own items; this module only decides how
 * they look and how the keyboard and the pointer drive them. It is shown as a
 * centred overlay, so the panel measures itself against the terminal on every
 * frame instead of assuming the editor area's height.
 */
import {
	type Component,
	fuzzyFilter,
	getKeybindings,
	type SettingItem,
	type TuiMouseEvent,
	type TuiMouseEventResult,
	truncateToWidth,
	visibleWidth,
	wrapTextWithAnsi,
} from "@earendil-works/pi-tui";
import { getSettingsPath } from "../../../../../config.ts";
import { mixcodeSettingsFilePath } from "../../../../../core/mixcode/mixcode-settings.ts";
import { shortenPath } from "../../../../../core/tools/render-utils.ts";
import { theme } from "../../../theme/theme.ts";
import { padLine, windowStart } from "../home/home-model.ts";
import { panel, panelContentWidth } from "../panel.ts";

/** Rows the framed panel spends on its two border rows. */
const FRAME_ROWS = 2;

/**
 * Extra cells the frame leaves on each side of the body. The MixCode panel keeps
 * the body flush with the border, so a selected row's background spans the whole
 * interior width.
 */
const BODY_PADDING_X = 0;

/** Share of the terminal the panel takes, matching the overlay it is shown in. */
export const SETTINGS_PANEL_WIDTH_PERCENT = 78;
export const SETTINGS_PANEL_HEIGHT_PERCENT = 80;

/** Terminal height assumed when neither the terminal nor the environment reports one. */
const DEFAULT_TERMINAL_ROWS = 24;

/** Rows the list reserves before it knows how much chrome the window actually needs. */
const INITIAL_CHROME_ROWS = 8;

/** Fitting passes; the window only ever shrinks, so two passes normally settle it. */
const MAX_FIT_PASSES = 4;

const MARKER_WIDTH = 2;
const COLUMN_GAP = 2;
const MIN_LABEL_COLUMN = 18;
const MAX_LABEL_COLUMN = 32;
const MIN_VALUE_COLUMN = 8;

/** Share of the row the label column takes, leaving the rest to the value. */
const LABEL_COLUMN_SHARE = 0.55;

const BOOLEAN_ON = "On";
const BOOLEAN_OFF = "Off";

/** Section heading for the items that live in pi's own settings file. */
const PI_SECTION_TITLE = "Pi";

const FILTER_PROMPT = "filter: type to filter";
const NO_MATCHES = "  No matching settings";
const FOOTER_HINT = "  ↑↓ select  ⏎ edit/toggle  type to filter  esc close";
/** Footer for a list the keyboard does not search, such as a submenu's. */
export const SUBMENU_HINT = "  ↑↓ select  ⏎ edit/toggle  esc back";

/**
 * What a row of the panel is, so a short terminal can drop the cheap rows first:
 * the filter line, the selected row and the key hints stay, and blanks, paths, clip
 * markers, descriptions and unselected rows go in that order.
 */
type RowKind = "filter" | "blank" | "header" | "path" | "clip" | "item" | "description" | "hint" | "message";

const DROP_ORDER: RowKind[] = ["blank", "path", "clip", "description", "item"];

export interface SettingsPanelBodyOptions {
	/** Footer key hints; the main list's default names the filter. */
	hint?: string;
	/** Type-to-filter on this list; off for lists the keyboard only navigates. */
	filter?: boolean;
}

export interface SettingsPanelOptions extends SettingsPanelBodyOptions {
	onChange: (id: string, newValue: string) => void;
	onCancel: () => void;
	/** Rows the framed panel may occupy, its two border rows included. */
	rowBudget?: number;
	/** Frame title; `Settings` unless the caller names the view. */
	title?: string;
}

/** True for the two-value items the panel shows as On/Off. */
function isBooleanItem(item: SettingItem): boolean {
	return item.values?.length === 2 && item.values[0] === "true" && item.values[1] === "false";
}

/**
 * Whether a header is due above this row. A section always announces itself at the
 * top of a window, even when the window opened in the middle of it, so the visible
 * rows always say which settings file they come from.
 */
function sectionStartsAt(items: readonly SettingItem[], index: number, start: number): boolean {
	return index === start || items[index - 1]?.section !== items[index]?.section;
}

/** Settings file backing a row: pi's own file for items without a section, the fork's file otherwise. */
function sectionPath(item: SettingItem): string {
	return item.section === undefined ? getSettingsPath() : mixcodeSettingsFilePath();
}

/** Header row: the title, then the rule that fills the remaining width. */
function sectionHeader(title: string, width: number): string {
	const label = ` ${title} `;
	return theme.fg("dim", `${label}${"─".repeat(Math.max(0, width - visibleWidth(label)))}`);
}

/** Path row under a header: collapsed to `~`, middle-truncated when it does not fit. */
function sectionPathLine(item: SettingItem, width: number): string {
	const display = shortenPath(sectionPath(item));
	const available = Math.max(1, width - 2);
	let text = display;
	if (visibleWidth(display) > available) {
		if (available <= 1) {
			text = "…";
		} else {
			const budget = available - 1;
			const head = Math.ceil(budget / 2);
			const tail = Math.floor(budget / 2);
			text = `${display.slice(0, head)}…${display.slice(display.length - tail)}`;
		}
	}
	return theme.fg("dim", `  ${text}`);
}

/** Non-list rows a window spends: filter, blanks, clip markers, sections, description, footer. */
function chromeRows(
	items: readonly SettingItem[],
	start: number,
	end: number,
	options: { descriptionRows: number; filterRows: number },
): number {
	let rows = options.filterRows;
	if (start > 0) rows += 1;
	if (end < items.length) rows += 1;
	for (let index = start; index < end; index++) {
		if (!sectionStartsAt(items, index, start)) continue;
		// Header plus path, and a blank separator when rows from the section above are shown.
		rows += index > start ? 3 : 2;
	}
	return rows + options.descriptionRows + 2; // the description block, then the blank and the hint
}

/**
 * Terminal rows the panel fills when its caller does not pass a budget. Reads the
 * same sources the terminal does, so the budget and the overlay's own maximum stay
 * on one measurement.
 */
function defaultRowBudget(): number {
	const rows = process.stdout.rows || Number(process.env.LINES) || DEFAULT_TERMINAL_ROWS;
	return Math.max(6, Math.floor((rows * SETTINGS_PANEL_HEIGHT_PERCENT) / 100));
}

/**
 * Body rows for a list of `itemCount` items shown at most `maxVisibleItems` at a time,
 * chrome included. Submenu lists that render bare inside the panel use this.
 */
export function settingsBodyRowBudget(itemCount: number, maxVisibleItems = 10): number {
	return Math.min(itemCount, maxVisibleItems) + INITIAL_CHROME_ROWS;
}

/**
 * The list itself: filter line, sections, rows, description and footer. Rendered
 * bare so a submenu can host it inside the same frame.
 */
export class SettingsPanelBody implements Component {
	private readonly items: SettingItem[];
	private readonly onChange: (id: string, newValue: string) => void;
	private readonly onCancel: () => void;
	private readonly hint: string;
	private readonly filterEnabled: boolean;
	/** Body rows a bare caller gets; the framed panel passes its own budget per render. */
	private readonly defaultRows: number;
	/** Selected item id, so filtering to a narrower list keeps the same row. */
	private selectedId: string | undefined;
	private filterQuery = "";
	private submenu: Component | null = null;
	private submenuItemId: string | undefined;
	/** Visible index of each line of the last render, or null for chrome rows. */
	private lastRows: Array<number | null> = [];

	constructor(
		items: SettingItem[],
		maxRows: number,
		onChange: (id: string, newValue: string) => void,
		onCancel: () => void,
		options: SettingsPanelBodyOptions = {},
	) {
		this.items = items;
		this.defaultRows = Math.max(1, maxRows);
		this.onChange = onChange;
		this.onCancel = onCancel;
		this.hint = options.hint ?? FOOTER_HINT;
		this.filterEnabled = options.filter ?? true;
	}

	/** Move the selection to the item with this id (no-op when it is filtered out). */
	selectItem(id: string): void {
		if (this.visibleItems().some((item) => item.id === id)) this.selectedId = id;
	}

	/** Rewrite an item's displayed value without firing `onChange`. */
	updateValue(id: string, value: string): void {
		const item = this.items.find((candidate) => candidate.id === id);
		if (item) item.currentValue = value;
	}

	invalidate(): void {
		this.submenu?.invalidate?.();
	}

	private visibleItems(): SettingItem[] {
		if (!this.filterEnabled || !this.filterQuery.trim()) return this.items;
		return fuzzyFilter(this.items, this.filterQuery, (item) => item.label);
	}

	private selectedPosition(visible: readonly SettingItem[]): number {
		const index = visible.findIndex((item) => item.id === this.selectedId);
		return index === -1 ? 0 : index;
	}

	private displayValue(item: SettingItem): string {
		if (!isBooleanItem(item)) return item.currentValue;
		return item.currentValue === "true" ? BOOLEAN_ON : BOOLEAN_OFF;
	}

	private paintValue(item: SettingItem, value: string): string {
		if (!isBooleanItem(item)) return value;
		return value === BOOLEAN_ON ? theme.fg("accent", value) : theme.fg("dim", value);
	}

	private row(item: SettingItem, selected: boolean, width: number): string {
		const labelColumn = Math.max(
			MIN_LABEL_COLUMN,
			Math.min(MAX_LABEL_COLUMN, Math.floor((width - MARKER_WIDTH - COLUMN_GAP) * LABEL_COLUMN_SHARE)),
		);
		const valueColumn = Math.max(MIN_VALUE_COLUMN, width - MARKER_WIDTH - COLUMN_GAP - labelColumn);
		const marker = selected ? theme.fg("accent", "› ") : " ".repeat(MARKER_WIDTH);
		const label = padLine(truncateToWidth(item.label, labelColumn, "…"), labelColumn);
		const value = this.paintValue(item, truncateToWidth(this.displayValue(item), valueColumn, "…"));
		const line = padLine(`${marker}${label}${" ".repeat(COLUMN_GAP)}${value}`, width);
		return selected ? theme.bg("selectedBg", line) : line;
	}

	private filterLine(visibleCount: number, total: number): string {
		const count = `${visibleCount}/${total}`;
		if (!this.filterQuery) return theme.fg("dim", `  ${FILTER_PROMPT}  ${count}`);
		return `  ${theme.fg("dim", "filter:")} ${this.filterQuery}  ${theme.fg("dim", count)}`;
	}

	private descriptionLines(item: SettingItem | undefined, width: number): string[] {
		if (!item?.description) return [];
		return wrapTextWithAnsi(item.description, Math.max(1, width - 2)).map((line) => theme.fg("dim", `  ${line}`));
	}

	render(width: number, maxRows = this.defaultRows): string[] {
		if (this.submenu) {
			this.lastRows = [];
			return this.submenu.render(width);
		}
		return this.renderList(width, Math.max(1, maxRows));
	}

	private renderList(width: number, maxRows: number): string[] {
		const visible = this.visibleItems();
		const total = this.items.length;
		const lines: string[] = [];
		const kinds: RowKind[] = [];
		const rowMap: Array<number | null> = [];
		const push = (line: string, kind: RowKind, itemIndex: number | null = null): void => {
			lines.push(line);
			kinds.push(kind);
			rowMap.push(itemIndex);
		};

		if (visible.length === 0) {
			if (this.filterEnabled) {
				push(this.filterLine(0, total), "filter");
				push("", "blank");
			}
			push(theme.fg("dim", NO_MATCHES), "message");
			push("", "blank");
			push(theme.fg("dim", this.hint), "hint");
			this.trimToBudget(lines, kinds, rowMap, maxRows, -1);
			this.lastRows = rowMap;
			return lines;
		}

		const position = this.selectedPosition(visible);
		const description = this.descriptionLines(visible[position], width);
		const descriptionRows = description.length === 0 ? 0 : description.length + 1;
		const chrome = {
			descriptionRows,
			filterRows: this.filterEnabled ? 2 : 0,
		};

		// The window shrinks until the chrome its own rows need fits the budget; the
		// selected row is centred first and stays inside whatever window survives.
		let maxItems = Math.max(1, maxRows - INITIAL_CHROME_ROWS);
		let start = windowStart(position, visible.length, maxItems);
		let end = Math.min(start + maxItems, visible.length);
		for (let pass = 0; pass < MAX_FIT_PASSES; pass++) {
			const fits = Math.max(1, maxRows - chromeRows(visible, start, end, chrome));
			if (fits >= maxItems) break;
			maxItems = fits;
			start = windowStart(position, visible.length, maxItems);
			end = Math.min(start + maxItems, visible.length);
		}

		if (this.filterEnabled) {
			push(this.filterLine(visible.length, total), "filter");
			push("", "blank");
		}
		if (start > 0) push(theme.fg("dim", `  ... (${start} more above)`), "clip");
		for (let index = start; index < end; index++) {
			const item = visible[index]!;
			if (sectionStartsAt(visible, index, start)) {
				if (index > start) push("", "blank");
				push(sectionHeader(item.section ?? PI_SECTION_TITLE, width), "header");
				push(sectionPathLine(item, width), "path");
			}
			push(this.row(item, index === position, width), "item", index);
		}
		if (end < visible.length) push(theme.fg("dim", `  ... (${visible.length - end} more below)`), "clip");
		if (description.length > 0) {
			push("", "blank");
			for (const line of description) push(line, "description");
		}
		push("", "blank");
		push(theme.fg("dim", this.hint), "hint");

		// A short terminal gives up decoration before it gives up the filter line, the
		// selected row or the key hints.
		this.trimToBudget(lines, kinds, rowMap, maxRows, position);

		this.lastRows = rowMap;
		return lines;
	}

	/** Drop expendable rows, in `DROP_ORDER`, until the body fits `maxRows`. */
	private trimToBudget(
		lines: string[],
		kinds: RowKind[],
		rowMap: Array<number | null>,
		maxRows: number,
		selectedIndex: number,
	): void {
		for (const kind of DROP_ORDER) {
			while (lines.length > maxRows) {
				const at = kinds.findIndex(
					(candidate, index) => candidate === kind && !(kind === "item" && rowMap[index] === selectedIndex),
				);
				if (at === -1) break;
				lines.splice(at, 1);
				kinds.splice(at, 1);
				rowMap.splice(at, 1);
			}
		}
	}

	private move(delta: number): void {
		const visible = this.visibleItems();
		if (visible.length === 0) return;
		const position = this.selectedPosition(visible);
		const next = (position + delta + visible.length) % visible.length;
		this.selectedId = visible[next]!.id;
	}

	private setFilter(query: string): void {
		this.filterQuery = query;
		// Rows painted before the filter changed no longer map to what is on screen.
		this.lastRows = [];
		const visible = this.visibleItems();
		if (!visible.some((item) => item.id === this.selectedId)) this.selectedId = visible[0]?.id;
	}

	/** Enter on a row: open its submenu, or cycle its values in place. */
	private activate(): void {
		const visible = this.visibleItems();
		const item = visible[this.selectedPosition(visible)];
		if (!item) return;
		if (item.submenu) {
			this.submenuItemId = item.id;
			this.submenu = item.submenu(item.currentValue, (selectedValue?: string) => {
				if (selectedValue !== undefined) {
					item.currentValue = selectedValue;
					this.onChange(item.id, selectedValue);
				}
				this.closeSubmenu();
			});
			return;
		}
		const values = item.values;
		if (!values || values.length === 0) return;
		const next = values[(values.indexOf(item.currentValue) + 1) % values.length]!;
		item.currentValue = next;
		this.onChange(item.id, next);
	}

	private closeSubmenu(): void {
		this.submenu = null;
		if (this.submenuItemId !== undefined) {
			this.selectedId = this.submenuItemId;
			this.submenuItemId = undefined;
		}
	}

	handleInput(data: string): void {
		if (this.submenu) {
			this.submenu.handleInput?.(data);
			return;
		}
		const keybindings = getKeybindings();
		if (keybindings.matches(data, "tui.select.up")) {
			this.move(-1);
		} else if (keybindings.matches(data, "tui.select.down")) {
			this.move(1);
		} else if (keybindings.matches(data, "tui.select.confirm") || (data === " " && this.filterQuery.length === 0)) {
			this.activate();
		} else if (keybindings.matches(data, "tui.select.cancel")) {
			// Escape clears a typed filter first and closes the panel only when it is empty.
			if (this.filterEnabled && this.filterQuery.length > 0) this.setFilter("");
			else this.onCancel();
		} else if (!this.filterEnabled) {
			return;
		} else if (keybindings.matches(data, "tui.editor.deleteCharBackward")) {
			this.setFilter(this.filterQuery.slice(0, -1));
		} else if (data.length > 0 && !/[\x00-\x1f\x7f]/.test(data)) {
			this.setFilter(this.filterQuery + data);
		}
	}

	handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
		if (this.submenu) return this.submenu.handleMouse?.(event);
		const visible = this.visibleItems();
		if (visible.length === 0) return undefined;
		if (event.type === "wheel" && event.wheelDelta) {
			const position = this.selectedPosition(visible);
			const step = event.wheelDelta < 0 ? -1 : 1;
			const next = Math.max(0, Math.min(visible.length - 1, position + step));
			if (next === position) return { handled: true, render: false };
			this.selectedId = visible[next]!.id;
			return { handled: true, render: true };
		}
		// A left press paints the row under the pointer; the click that follows accepts it.
		const activatesRow = event.button === "left" && (event.type === "press" || event.type === "click");
		if (!activatesRow) return undefined;
		const index = this.lastRows[event.y];
		if (index === undefined || index === null) return undefined;
		this.selectedId = visible[index]!.id;
		if (event.type === "press") return { handled: true, focus: true };
		this.activate();
		return { handled: true };
	}
}

/**
 * The framed panel: a body inside the surface, sized to the row budget the overlay
 * was given. The body is clipped to that budget, so the bottom border is drawn even
 * when a submenu renders more rows than fit; the budget follows the terminal on every
 * frame, so a resized terminal gets a re-fitted panel.
 */
export class SettingsPanel implements Component {
	private readonly body: SettingsPanelBody;
	private readonly title: string;
	private readonly fixedRowBudget: number | undefined;

	constructor(items: SettingItem[], options: SettingsPanelOptions) {
		this.title = options.title ?? "Settings";
		this.fixedRowBudget = options.rowBudget;
		this.body = new SettingsPanelBody(items, this.bodyRows(), options.onChange, options.onCancel, {
			hint: options.hint,
			filter: options.filter,
		});
	}

	invalidate(): void {
		this.body.invalidate();
	}

	/** Body rows this frame may paint, measured against the terminal on every render. */
	private bodyRows(): number {
		return Math.max(1, (this.fixedRowBudget ?? defaultRowBudget()) - FRAME_ROWS);
	}

	render(width: number): string[] {
		const rows = this.bodyRows();
		const body = this.body.render(panelContentWidth(width, BODY_PADDING_X), rows).slice(0, rows);
		return panel(this.title, body, width, {
			backgroundColor: "panelBg",
			backgroundScope: "content",
			paddingX: BODY_PADDING_X,
		});
	}

	handleInput(data: string): void {
		this.body.handleInput(data);
	}

	handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
		// The overlay's coordinates include the frame: one top border row, and a
		// border plus the body padding on the left. A wheel anywhere over the panel
		// still scrolls the list, frame rows included.
		if (event.y < 1 && event.type !== "wheel") return undefined;
		return this.body.handleMouse({
			...event,
			x: Math.max(0, event.x - 1 - BODY_PADDING_X),
			y: event.y - 1,
		});
	}

	/** Move the selection to the item with this id (no-op when it is filtered out). */
	selectItem(id: string): void {
		this.body.selectItem(id);
	}

	/** Rewrite an item's displayed value without firing `onChange`. */
	updateValue(id: string, value: string): void {
		this.body.updateValue(id, value);
	}
}
