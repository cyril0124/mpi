/**
 * Key labels for the fork's hints.
 *
 * The hint helpers print the name a key is bound by, so a cursor key reads as
 * `left`. A hint that points at an arrow key reads better with the glyph the
 * key carries.
 */
import { getKeybindings, type Keybinding } from "@earendil-works/pi-tui";
import { formatKeyText, keyText } from "../keybinding-hints.ts";

/** Key text with the cursor keys as glyphs, so a hint reads `←` rather than `left`. */
function formatKeyGlyphs(text: string): string {
	return text
		.replace(/\bup\b/g, "↑")
		.replace(/\bdown\b/g, "↓")
		.replace(/\bleft\b/g, "←")
		.replace(/\bright\b/g, "→");
}

/** Every key the binding answers, with the cursor keys as glyphs. Empty when unbound. */
export function keyGlyphText(keybinding: Keybinding): string {
	return formatKeyGlyphs(keyText(keybinding));
}

/**
 * The keybinding's first key only, with the cursor keys as glyphs. A hint row with
 * room for one key per action names the main one instead of every alternative.
 */
export function primaryKeyGlyphText(keybinding: Keybinding): string {
	const [first] = getKeybindings().getKeys(keybinding);
	return first === undefined ? "" : formatKeyGlyphs(formatKeyText(first));
}
