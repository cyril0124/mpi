/**
 * Hidden thinking blocks as a tail that follows the stream: a `Thinking` header
 * carrying a duration, then the last three visual rows of the block behind a left
 * rail. Shown in place of the `Thinking...` placeholder when
 * `ui.boxedHiddenThinking` is on; the placeholder is kept otherwise.
 */
import { type Component, truncateToWidth, visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import { theme } from "../../../theme/theme.ts";
import { formatSecondCount, padLine } from "../layout-text.ts";

/** Body rows the tail shows under its header. */
const TAIL_ROWS = 3;

/** Columns a body row spends outside its text: indent, rail, and the padding around it. */
const TAIL_ROW_OVERHEAD = 5;

/** Marks the first visible row when earlier content was dropped. */
const OVERFLOW_MARKER = "… ";

/** Label the tail replaces, and the fallback when stripping leaves nothing. */
export const HIDDEN_THINKING_PLACEHOLDER = "Thinking...";

/**
 * `thinking:` labels a provider can put at the start of a paragraph. Removed from
 * the preview only, so the tail shows the reasoning itself.
 */
const THINKING_LABEL_PREFIX = /(^|(?:\r?\n){2})[^\S\r\n]*(?:thinking:\s*)+/gi;

/**
 * Epoch stamps the tail reads on every frame; its owner keeps them so a live
 * timer survives the re-render each stream chunk causes.
 */
export interface ThinkingTailTimer {
	/** Epoch ms when the block first appeared; absent means no timer. */
	startedAt?: number;
	/** Epoch ms when the block stopped growing; absent while it still streams. */
	endedAt?: number;
}

/**
 * Strip what the provider adds for display, not what was thought: ANSI styling
 * and paragraph-leading `thinking:` labels. An empty result means the caller
 * should fall back to the placeholder.
 */
export function stripThinkingPresentation(text: string): string {
	let current = text.replace(/\x1b\[[0-9;]*m/g, "");
	while (true) {
		const withoutLabel = current.replace(THINKING_LABEL_PREFIX, "$1").trimStart();
		if (withoutLabel === current) return current.trim();
		current = withoutLabel;
	}
}

export class ThinkingTailComponent implements Component {
	private readonly text: string;
	private readonly timer: ThinkingTailTimer;

	constructor(text: string, timer: ThinkingTailTimer) {
		this.text = text;
		this.timer = timer;
	}

	invalidate(): void {
		// Nothing is cached: the duration is read from the clock on every frame.
	}

	/** Header plus up to `TAIL_ROWS` rail rows, padded to `width`. */
	render(width: number): string[] {
		// Reserve the indent, the rail, and the padding on either side of the text.
		const textWidth = Math.max(1, width - TAIL_ROW_OVERHEAD);
		const { rows, overflow } = tailVisualRows(this.text, textWidth, TAIL_ROWS);
		const body = rows.map((row, index) => {
			if (index === 0 && overflow) {
				const budget = Math.max(1, textWidth - visibleWidth(OVERFLOW_MARKER));
				const marked = `${OVERFLOW_MARKER}${truncateToWidth(row, budget, "", true)}`;
				return ` ${theme.fg("thinkingText", marked)}`;
			}
			return ` ${theme.fg("thinkingText", row)}`;
		});
		return renderThinkingRail(body, width, this.durationLabel());
	}

	/**
	 * Milliseconds below one second, tenths for the first minute, whole seconds
	 * after it. A block with no start stamp (history, or a finished message the
	 * renderer never streamed) carries no timer.
	 */
	private durationLabel(): string {
		const started = this.timer.startedAt;
		if (started === undefined) return "";
		const elapsed = Math.max(0, (this.timer.endedAt ?? Date.now()) - started);
		if (elapsed < 1000) return `${elapsed}ms`;
		if (elapsed < 60_000) return `${(Math.floor(elapsed / 100) / 10).toFixed(1)}s`;
		return formatSecondCount(Math.floor(elapsed / 1000));
	}
}

/** Header with the right-aligned clock, then one rail row per body line. */
function renderThinkingRail(body: string[], width: number, duration: string): string[] {
	const title = `  ${theme.fg("text", "Thinking")}`;
	const header = withRightClock(title, duration, Math.max(0, width - 1));
	const railRows = body.map((line) => `  ${theme.fg("borderMuted", "│")}${line}`);
	return [header, ...railRows].map((line) => padLine(line, width));
}

/**
 * Pack `left` and a right-aligned clock into `width`; the clock keeps one leading
 * space and stays dim. An empty clock leaves the space in place.
 */
function withRightClock(left: string, clock: string, width: number): string {
	const right = truncateToWidth(` ${clock}`, Math.max(0, width));
	const rightWidth = visibleWidth(right);
	const clippedLeft = truncateToWidth(left, Math.max(0, width - rightWidth));
	const fill = Math.max(0, width - visibleWidth(clippedLeft) - rightWidth);
	return `${clippedLeft}${" ".repeat(fill)}${theme.fg("dim", right)}`;
}

/**
 * The last `maxRows` visual rows of `text`, each source line wrapped to `width`.
 * A line longer than the whole budget is sliced to its tail first, so a very long
 * line costs the budget rather than its own length.
 */
function tailVisualRows(text: string, width: number, maxRows: number): { rows: string[]; overflow: boolean } {
	const colWidth = Math.max(1, width);
	const charBudget = maxRows * colWidth;
	const sourceLines = text.split(/\r?\n/);
	const visual: string[] = [];
	let overflow = false;
	for (let index = sourceLines.length - 1; index >= 0; index--) {
		const line = sourceLines[index] ?? "";
		const piece = line.length > charBudget ? line.slice(-charBudget) : line;
		if (line.length > charBudget) overflow = true;
		// A blank source line still occupies one body row.
		visual.unshift(...wrapTextWithAnsi(piece || " ", colWidth));
		if (visual.length >= maxRows) {
			overflow = overflow || index > 0 || visual.length > maxRows;
			return { rows: visual.slice(-maxRows), overflow };
		}
	}
	return { rows: visual, overflow };
}
