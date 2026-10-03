import { getGraphemeSegmenter } from "../utils.ts";

/**
 * Number of grapheme clusters in `text`: what a terminal paints as one
 * character, so an emoji or a combining sequence counts once.
 */
export function countGraphemes(text: string): number {
	return [...getGraphemeSegmenter().segment(text)].length;
}
