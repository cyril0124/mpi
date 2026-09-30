/**
 * The fenced token table both inspection footers print.
 *
 * Each row describes one named chunk of text; the table is a decomposition, so
 * callers pass the full text those rows cover as `totalText` for the percentage
 * column and the `Total` row instead of letting the table add the rows up.
 */
import { estimateTextTokens } from "./token-estimate.ts";

/** Width of the name column, including its padding. */
const NAME_WIDTH = 48;

/** One named chunk of text in a token breakdown table. */
export interface TokenBreakdownRow {
	name: string;
	text: string;
}

/**
 * Render a fenced token breakdown table.
 *
 * Contract: pure formatting. Empty rows are omitted and `notes` lines are
 * printed under the heading.
 */
export function renderTokenBreakdown(
	heading: string,
	rows: readonly TokenBreakdownRow[],
	totalText: string,
	notes: readonly string[] = [],
): string {
	const totalTokens = estimateTextTokens(totalText);
	const line = (name: string, text: string): string => {
		const tokens = estimateTextTokens(text);
		const percent = totalTokens > 0 ? ((tokens / totalTokens) * 100).toFixed(1) : "0.0";
		const label = name.length > NAME_WIDTH ? `…${name.slice(-(NAME_WIDTH - 1))}` : name.padEnd(NAME_WIDTH);
		return `${label} ${String(text.length).padStart(7)} chars ${`~${tokens}`.padStart(9)} tok ${percent.padStart(5)}%`;
	};
	const lines = ["---", heading, ...notes];
	for (const row of rows) {
		if (row.text.length === 0) continue;
		lines.push(line(row.name, row.text));
	}
	lines.push(line("Total", totalText));
	return `\n\`\`\`\n${lines.join("\n")}\n\`\`\`\n`;
}
