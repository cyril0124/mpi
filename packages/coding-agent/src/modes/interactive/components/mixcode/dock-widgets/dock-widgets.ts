/**
 * Row budget for the docked extension widgets.
 *
 * The dock is fixed chrome, so the widgets above and below the editor share one
 * row budget: a tall widget stack must not push the tab bar, the editor or the
 * chat off the screen. Whole rows go to the above-editor widgets first, the
 * remainder to the below-editor ones, and the cut is marked with one dim row, so
 * a trimmed stack still says that it was trimmed. Without a terminal size there
 * is nothing to budget against and the widgets render uncapped.
 *
 * The budget is per frame, because a terminal resize reaches nothing in this
 * mode: each slot measures the widgets it can see at the width it is rendered
 * with, and renders each of them once. Nothing is cached across frames, so a
 * widget that updates itself in place cannot go stale. A slot also forwards
 * mouse rows to the widget row they came from.
 */
import {
	type Component,
	type TuiMouseDispatchResult,
	type TuiMouseEvent,
	truncateToWidth,
} from "@earendil-works/pi-tui";
import { theme } from "../../../theme/theme.ts";
import { dispatchToRegion, type MouseRegion, regionAtRow } from "../mouse-regions.ts";

/**
 * Rows the editor keeps when widgets are docked. This is the editor's own layout
 * minimum, so the budget reserves what the layout would otherwise have to take.
 */
const EDITOR_MIN_ROWS = 3;
/** Rows the chat keeps however many widget rows are docked. */
const MIN_CHAT_ROWS = 6;
/**
 * Rows the dock itself always spends: the above-editor slot leads with a separating
 * row. It comes out of the same budget, or the chat would keep one row less than
 * its minimum says.
 */
const SLOT_SEPARATOR_ROWS = 1;
/** Wording of the one dim row that marks a trimmed stack. */
const TRUNCATION_MARKER = "… (widgets truncated)";

export interface DockWidgetSources {
	/** Live widget maps of the active tab, in registration order. */
	widgets: () => { above: ReadonlyMap<string, Component>; below: ReadonlyMap<string, Component> };
	/** Rows every other dock entry occupies at this width. */
	chromeRows: (width: number) => number;
	/** Terminal rows, or undefined when there is no terminal size yet. */
	viewportRows: () => number | undefined;
	/**
	 * True while the dock must show no widget rows: the tab renders them in the chat
	 * tail instead, or another surface owns the dock.
	 */
	widgetsHidden: () => boolean;
}

/** One slot's rows, with the row range each widget owns for mouse dispatch. */
interface DockSlotPlan {
	lines: string[];
	hits: MouseRegion[];
}

/** Shared by both slots, and only ever read. */
const EMPTY_PLAN: DockSlotPlan = { lines: [], hits: [] };

export class DockWidgetBudget {
	readonly above: DockWidgetSlot;
	readonly below: DockWidgetSlot;
	private readonly sources: DockWidgetSources;

	constructor(sources: DockWidgetSources) {
		this.sources = sources;
		this.above = new DockWidgetSlot("above", this);
		this.below = new DockWidgetSlot("below", this);
	}

	/** Widgets registered for one slot, in registration order. */
	widgetsOf(side: "above" | "below"): readonly Component[] {
		const source = this.sources.widgets();
		return [...(side === "above" ? source.above : source.below).values()];
	}

	widgetsHidden(): boolean {
		return this.sources.widgetsHidden();
	}

	/** Plan for this frame: every widget is rendered once, at this width. */
	planFor(width: number): { above: DockSlotPlan; below: DockSlotPlan } {
		return this.computePlan(width, this.sources.viewportRows(), this.widgetsOf("above"), this.widgetsOf("below"));
	}

	private computePlan(
		width: number,
		viewport: number | undefined,
		above: readonly Component[],
		below: readonly Component[],
	): { above: DockSlotPlan; below: DockSlotPlan } {
		const measuredAbove = measureSlot(width, above);
		const measuredBelow = measureSlot(width, below);
		if (viewport === undefined) return { above: measuredAbove, below: measuredBelow };

		const budget = viewport - this.sources.chromeRows(width) - EDITOR_MIN_ROWS - MIN_CHAT_ROWS - SLOT_SEPARATOR_ROWS;
		if (budget <= 0) return { above: EMPTY_PLAN, below: EMPTY_PLAN };
		const total = measuredAbove.lines.length + measuredBelow.lines.length;
		if (total <= budget) return { above: measuredAbove, below: measuredBelow };

		// One row of the budget marks the cut, then whole rows are handed to the
		// above-editor widgets first and the remainder to the below-editor ones.
		const contentBudget = budget - 1;
		const keptAbove = sliceSlot(measuredAbove, contentBudget);
		const keptBelow = sliceSlot(measuredBelow, contentBudget - keptAbove.lines.length);
		if (keptBelow.lines.length > 0) {
			keptBelow.lines.push(markerLine(width));
			return { above: keptAbove, below: keptBelow };
		}
		if (keptAbove.lines.length > 0) {
			keptAbove.lines.push(markerLine(width));
			return { above: keptAbove, below: EMPTY_PLAN };
		}
		return { above: { lines: [markerLine(width)], hits: [] }, below: EMPTY_PLAN };
	}
}

/** One dock slot: the widgets above or below the editor, bounded by the budget. */
export class DockWidgetSlot implements Component {
	private readonly side: "above" | "below";
	private readonly budget: DockWidgetBudget;
	/** Row ranges of the last render, so mouse events reach the widget under them. */
	private hits: DockSlotPlan["hits"] = [];

	constructor(side: "above" | "below", budget: DockWidgetBudget) {
		this.side = side;
		this.budget = budget;
	}

	/** The widgets keep their own styles; drop the row table so they re-render. */
	invalidate(): void {
		this.hits = [];
		for (const component of this.budget.widgetsOf(this.side)) component.invalidate?.();
	}

	render(width: number): string[] {
		this.hits = [];
		if (this.budget.widgetsHidden()) return [];

		const plan = this.budget.planFor(width)[this.side];
		// The above-editor slot keeps the separating row the dock always had: without
		// it the editor sits against the chat.
		const leadingRow = this.side === "above" ? [""] : [];
		if (plan.lines.length === 0) return leadingRow;

		const offset = leadingRow.length;
		this.hits = plan.hits.map((hit) => ({ ...hit, start: hit.start + offset }));
		return [...leadingRow, ...plan.lines];
	}

	/** Mouse rows are in this slot's row space; hand them to the widget there. */
	handleMouse(event: TuiMouseEvent): TuiMouseDispatchResult | undefined {
		const region = regionAtRow(this.hits, event);
		return region ? dispatchToRegion(region, event) : undefined;
	}
}

/** Rows one slot's widgets produce at this width, with the range each one owns. */
function measureSlot(width: number, widgets: readonly Component[]): DockSlotPlan {
	const plan: DockSlotPlan = { lines: [], hits: [] };
	for (const component of widgets) {
		const lines = component.render(width);
		// A widget with nothing to show contributes no rows.
		if (lines.length === 0) continue;
		plan.hits.push({ component, start: plan.lines.length, height: lines.length });
		plan.lines.push(...lines);
	}
	return plan;
}

/** The first `count` rows of a slot; a widget cut in half keeps only the rows shown. */
function sliceSlot(plan: DockSlotPlan, count: number): DockSlotPlan {
	const kept = Math.max(0, Math.min(count, plan.lines.length));
	const hits = plan.hits
		.map((hit) => ({
			component: hit.component,
			start: hit.start,
			height: Math.max(0, Math.min(hit.start + hit.height, kept) - hit.start),
		}))
		.filter((hit) => hit.height > 0);
	return { lines: plan.lines.slice(0, kept), hits };
}

function markerLine(width: number): string {
	return ` ${truncateToWidth(theme.fg("dim", TRUNCATION_MARKER), Math.max(1, width - 1), "…")}`;
}
