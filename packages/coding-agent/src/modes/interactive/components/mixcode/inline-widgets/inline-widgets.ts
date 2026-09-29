/**
 * Inline widget mode: extension widgets rendered at the tail of the chat
 * transcript instead of in the fixed dock above the editor.
 *
 * The block is capped by a row budget derived from the chat viewport, so a
 * stack of tall widgets cannot starve the transcript. Over budget, whole bodies
 * are handed out in priority order and the rest collapse to their `▸ Inline`
 * header; a body is never cut in half. Manual `/widgets` choices outrank the
 * budget, and the automatic decisions are session-only and disposable.
 *
 * The component owns no widget state of its own: it reads the active tab's live
 * widget maps and its per-tab cursor state through the accessors it is built
 * with, so a tab switch changes what it renders without rebuilding it.
 */
import {
	type Component,
	dispatchMouseEvent,
	type TuiMouseDispatchResult,
	type TuiMouseEvent,
	truncateToWidth,
	visibleWidth,
} from "@earendil-works/pi-tui";
import { theme } from "../../../theme/theme.ts";
import { sanitizeTerminalText } from "./terminal-text.ts";

/** Share of the chat viewport the inline widget block may occupy. */
const INLINE_TAIL_SHARE = 0.7;
const INLINE_TAIL_MIN_BUDGET = 6;
const INLINE_TAIL_MAX_BUDGET = 24;
/** Extra rows the block must free before a collapsed widget expands again. */
const INLINE_TAIL_HOLD_DEADBAND_ROWS = 2;
/** Consecutive frames the fully expanded block must fit before decisions are dropped. */
const INLINE_TAIL_EXPAND_STREAK = 2;
/** `▸ Inline · ` plus one label character and the space before the rule. */
const INLINE_HEADER_PREFIX_WIDTH = 13;
/** Room kept for ` · /widgets expand` on the one-line summary row. */
const INLINE_SUMMARY_COMMAND_WIDTH = 18;

/** Widget keys the user owns outright: `true` collapsed, `false` pinned open. */
type InlineWidgetManualState = Map<string, boolean>;

/**
 * Session state of one tab's inline mode. Never persisted: a restored session
 * starts from the global default, like vim mode.
 */
export interface InlineWidgetTabState {
	/** Whether this tab renders widgets in the chat tail. */
	enabled: boolean;
	/** Manual intent per widget key: `true` collapsed, `false` pinned expanded. */
	collapsed: InlineWidgetManualState;
	/** Keys the row budget collapsed; disjoint from manual intent and disposable. */
	autoCollapsed: Set<string>;
	/** Frame the automatic decisions were computed for: budget, width, widget recency. */
	autoSignature?: string;
	/** Fully expanded row count of that frame. */
	autoNaturalRows?: number;
	/** Consecutive frames the fully expanded block fit within the budget. */
	autoFitStreak?: number;
}

export function createInlineWidgetTabState(enabled: boolean): InlineWidgetTabState {
	return { enabled, collapsed: new Map(), autoCollapsed: new Set() };
}

/** The active tab's widgets, in registration order, split by placement. */
export interface InlineWidgetSource {
	readonly above: ReadonlyMap<string, Component>;
	readonly below: ReadonlyMap<string, Component>;
}

export interface InlineWidgetsOptions {
	/** Live widget maps of the active tab. */
	widgets: () => InlineWidgetSource;
	/** Session state of the active tab, or undefined while no tab is attached. */
	state: () => InlineWidgetTabState | undefined;
	/**
	 * Rows the chat surface can show, or undefined when the caller clips the
	 * content itself: without a viewport only manual collapse state applies.
	 */
	viewportRows: () => number | undefined;
}

/** One widget this frame renders, with its body measured at the body width. */
interface InlineWidgetEntry {
	key: string;
	component: Component;
	/** Registration order across both placements; breaks equal-recency ties. */
	order: number;
	/** Recency rank; higher is more recently (re-)registered. */
	stamp: number;
	lines: string[];
}

interface InlineWidgetPlan {
	/** Body rows per widget key; 0 renders the widget as its header alone. */
	bodyRows: Map<string, number>;
	/** Keys the automatic budget collapsed this frame. */
	autoCollapsed: Set<string>;
}

/** Rows of the visible block occupied by the widget painted on them. */
interface InlineWidgetHit {
	component: Component;
	start: number;
	height: number;
}

/** Soft row target for the inline block: a clamped share of the chat viewport. */
export function inlineTailBudget(viewportRows: number): number {
	const viewport = Math.max(0, viewportRows);
	// On a viewport too small for the usual floor the chat keeps half the rows.
	const floor = Math.min(INLINE_TAIL_MIN_BUDGET, Math.max(1, Math.floor(viewport / 2)));
	const target = Math.floor(viewport * INLINE_TAIL_SHARE);
	return Math.max(floor, Math.min(INLINE_TAIL_MAX_BUDGET, target));
}

export class InlineWidgetsComponent implements Component {
	private readonly options: InlineWidgetsOptions;
	/** Last component seen per key, so a re-registration reads as an update. */
	private readonly stamps = new Map<string, { component: Component; stamp: number }>();
	private nextStamp = 1;
	/** Row ranges of the last render, so mouse events reach the widget under them. */
	private hits: InlineWidgetHit[] = [];

	constructor(options: InlineWidgetsOptions) {
		this.options = options;
	}

	/** Re-render widget bodies (they own their styles) and drop the last hit table. */
	invalidate(): void {
		const source = this.options.widgets();
		for (const component of [...source.above.values(), ...source.below.values()]) component.invalidate?.();
		this.hits = [];
	}

	render(width: number): string[] {
		const state = this.options.state();
		if (!state?.enabled) {
			this.hits = [];
			return [];
		}
		const bodyWidth = Math.max(1, width - 2);
		const entries = this.collectEntries(bodyWidth);
		if (entries.length === 0) {
			this.hits = [];
			return [];
		}
		const viewportRows = this.options.viewportRows();
		const budget = viewportRows === undefined ? undefined : inlineTailBudget(viewportRows);
		const plan = planInlineWidgetBlock(state, entries, budget, width);
		this.hits = [];
		if (plan.bodyRows.size === 0) return [` ${inlineWidgetSummaryLine(entries.length, bodyWidth)}`];

		const lines: string[] = [];
		const hits: InlineWidgetHit[] = [];
		for (const [index, entry] of entries.entries()) {
			const body = plannedBodyRows(entries, plan.bodyRows, index);
			const collapsed = body === 0;
			const previousCollapsed = index > 0 && plannedBodyRows(entries, plan.bodyRows, index - 1) === 0;
			// Collapsed widgets stack their headers densely; an expanded neighbour
			// keeps its separating blank row.
			if (index > 0 && !(collapsed && previousCollapsed)) lines.push("");
			lines.push(
				` ${inlineWidgetSectionHeader(entry.key, bodyWidth, collapsed, plan.autoCollapsed.has(entry.key))}`,
			);
			if (collapsed) continue;
			const bodyLines = entry.lines
				.slice(0, body)
				.map((line) => ` ${truncateToWidth(sanitizeWidgetLine(line), bodyWidth, "…")}`);
			hits.push({ component: entry.component, start: lines.length, height: bodyLines.length });
			lines.push(...bodyLines);
		}
		this.hits = hits;
		return lines;
	}

	/** Mouse rows are in this component's own row space; hand them to the widget there. */
	handleMouse(event: TuiMouseEvent): TuiMouseDispatchResult | undefined {
		const row = Math.floor(event.y);
		const hit = this.hits.find((entry) => row >= entry.start && row < entry.start + entry.height);
		if (!hit) return undefined;
		return dispatchMouseEvent(hit.component, { ...event, y: row - hit.start, height: hit.height });
	}

	/** Above-editor widgets render above below-editor ones, each in registration order. */
	private collectEntries(bodyWidth: number): InlineWidgetEntry[] {
		// Snapshot first: a widget whose render registers another widget must not
		// grow the list being iterated.
		const source = this.options.widgets();
		const above = [...source.above];
		const below = [...source.below];
		const entries: InlineWidgetEntry[] = [];
		for (const widgets of [above, below]) {
			for (const [key, component] of widgets) {
				const lines = component.render(bodyWidth);
				// A widget with nothing to show contributes neither header nor separator.
				if (lines.length === 0) continue;
				entries.push({ key, component, order: entries.length, stamp: this.stampOf(key, component), lines });
			}
		}
		// Recency ranks only outlive the widgets still registered; a widget that renders
		// nothing this frame keeps its rank for when it comes back.
		const registered = new Set([...above, ...below].map(([key]) => key));
		for (const key of this.stamps.keys()) {
			if (!registered.has(key)) this.stamps.delete(key);
		}
		return entries;
	}

	/** Recency rank of a widget: a re-registered component counts as an update. */
	private stampOf(key: string, component: Component): number {
		const seen = this.stamps.get(key);
		if (seen && seen.component === component) return seen.stamp;
		const stamp = this.nextStamp++;
		this.stamps.set(key, { component, stamp });
		return stamp;
	}
}

/**
 * Rows per widget for this frame.
 *
 * With a budget: keep every body complete if the block fits; otherwise hand
 * complete bodies out in priority order, manually expanded widgets first, then
 * the most recently updated, then registration order. The first widget whose
 * full body no longer fits is the cut: it and every lower-priority widget
 * collapse to its header. A shown body is never partial. An empty plan means
 * even a header-only stack does not fit, and the caller renders one summary row.
 *
 * Without a budget (the caller owns its clipping) only manual collapse state
 * applies and the automatic decisions stay untouched.
 */
function planInlineWidgetBlock(
	state: InlineWidgetTabState,
	entries: readonly InlineWidgetEntry[],
	budget: number | undefined,
	width: number,
): InlineWidgetPlan {
	const manuallyCollapsed = new Set<string>();
	const pinned = new Set<string>();
	for (const entry of entries) {
		const manual = state.collapsed.get(entry.key);
		if (manual === true) manuallyCollapsed.add(entry.key);
		else if (manual === false) pinned.add(entry.key);
	}

	const autoCollapsed = state.autoCollapsed;
	// Drop decisions for widgets that are gone or that a user command now owns.
	for (const key of [...autoCollapsed]) {
		if (!entries.some((entry) => entry.key === key) || state.collapsed.has(key)) autoCollapsed.delete(key);
	}

	const naturalBody = (entry: InlineWidgetEntry): number => entry.lines.length;
	const naturalBodies = new Map(entries.map((entry) => [entry.key, naturalBody(entry)]));
	// A manually expanded widget keeps its body: the user asked for it, so the row
	// budget makes the other widgets give way instead.
	const pinnedBodies = new Map<string, number>();
	for (const entry of entries) {
		if (pinned.has(entry.key)) pinnedBodies.set(entry.key, naturalBody(entry));
	}
	// Body rows per widget; a key in `hiddenKeys` renders as its header alone.
	const withBodies = (bodies: ReadonlyMap<string, number>, hiddenKeys: ReadonlySet<string>): Map<string, number> => {
		const rows = new Map<string, number>();
		for (const entry of entries) {
			rows.set(entry.key, hiddenKeys.has(entry.key) ? 0 : (bodies.get(entry.key) ?? 0));
		}
		return rows;
	};
	const fullyExpanded = withBodies(naturalBodies, manuallyCollapsed);

	if (budget === undefined) return { bodyRows: fullyExpanded, autoCollapsed };

	// Hold the previous decisions while the same widgets (keys, recency, budget,
	// width) are on screen and the block only moved a little: that absorbs height
	// jitter. A resize, a widget update, or a larger content change recomputes
	// instead. Wrapping depends on the column count, so a render at another width
	// (for example a full-document pass) must not seed decisions the on-screen
	// layout then holds.
	const signature = `${budget}|${width}|${entries.map((entry) => `${entry.key}#${entry.stamp}`).join("|")}`;
	const naturalRows = inlineWidgetRows(entries, fullyExpanded);
	const deadband = Math.max(INLINE_TAIL_HOLD_DEADBAND_ROWS, Math.floor(budget * 0.2));
	const previousRows = state.autoNaturalRows;
	// Re-expanding needs the fully expanded block to fit for two frames in a row:
	// one frame would let a one-row jitter flip the decisions back and forth,
	// while content that keeps shrinking still clears them.
	const fits = naturalRows <= budget;
	const fitStreak = fits ? (state.autoFitStreak ?? 0) + 1 : 0;
	const hold =
		state.autoSignature === signature &&
		previousRows !== undefined &&
		Math.abs(naturalRows - previousRows) <= deadband &&
		fitStreak < INLINE_TAIL_EXPAND_STREAK;
	state.autoSignature = signature;
	state.autoNaturalRows = naturalRows;
	state.autoFitStreak = fitStreak;
	if (!hold) autoCollapsed.clear();
	const sticky = hold ? new Set([...autoCollapsed].filter((key) => !pinned.has(key))) : new Set<string>();
	const hidden = new Set([...manuallyCollapsed, ...sticky]);
	// Record automatic decisions once, so a header can say it collapsed itself.
	const finish = (bodyRows: Map<string, number>): InlineWidgetPlan => {
		for (const entry of entries) {
			if (pinned.has(entry.key) || hidden.has(entry.key)) continue;
			if ((bodyRows.get(entry.key) ?? 0) === 0) autoCollapsed.add(entry.key);
			else autoCollapsed.delete(entry.key);
		}
		return { bodyRows, autoCollapsed };
	};

	const natural = withBodies(naturalBodies, hidden);
	if (inlineWidgetRows(entries, natural) <= budget) return finish(natural);

	// A bare header stack that already overflows has one answer whatever the
	// bodies are, and deciding it here bounds the allocation work below by the
	// budget: an extension that registers many widgets stays linear per frame.
	const minimum = new Map(entries.map((entry) => [entry.key, 0]));
	if (inlineWidgetRows(entries, minimum) > budget) {
		return { bodyRows: new Map<string, number>(), autoCollapsed };
	}

	// Hand complete bodies to the highest-priority widgets. The first widget
	// whose full body no longer fits is the cut: it and every lower-priority
	// widget collapse to its header. Pins were preloaded above and keep their
	// bodies even when they alone overflow the budget.
	const assigned = new Map(pinnedBodies);
	const byPriority = [...entries].sort((a, b) => compareInlinePriority(b, a));
	for (const entry of byPriority) {
		if (hidden.has(entry.key) || assigned.has(entry.key)) continue;
		const candidate = new Map(assigned);
		candidate.set(entry.key, naturalBody(entry));
		if (inlineWidgetRows(entries, withBodies(candidate, hidden)) > budget) break;
		assigned.set(entry.key, naturalBody(entry));
	}
	return finish(withBodies(assigned, hidden));
}

/** Higher value = kept expanded longer: most recently updated, then registration order. */
function compareInlinePriority(a: InlineWidgetEntry, b: InlineWidgetEntry): number {
	const recency = a.stamp - b.stamp;
	return recency !== 0 ? recency : b.order - a.order;
}

/** Rows the block occupies: headers, separators, and bodies. */
function inlineWidgetRows(entries: readonly InlineWidgetEntry[], bodyRows: ReadonlyMap<string, number>): number {
	let rows = 0;
	for (let index = 0; index < entries.length; index += 1) {
		const body = plannedBodyRows(entries, bodyRows, index);
		const previousCollapsed = index > 0 && plannedBodyRows(entries, bodyRows, index - 1) === 0;
		if (index > 0 && !(body === 0 && previousCollapsed)) rows += 1;
		rows += 1;
		rows += body;
	}
	return rows;
}

/** Body rows planned for one entry; an entry that is missing or collapsed plans none. */
function plannedBodyRows(
	entries: readonly InlineWidgetEntry[],
	bodyRows: ReadonlyMap<string, number>,
	index: number,
): number {
	return bodyRows.get(entries[index]?.key ?? "") ?? 0;
}

/**
 * `▸ Inline · <key>` rule heading one widget. The hint of a collapsed header is
 * clipped with the header rather than wrapped, and a header is the only row
 * describing a collapsed widget, so long keys give way to the hint.
 */
function inlineWidgetSectionHeader(key: string, bodyWidth: number, collapsed = false, autoCollapsed = false): string {
	const safeKey = sanitizeWidgetLine(key).trim();
	const hint = collapsed ? inlineWidgetHint(safeKey, bodyWidth, autoCollapsed) : "";
	const label = truncateToWidth(safeKey, Math.max(1, bodyWidth - 16 - visibleWidth(hint)), "...");
	const inlineLabel = `▸ Inline · ${label}`;
	const rule = "─".repeat(Math.max(0, bodyWidth - visibleWidth(inlineLabel) - visibleWidth(hint) - 1));
	return theme.fg("dim", truncateToWidth(`${inlineLabel} ${rule}${hint}`, bodyWidth, "…"));
}

/**
 * Expand hint for a collapsed header, dropping the parts that do not fit: the
 * marker first, then the widget key, then the command's argument, so the
 * actionable part survives as long as the row allows. The header passes its own
 * sanitized key.
 */
function inlineWidgetHint(key: string, bodyWidth: number, autoCollapsed: boolean): string {
	const budget = bodyWidth - INLINE_HEADER_PREFIX_WIDTH;
	const candidates = autoCollapsed
		? [` (auto) /widgets expand ${key}`, ` /widgets expand ${key}`, " /widgets expand", " /widgets"]
		: [` /widgets expand ${key}`, " /widgets expand", " /widgets"];
	return candidates.find((candidate) => visibleWidth(candidate) <= budget) ?? "";
}

/** One-line fallback when even the bare header stack exceeds the budget. */
function inlineWidgetSummaryLine(widgetCount: number, bodyWidth: number): string {
	// Same staging as a collapsed header: the command is the actionable part, so
	// it outranks the count and the label.
	const prefix = truncateToWidth(
		`▸ Inline · ${widgetCount} widgets`,
		Math.max(1, bodyWidth - INLINE_SUMMARY_COMMAND_WIDTH),
		"…",
	);
	const candidates = [`${prefix} · /widgets expand`, `${prefix} · /widgets`, prefix];
	const text = candidates.find((candidate) => visibleWidth(candidate) <= bodyWidth) ?? prefix;
	return theme.fg("dim", text);
}

/**
 * One widget line, reduced to printable text plus SGR colours. A key is trimmed
 * at both ends because the header places it; a body keeps its own indentation.
 */
function sanitizeWidgetLine(line: string): string {
	return sanitizeTerminalText(line)
		.replace(/[\r\n\t]+/g, " ")
		.trimEnd();
}
