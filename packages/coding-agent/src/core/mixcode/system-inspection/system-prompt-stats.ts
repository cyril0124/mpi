/**
 * Display rows for a replayed system prompt, and the footer that sizes them.
 *
 * The rows are a decomposition of the prompt the provider receives: they
 * concatenate back to it exactly, with the blank line between sections owned by
 * the row that follows it. `project_context` splits further, one row per project
 * file, so the footer keeps a per-file breakdown.
 */
import { renderTokenBreakdown } from "./token-breakdown.ts";

/** One named contiguous fragment of the final system prompt. */
export interface SystemPromptSection {
	name: string;
	/** Exact prompt bytes owned by this section; sections concatenate to the prompt. */
	text: string;
}

/** One `<project_instructions path="...">...</project_instructions>` block of the project group. */
const PROJECT_FILE_ROW_RE = /<project_instructions path="([^"]*)">[\s\S]*?<\/project_instructions>\n\n?/g;

/**
 * Display rows for one replayed section value.
 *
 * Splits slice the original text rather than trimming it, which keeps the
 * concatenation exact.
 */
export function sectionRowsForValue(name: string, text: string): SystemPromptSection[] {
	const files = name === "project_context" ? [...text.matchAll(PROJECT_FILE_ROW_RE)] : [];
	if (files.length === 0) return [{ name, text }];

	const rows: SystemPromptSection[] = [];
	let cursor = 0;
	for (const file of files) {
		const start = file.index ?? cursor;
		rows.push({ name: `${name} (frame)`, text: text.slice(cursor, start) });
		rows.push({ name: `${name}: ${file[1]}`, text: text.slice(start, start + file[0].length) });
		cursor = start + file[0].length;
	}
	rows.push({ name: `${name} (frame)`, text: text.slice(cursor) });
	return rows;
}

/**
 * Render the `/system-prompt` footer for a section breakdown.
 *
 * Contract: pure formatting, no mutation. Per-turn extension overrides commonly
 * re-emit the base with extra text around it, so the override delta becomes
 * prefix/suffix rows and stays counted, with totals over the effective prompt.
 * Only when the base cannot be located inside the effective prompt at all does
 * the table describe the base alone, with a note line saying so.
 */
export function renderSystemPromptSectionStats(
	sections: readonly SystemPromptSection[],
	effectivePrompt: string,
): string {
	const assembled = sections.map((section) => section.text).join("");
	const rows = [...sections];
	let totalText = assembled;
	let mismatchNote: string | undefined;
	if (effectivePrompt !== assembled) {
		const baseAt = effectivePrompt.indexOf(assembled);
		if (baseAt === -1) {
			mismatchNote =
				"(describes the assembled base prompt; effective prompt differs - extension override or format drift)";
		} else {
			const prefix = effectivePrompt.slice(0, baseAt);
			const suffix = effectivePrompt.slice(baseAt + assembled.length);
			if (prefix) rows.unshift({ name: "(extension override prefix)", text: prefix });
			if (suffix) rows.push({ name: "(extension override suffix)", text: suffix });
			totalText = effectivePrompt;
		}
	}

	return renderTokenBreakdown(
		"System prompt section breakdown (token estimates are heuristic: ~4 chars/token, ~1/CJK char):",
		rows,
		totalText,
		mismatchNote ? [mismatchNote] : [],
	);
}
