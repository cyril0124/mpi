/**
 * Highlight the characters a fuzzy query matched, so a filtered list shows why
 * each row survived. Shared by the overlays that filter with pi-tui's
 * `fuzzyFilter` (the command palette and Tab Jump): the two must mark the same
 * characters the filter matched, or a row would light up in columns that took no
 * part in the match decision.
 */
import { theme } from "../../theme/theme.ts";

/** Indices where `token` appears in `text` in order, or undefined when it does not. */
function subsequenceIndices(token: string, text: string): number[] | undefined {
	const indices: number[] = [];
	let cursor = 0;
	for (const character of token) {
		const index = text.indexOf(character, cursor);
		if (index === -1) return undefined;
		indices.push(index);
		cursor = index + 1;
	}
	return indices;
}

/** The letters/digits transposition pi-tui's `fuzzyFilter` also accepts, e.g. `4gpt` for `gpt-4`. */
function transposedToken(token: string): string | undefined {
	const lettersFirst = token.match(/^([a-z]+)([0-9]+)$/);
	if (lettersFirst) return `${lettersFirst[2]}${lettersFirst[1]}`;
	const digitsFirst = token.match(/^([0-9]+)([a-z]+)$/);
	if (digitsFirst) return `${digitsFirst[2]}${digitsFirst[1]}`;
	return undefined;
}

/**
 * Indices in `text` where the query matched, tokenising exactly as pi-tui's `fuzzyFilter`
 * does (`packages/tui/src/fuzzy.ts`): tokens split on whitespace and slashes, every
 * token must appear in order, and a token of letters and digits may match transposed.
 * `FuzzyMatch` exposes only `{matches, score}` and no match positions, so this copy
 * exists to know which characters to highlight; a change to the library's matching
 * rules must be mirrored here.
 */
function matchedIndices(query: string, text: string): Set<number> {
	const haystack = text.toLowerCase();
	const indices = new Set<number>();
	for (const token of query
		.trim()
		.toLowerCase()
		.split(/[\s/]+/)) {
		if (!token) continue;
		const direct = subsequenceIndices(token, haystack);
		if (direct) {
			for (const index of direct) indices.add(index);
			continue;
		}
		const transposed = transposedToken(token);
		const swapped = transposed ? subsequenceIndices(transposed, haystack) : undefined;
		if (!swapped) return new Set();
		for (const index of swapped) indices.add(index);
	}
	return indices;
}

/** Paint the characters the query matched, the way the rest of the UI marks search hits. */
export function highlightMatches(text: string, query: string, baseStyle?: (text: string) => string): string {
	const indices = matchedIndices(query, text);
	if (indices.size === 0) return baseStyle ? baseStyle(text) : text;
	let painted = "";
	let run = "";
	const flushRun = (): void => {
		if (run.length === 0) return;
		painted += baseStyle ? baseStyle(run) : run;
		run = "";
	};
	for (let index = 0; index < text.length; index++) {
		const character = text[index]!;
		if (indices.has(index)) {
			// The matched characters carry the hit style, so a row's own style must stop before
			// them: nesting it around the hit would lose it after the hit's reset.
			flushRun();
			painted += theme.bg("searchMatchBg", theme.fg("searchMatchText", character));
		} else {
			run += character;
		}
	}
	flushRun();
	return painted;
}
