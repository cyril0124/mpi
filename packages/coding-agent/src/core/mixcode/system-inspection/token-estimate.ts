/**
 * Estimated token counts for the system prompt and the tool definitions.
 *
 * No tokenizer ships with the project, so every number derived from this module
 * is an estimate and callers label it as one. CJK characters tokenize at roughly
 * one per character against ~4 characters per token for latin text, so they are
 * counted separately, which keeps the proportions usable for Chinese-heavy
 * prompt files and skill descriptions.
 */
const CJK_CHARACTERS =
	/[\u{1100}-\u{11FF}\u{3040}-\u{30FF}\u{3130}-\u{318F}\u{3400}-\u{4DBF}\u{4E00}-\u{9FFF}\u{AC00}-\u{D7AF}\u{F900}-\u{FAFF}\u{FF00}-\u{FFEF}]/gu;

/** Estimated tokens in `text`, by the heuristic above. */
export function estimateTextTokens(text: string): number {
	const cjk = (text.match(CJK_CHARACTERS) ?? []).length;
	return Math.ceil(cjk + (text.length - cjk) / 4);
}
