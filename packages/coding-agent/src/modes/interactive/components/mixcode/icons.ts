/**
 * Glyphs of the dock meta row: a Nerd Font set and a plain ASCII fallback,
 * chosen by `ui.icons.mode` in `mixcode_settings.json`. The `auto` mode reads
 * the terminal name from the environment, because a private-use glyph painted
 * without the font is a box rather than an icon.
 */
import { DEFAULT_ICON_MODE, type IconMode } from "../../../../core/mixcode/mixcode-settings.ts";

/** Icons the meta row paints, in the two alphabets the setting selects. */
export interface IconGlyphs {
	/** Prefix of the model field in the row's full layouts. */
	model: string;
	/** Prefix of the thinking field in the row's full layouts. */
	thinking: string;
	/** Prefix of the context meter. */
	context: string;
	/** Prefix of the git branch. */
	git: string;
	/** Cells of the context meter. */
	barFilled: string;
	barEmpty: string;
}

const NERD_GLYPHS: IconGlyphs = {
	model: "\u{f06a9}",
	thinking: "\uf0eb",
	context: "\uf0c9",
	git: "\ue0a0",
	barFilled: "█",
	barEmpty: "░",
};

const ASCII_GLYPHS: IconGlyphs = {
	model: "M",
	thinking: "~",
	context: "#",
	git: "*",
	barFilled: "#",
	barEmpty: "-",
};

/**
 * Terminals whose default font is a Nerd Font build, lower-cased: a terminal
 * names itself in its own casing.
 */
const NERD_FONT_TERMINALS = new Set([
	"iterm.app",
	"ghostty",
	"wezterm",
	"kitty",
	"rio",
	"tabby",
	"windowsterminal",
	"vscode",
]);

/** Heuristic Nerd Font support, for `ui.icons.mode: "auto"`. */
export function detectNerdFont(env: NodeJS.ProcessEnv = process.env): boolean {
	if (namesNerdFontTerminal(env.TERM_PROGRAM)) return true;
	if (namesNerdFontTerminal(env.LC_TERMINAL)) return true;
	if (env.TERM === "xterm-kitty") return true;
	return Boolean(env.WT_SESSION);
}

/** Whether a terminal program name is one that ships a Nerd Font. */
function namesNerdFontTerminal(program: string | undefined): boolean {
	return program !== undefined && NERD_FONT_TERMINALS.has(program.toLowerCase());
}

/** The two alphabets a mode resolves to; `auto` picks one from the environment. */
export function resolveIconMode(
	mode: IconMode = DEFAULT_ICON_MODE,
	env: NodeJS.ProcessEnv = process.env,
): "nerd" | "ascii" {
	if (mode === "nerd") return "nerd";
	if (mode === "ascii") return "ascii";
	return detectNerdFont(env) ? "nerd" : "ascii";
}

/** The glyph set a mode paints with. */
export function resolveGlyphs(mode: IconMode = DEFAULT_ICON_MODE, env: NodeJS.ProcessEnv = process.env): IconGlyphs {
	return resolveIconMode(mode, env) === "nerd" ? NERD_GLYPHS : ASCII_GLYPHS;
}
