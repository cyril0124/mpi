import { describe, expect, it } from "vitest";
import { resolveGlyphs, resolveIconMode } from "../../src/modes/interactive/components/mixcode/icons.ts";

describe("icon mode", () => {
	it("forces an alphabet, whatever the terminal reports", () => {
		expect(resolveIconMode("nerd", { TERM_PROGRAM: "xterm" })).toBe("nerd");
		expect(resolveIconMode("ascii", { TERM_PROGRAM: "Ghostty" })).toBe("ascii");
	});

	it("probes a terminal that ships a Nerd Font", () => {
		expect(resolveIconMode("auto", { TERM_PROGRAM: "Ghostty" })).toBe("nerd");
		expect(resolveIconMode("auto", { TERM_PROGRAM: "ghostty" })).toBe("nerd");
		expect(resolveIconMode("auto", { LC_TERMINAL: "WezTerm" })).toBe("nerd");
		expect(resolveIconMode("auto", { TERM: "xterm-kitty" })).toBe("nerd");
		expect(resolveIconMode("auto", { WT_SESSION: "1" })).toBe("nerd");
	});

	it("reads the locale hint even when the terminal program is unknown", () => {
		expect(resolveIconMode("auto", { TERM_PROGRAM: "Apple_Terminal", LC_TERMINAL: "kitty" })).toBe("nerd");
	});

	it("falls back to ASCII on an unknown terminal", () => {
		expect(resolveIconMode("auto", { TERM_PROGRAM: "xterm" })).toBe("ascii");
		expect(resolveIconMode("auto", {})).toBe("ascii");
	});

	it("keeps the ASCII set free of private-use glyphs", () => {
		const ascii = resolveGlyphs("ascii", { TERM_PROGRAM: "Ghostty" });
		for (const [name, glyph] of Object.entries(ascii)) {
			expect(glyph.codePointAt(0), name).toBeLessThan(0x80);
			expect(glyph.length, name).toBe(1);
		}
	});

	it("draws the Nerd Font set only when the font is expected", () => {
		const nerd = resolveGlyphs("nerd", { TERM_PROGRAM: "xterm" });
		expect(nerd.model.codePointAt(0)).toBe(0xf06a9);
		expect(nerd.thinking.codePointAt(0)).toBe(0xf0eb);
		expect(nerd.context.codePointAt(0)).toBe(0xf0c9);
		expect(nerd.git.codePointAt(0)).toBe(0xe0a0);
		expect(resolveGlyphs("auto", { TERM_PROGRAM: "xterm" }).model).toBe("M");
	});
});
