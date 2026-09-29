/**
 * Key labels for the fork's hints.
 *
 * The hint helpers print the name a key is bound by, so a cursor key reads as
 * `left`. A hint that points at an arrow key reads better with the glyph the
 * key carries.
 */
import type { Keybinding } from "@earendil-works/pi-tui";
import { keyText } from "../keybinding-hints.ts";

/** One keybinding's key, with the cursor keys as glyphs. Empty when unbound. */
export function arrowKeyText(keybinding: Keybinding): string {
	return keyText(keybinding)
		.replace(/\bup\b/g, "↑")
		.replace(/\bdown\b/g, "↓")
		.replace(/\bleft\b/g, "←")
		.replace(/\bright\b/g, "→");
}
