/**
 * Pointer hover state shared by the clickable MixCode surfaces.
 *
 * Hover is presentation-only: it never changes keyboard selection, focus, the
 * active tab, or scroll position. An owner publishes the same rectangles its
 * click handling uses, and paints the hovered one over the lines it just
 * rendered. Coordinates are zero-based cells, matching `TuiMouseEvent`.
 */
import { compositeTuiLine, isImageLine, sliceByColumn, visibleWidth } from "@earendil-works/pi-tui";
import { theme } from "../../../theme/theme.ts";
import { reopenAfterSgr, SGR_SEQUENCE } from "../terminal-text.ts";

/** One rendered rectangle matching a clickable target's visible cells. */
export interface HoverTarget {
	id: string;
	/** Column of the target's first cell. */
	x: number;
	/** Row of the target's first cell. */
	y: number;
	width: number;
	/** Rows the target covers; defaults to one. */
	height?: number;
}

/** Placeholder the theme wraps so one of its open sequences can be read back. */
const MARKER = "\u0001";
/** Plain underline the terminal understands, kept for a theme whose underline is a no-op. */
const PLAIN_UNDERLINE = "\x1b[4m";

/** Two targets describe the same cells, so a highlight on one still applies to the other. */
function sameTarget(a: HoverTarget, b: HoverTarget): boolean {
	return a.id === b.id && a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
}

/** Whether a pointer position falls inside a target's cells. */
function containsPointer(target: HoverTarget, x: number, y: number): boolean {
	return x >= target.x && x < target.x + target.width && y >= target.y && y < target.y + (target.height ?? 1);
}

/**
 * The theme's underline open sequence, or the plain one when the theme carries no
 * underline. `theme.underline` closes with a reset, so the sequence is taken from
 * the text before the marker instead of from the painted result. The hover cue
 * falls back rather than disappearing: a monochrome environment still needs the
 * underline to tell hover from keyboard selection.
 */
function hoverUnderlineOpen(): string {
	const painted = theme.underline(MARKER);
	const markerIndex = painted.indexOf(MARKER);
	return markerIndex > 0 ? painted.slice(0, markerIndex) : PLAIN_UNDERLINE;
}

/**
 * Background cue for a whole block row. The row is filled to the full width first, so the
 * cue covers the block as one rectangle instead of stopping at its text, and the background
 * is re-opened after every inner SGR, so content painted with its own background cannot mask
 * it. A row fill is the whole cue here, so the row keeps whatever styling its own content
 * already carries. Image rows are left alone, since only their own escape sequences can
 * describe them.
 */
export function paintRowBackground(line: string, width: number): string {
	const open = theme.getBgAnsi("selectedBg");
	if (!open || isImageLine(line)) return line;
	const filled = visibleWidth(line) < width ? line + " ".repeat(width - visibleWidth(line)) : line;
	return theme.bg("selectedBg", reopenAfterSgr(open, filled));
}

/**
 * Background plus underline for a clickable cell range. The underline keeps the
 * cue visible in a monochrome theme, where it is what distinguishes hover from
 * keyboard selection. The underline is re-opened after every inner SGR, so no
 * nested color can drop it.
 */
function paintHoverCells(text: string): string {
	const open = theme.getBgAnsi("selectedBg");
	const underline = hoverUnderlineOpen();
	// Every inner SGR ends both the background and the underline, so each one
	// re-opens with `open` then `underline`. The leading underline stands before
	// the first cell; the trailing one turns it off before the background closes.
	const body = `${underline}${text.replace(SGR_SEQUENCE, (sequence) => `${sequence}${open}${underline}`)}\x1b[24m`;
	return theme.bg("selectedBg", body);
}

/**
 * The hovered target of one surface, plus the targets the last render published.
 */
export class PointerHover {
	private targets: readonly HoverTarget[] = [];
	private hovered?: HoverTarget;
	private revision: string | undefined;

	/** Id of the hovered target, or undefined when nothing is hovered. */
	get id(): string | undefined {
		return this.hovered?.id;
	}

	/**
	 * Install the targets of the frame just rendered. A changed revision, or a
	 * target that moved, resized or lost its id, cancels the highlight instead of
	 * transferring it to whatever now occupies those cells.
	 */
	layout(targets: readonly HoverTarget[], revision?: string): void {
		if (this.revision !== revision) this.clear();
		this.revision = revision;
		if (this.hovered) {
			const previous = this.hovered;
			this.hovered = targets.find((target) => sameTarget(target, previous));
		}
		this.targets = targets;
	}

	/** Hit-test one pointer position; true only when the hovered target changed. */
	move(x: number, y: number): boolean {
		const target = this.targets.find((candidate) => containsPointer(candidate, x, y));
		const changed = this.hovered?.id !== target?.id;
		this.hovered = target;
		return changed;
	}

	/** Drop the highlight, keeping the targets a move can hit again. */
	clear(): boolean {
		const changed = this.hovered !== undefined;
		this.hovered = undefined;
		return changed;
	}

	/** Drop the highlight and the targets, as when the surface goes away. */
	reset(): void {
		this.clear();
		this.targets = [];
	}

	/**
	 * Paint the hovered target over `lines`. Only the target's cells change: line
	 * widths and every existing foreground color are preserved. The input array is
	 * left untouched, and returned as it is when nothing is hovered.
	 */
	paint(lines: string[], width: number): string[] {
		const target = this.hovered;
		if (!target) return lines;
		const result = lines.slice();
		for (let row = target.y; row < target.y + (target.height ?? 1); row++) {
			const line = result[row];
			if (line === undefined) continue;
			const cell = sliceByColumn(line, target.x, target.width, true);
			result[row] = compositeTuiLine(line, paintHoverCells(cell), target.x, visibleWidth(cell), width);
		}
		return result;
	}
}
