/**
 * The empty composer's vim row is the mode's key reference, so it has to name the keys
 * the user has, page action included. A fixed row kept showing `j/k`, `gg`, `G` and `q`
 * after a rebind and never named `app.vim.pageUp` / `pageDown`.
 */
import { getKeybindings, setKeybindings } from "@earendil-works/pi-tui";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { KeybindingsManager } from "../../src/core/keybindings.ts";
import { createHomeSelection } from "../../src/core/mixcode/home/home-state.ts";
import {
	type ComposerContext,
	composerPlaceholder,
} from "../../src/modes/interactive/components/mixcode/input-dock/composer-state.ts";
import { initTheme } from "../../src/modes/interactive/theme/theme.ts";

const defaultKeybindings = getKeybindings();

function vimContext(): ComposerContext {
	return {
		homeSelection: createHomeSelection(),
		tabs: undefined,
		activeTabTitle: undefined,
		vimActive: true,
		zenMode: false,
		shellMode: false,
		uiMode: "fullscreen",
		readUsage: () => undefined,
		fallbackContextWindow: 0,
		contextLimitOverridden: false,
	};
}

beforeEach(() => {
	initTheme("dark");
	// The app holds its own manager (with the `app.vim.*` ids) as the global one; the TUI's
	// default manager knows neither, which would render an empty row.
	setKeybindings(new KeybindingsManager());
});

afterEach(() => {
	setKeybindings(defaultKeybindings);
});

describe("vim mode's composer hint", () => {
	it("names every vim action with its default key, the page action included", () => {
		const hint = composerPlaceholder(vimContext());

		expect(hint).toContain("j/k scroll");
		expect(hint).toContain("PageUp/PageDown");
		expect(hint).toContain("gg/End ends");
		expect(hint).toContain("→/Shift+→ msg");
		expect(hint).toContain("q exit");
	});

	it("follows the user's bindings instead of the defaults", () => {
		setKeybindings(
			new KeybindingsManager({
				"app.vim.lineUp": "w",
				"app.vim.lineDown": "s",
				"app.vim.topPrefix": "h",
				"app.vim.exit": "x",
			}),
		);

		const hint = composerPlaceholder(vimContext());

		expect(hint).toContain("s/w scroll");
		expect(hint).toContain("hh/End ends");
		expect(hint).toContain("x exit");
		expect(hint).not.toContain("j/k");
		expect(hint).not.toContain("gg");
	});

	it("drops a segment whose action is unbound", () => {
		setKeybindings(new KeybindingsManager({ "app.vim.pageUp": [], "app.vim.pageDown": [] }));

		const hint = composerPlaceholder(vimContext());

		expect(hint).not.toContain("PageUp");
		expect(hint).toContain("j/k scroll");
	});

	it("keeps the ordinary empty-composer hint outside vim mode", () => {
		const context = { ...vimContext(), vimActive: false };

		expect(composerPlaceholder(context)).toContain("Describe your next change...");
	});
});
