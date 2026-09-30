import { describe, expect, it } from "vitest";
import { UserMessageComponent } from "../../src/modes/interactive/components/user-message.ts";
import {
	getMarkdownTheme,
	initTheme,
	loadThemeFromPath,
	setThemeInstance,
} from "../../src/modes/interactive/theme/theme.ts";

const THEME_DIR = new URL("../../src/modes/interactive/theme/", import.meta.url).pathname;

/** Returns the SGR color sequence immediately before the inline code span in rendered lines. */
function codeColor(lines: string[]): string {
	const match = lines.join("\n").match(/(\u001b\[[0-9;]*m)world/);
	expect(match).not.toBeNull();
	return match![1]!;
}

function message(): UserMessageComponent {
	// Inline code is used here because the surrounding box resamples its background on every
	// render, which would mask a stale Markdown cache. The inline code span retains whatever
	// color the Markdown body produced when it last rendered.
	return new UserMessageComponent("hello `world`", getMarkdownTheme(), 1, [], undefined, "both");
}

describe("message block theme invalidation", () => {
	it("recolours memoized markdown after a theme switch", () => {
		initTheme("dark");
		const component = message();
		const darkColor = codeColor(component.render(40));

		setThemeInstance(loadThemeFromPath(`${THEME_DIR}light.json`));
		// A fresh component in the new theme is the reference: its Markdown cache is cold.
		const freshColor = codeColor(message().render(40));
		expect(freshColor).not.toBe(darkColor);

		component.invalidate();
		expect(codeColor(component.render(40))).toBe(freshColor);
	});

	it("keeps identical output when the theme did not change", () => {
		initTheme("dark");
		const component = message();
		const before = component.render(40);
		component.invalidate();
		expect(component.render(40)).toEqual(before);
	});
});
