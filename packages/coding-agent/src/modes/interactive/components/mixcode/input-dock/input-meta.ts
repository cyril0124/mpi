/**
 * The meta row under the input card.
 *
 * One row carries the workdir, the model and the thinking level on the left and
 * the context meter with the git branch on the right; a second row carries the
 * extension status texts. The left block degrades in fixed steps and the right
 * block is dropped in fixed steps, so the row says as much as it can at the width
 * it was given and never leaves a partial block behind.
 *
 * The model, the thinking level and the workdir are clickable: the render reports the cells
 * each one painted, and the dock footer opens that field's picker when a click lands inside
 * them.
 *
 * The glyphs come from `ui.icons.mode`.
 */
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { DEFAULT_ICON_MODE, type IconMode } from "../../../../../core/mixcode/mixcode-settings.ts";
import { theme } from "../../../theme/theme.ts";
import { formatCwdForFooter } from "../../footer.ts";
import { homeDir } from "../home-dir.ts";
import { type IconGlyphs, resolveGlyphs } from "../icons.ts";
import { compactWorkdir, padLine } from "../layout-text.ts";
import { sanitizeTerminalText } from "../terminal-text.ts";

/** Bar cells in the context meter. */
const CONTEXT_BAR_WIDTH = 8;

/** A meta-row field that opens a picker when clicked. */
export type MetaAction = "models" | "thinking" | "workdir";

/**
 * Cells one clickable field painted in the row, 0-based and relative to the
 * row's first column, so a pointer event can be tested against them directly.
 */
export interface MetaRegion {
	action: MetaAction;
	start: number;
	width: number;
}

/** The meta row and the clickable fields it painted. */
export interface InputMetaRender {
	lines: string[];
	/** Fields of the first line; empty when nothing is clickable. */
	regions: MetaRegion[];
}

export interface InputMetaData {
	/** Working directory; home-collapsed here. */
	workdir: string;
	model: string;
	/** Thinking level label, already capitalized. */
	thinking: string;
	gitBranch?: string;
	/** Context tokens, or null/undefined while the count is unknown. */
	contextTokens: number | null | undefined;
	contextWindow: number;
	extensionStatuses: ReadonlyMap<string, string>;
	/** Vim mode is a read-only surface, so the status row is hidden there. */
	statusesHidden?: boolean;
	/** `ui.icons.mode`; the row probes the terminal in `auto`. */
	iconMode?: IconMode;
}

/**
 * Render the meta row and, when there are any, the extension status row.
 *
 * Returns no rows when the terminal cannot show a single cell.
 */
export function renderInputMeta(data: InputMetaData, width: number): InputMetaRender {
	if (width <= 0) return { lines: [], regions: [] };
	const workdir = formatCwdForFooter(data.workdir, homeDir());
	const glyphs = resolveGlyphs(data.iconMode);

	// Absolute xxk/xxk lives on the card's top edge; this row keeps the meter only.
	const contextBadge = ` ${contextBarAndPercentText(data.contextTokens, data.contextWindow, data.iconMode)} `;
	const branch = data.gitBranch?.trim();
	const git = branch ? theme.fg("accent", theme.bold(` ${glyphs.git} ${branch} `)) : "";
	// Coverage falls back from the full right block to the meter alone, then to
	// nothing, so the left block keeps the most room it can.
	const rightOptions = [git ? `${contextBadge} ${git}` : contextBadge, contextBadge, ""];
	let left: LeftBlock | undefined;
	let right = "";
	for (const candidate of rightOptions) {
		const rightWidth = visibleWidth(candidate);
		const leftBudget = candidate ? Math.max(0, width - rightWidth - 1) : width;
		const attempt = renderInputMetaLeft(workdir, data.model, data.thinking, leftBudget, glyphs);
		if (!attempt.text) continue;
		if (candidate && visibleWidth(attempt.text) + 1 + rightWidth > width) continue;
		// A right block that squeezed the workdir off is worse than dropping it.
		if (candidate && !attempt.workdirIntact) continue;
		left = attempt;
		right = candidate;
		break;
	}
	// The last candidate is empty and always renders, so the loop sets `left`.
	if (!left) return { lines: [], regions: [] };

	const gap = Math.max(1, width - visibleWidth(left.text) - visibleWidth(right));
	// A right block only survives the loop above when a cell is left between the two.
	const row = right ? `${left.text}${" ".repeat(gap)}${right}` : left.text;

	const lines = [padLine(row, width)];
	const statuses = renderExtensionStatusLine(data.extensionStatuses, width, data.statusesHidden === true);
	if (statuses) lines.push(statuses);
	return { lines, regions: left.regions };
}

/** Exact compact usage for the card's top edge, e.g. `12.3k/200k` or `12.3k/32k*`. */
export function exactContextUsageText(tokens: number | null | undefined, limit: number, overridden = false): string {
	if (!(limit > 0)) return "";
	const mark = overridden ? "*" : "";
	if (tokens === null || tokens === undefined) return `?/${formatCompactTokenCount(limit)}${mark}`;
	return `${formatCompactTokenCount(tokens)}/${formatCompactTokenCount(limit)}${mark}`;
}

/** Context meter: the context glyph, then eight cells and the percentage. */
export function contextBarAndPercentText(
	tokens: number | null | undefined,
	limit: number,
	iconMode: IconMode = DEFAULT_ICON_MODE,
): string {
	const glyphs = resolveGlyphs(iconMode);
	const percent = contextUsagePercent(tokens, limit);
	if (percent === undefined) {
		// Empty meter until the first token count arrives; keep the width stable.
		return theme.fg("dim", `${glyphs.context} [${glyphs.barEmpty.repeat(CONTEXT_BAR_WIDTH)}] ?%`);
	}
	const filled = Math.max(0, Math.min(CONTEXT_BAR_WIDTH, Math.round((percent / 100) * CONTEXT_BAR_WIDTH)));
	const cells = `${glyphs.barFilled.repeat(filled)}${glyphs.barEmpty.repeat(CONTEXT_BAR_WIDTH - filled)}`;
	const bar = `${glyphs.context} [${cells}] ${percent.toFixed(1)}%`;
	if (percent >= 80) return theme.fg("error", bar);
	if (percent >= 50) return theme.fg("accent", bar);
	return theme.fg("success", bar);
}

function contextUsagePercent(tokens: number | null | undefined, limit: number): number | undefined {
	if (tokens === null || tokens === undefined || limit <= 0) return undefined;
	return Math.min(999, Math.max(0, (tokens / limit) * 100));
}

/** Compact token counts in thousands: `1k`, `1.23k`, `12.3k`; a whole thousand keeps no decimals. */
export function formatCompactTokenCount(tokens: number): string {
	const value = tokens / 1000;
	if (Number.isInteger(value)) return `${value.toFixed(0)}k`;
	return `${tokens < 10_000 ? value.toFixed(2) : value.toFixed(1)}k`;
}

/** `"provider/module-name"` -> `"module-name"`, keeping everything after the last slash. */
export function shortModelName(displayName: string): string {
	const slash = displayName.lastIndexOf("/");
	return slash >= 0 ? displayName.slice(slash + 1) : displayName;
}

interface LeftBlock {
	text: string;
	regions: MetaRegion[];
	fits: boolean;
	workdirIntact: boolean;
}

/** One degradation rung of the left block: what it shows and how it spaces the parts. */
interface MetaMode {
	model: string;
	thinking: string;
	gap: string;
}

/**
 * The left block, in the richest layout that fits: full model name with the
 * thinking level and the workdir, then the module name, then a truncated model
 * with single-space gaps. The two full layouts carry a glyph per field; the
 * tightest layout drops the glyphs along with the padding, since it exists to
 * fit the narrowest terminal. In `strict` mode a part that does not fit fails
 * instead of compacting; the returned `fits` and `workdirIntact` say whether the
 * caller may use the block.
 */
function renderInputMetaLeft(
	workdirPath: string,
	model: string,
	thinking: string,
	width: number,
	glyphs: IconGlyphs,
): LeftBlock {
	if (width <= 0) return { text: "", regions: [], fits: false, workdirIntact: false };
	const moduleName = shortModelName(model);
	const modes: MetaMode[] = [
		{ model: ` ${glyphs.model} ${model} `, thinking: ` ${glyphs.thinking} ${thinking} `, gap: "  " },
		{ model: ` ${glyphs.model} ${moduleName} `, thinking: ` ${glyphs.thinking} ${thinking} `, gap: "  " },
		{ model: moduleName, thinking, gap: " " },
	];
	// Strict modes need model, thinking and workdir all visible at natural width.
	for (let index = 0; index < modes.length - 1; index++) {
		const candidate = layoutInputMetaLeft(modes[index]!, workdirPath, width, true);
		if (candidate.fits) return candidate;
	}
	return layoutInputMetaLeft(modes[modes.length - 1]!, workdirPath, width, false);
}

function layoutInputMetaLeft(mode: MetaMode, workdirPath: string, width: number, strict: boolean): LeftBlock {
	const pieces: Array<{ action?: MetaAction; text: string }> = [];
	let remaining = Math.max(0, width - 2);
	let workdirIntact = false;
	const thinkingWidth = visibleWidth(mode.thinking);
	const modelFullWidth = visibleWidth(mode.model);
	const gapWidth = visibleWidth(mode.gap);
	if (strict && remaining - thinkingWidth - 2 * gapWidth < modelFullWidth) {
		return { text: "", regions: [], fits: false, workdirIntact: false };
	}
	const modelWidth = strict ? modelFullWidth : Math.max(5, Math.min(modelFullWidth, remaining - thinkingWidth));
	const modelText = strict ? mode.model : truncateToWidth(mode.model, modelWidth, "...");
	pieces.push({ action: "models", text: theme.fg("accent", theme.bold(modelText)) });
	remaining -= visibleWidth(modelText);

	if (remaining >= thinkingWidth) {
		pieces.push({ text: mode.gap });
		pieces.push({ action: "thinking", text: theme.fg("accent", theme.bold(mode.thinking)) });
		remaining -= gapWidth + thinkingWidth;
	} else if (strict) {
		return { text: "", regions: [], fits: false, workdirIntact: false };
	}

	const workdirBudget = Math.max(0, remaining - gapWidth);
	// Strict modes keep the path whole; only the fallback compacts or ellipsizes.
	if (strict) {
		if (visibleWidth(workdirPath) > workdirBudget) {
			return { text: "", regions: [], fits: false, workdirIntact: false };
		}
		pieces.push({ text: mode.gap });
		pieces.push({ action: "workdir", text: theme.fg("accent", workdirPath) });
		workdirIntact = true;
	} else if (workdirBudget >= 4) {
		pieces.push({ text: mode.gap });
		const workdir = compactWorkdir(workdirPath, workdirBudget);
		pieces.push({ action: "workdir", text: theme.fg("accent", workdir) });
		// Segment-compressed paths are fine; `...` truncation counts as obscured.
		workdirIntact = !workdir.includes("...");
	}

	// The painted piece includes its own padding spaces, so the region covers
	// exactly the cells a hover cue would light up.
	const regions: MetaRegion[] = [];
	let cursor = 0;
	for (const piece of pieces) {
		const pieceWidth = visibleWidth(piece.text);
		if (piece.action && pieceWidth > 0) {
			regions.push({ action: piece.action, start: cursor, width: pieceWidth });
		}
		cursor += pieceWidth;
	}
	return { text: pieces.map((piece) => piece.text).join(""), regions, fits: true, workdirIntact };
}

/** Extension statuses as one row: values sorted by key, joined by a dim `│`. */
function renderExtensionStatusLine(
	statuses: ReadonlyMap<string, string>,
	width: number,
	hidden: boolean,
): string | undefined {
	if (hidden || statuses.size === 0) return undefined;
	const text = [...statuses.entries()]
		.sort(([a], [b]) => a.localeCompare(b))
		.map(([, value]) => cleanStatusText(value))
		.filter((value) => value.length > 0)
		.join(` ${theme.fg("dim", "│")} `);
	if (!text) return undefined;
	return padLine(` ${text}`, width);
}

/** One row, colours kept: an extension status must not move the cursor. */
function cleanStatusText(text: string): string {
	return sanitizeTerminalText(text)
		.replace(/[\r\n\t]+/g, " ")
		.replace(/\s+/g, " ")
		.trim();
}
