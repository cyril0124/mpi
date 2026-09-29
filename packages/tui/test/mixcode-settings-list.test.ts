/**
 * Fork coverage for the `section` grouping added to pi-tui's SettingsList: a
 * heading row above each group, keeping navigation and mouse rows aligned.
 */
import assert from "node:assert";
import { describe, it } from "node:test";
import { SettingsList, type SettingsListTheme } from "../src/components/settings-list.ts";
import type { TuiMouseEvent } from "../src/tui.ts";

const testTheme: SettingsListTheme = {
	label: (text) => text,
	value: (text) => text,
	description: (text) => text,
	cursor: "> ",
	hint: (text) => text,
	section: (text) => `[${text}]`,
};

function mouse(x: number, y: number): TuiMouseEvent {
	return {
		type: "click",
		button: "left",
		x,
		y,
		screenX: x,
		screenY: y,
		width: 80,
		height: 10,
		shift: false,
		alt: false,
		ctrl: false,
		clickCount: 1,
	};
}

describe("SettingsList sections", () => {
	it("groups items under a section heading with a blank row before it", () => {
		const list = new SettingsList(
			[
				{ id: "a", label: "Alpha", currentValue: "1" },
				{ id: "b", label: "Beta", currentValue: "2", section: "Mixcode" },
				{ id: "c", label: "Gamma", currentValue: "3", section: "Mixcode" },
			],
			10,
			testTheme,
			() => {},
			() => {},
		);

		assert.deepStrictEqual(
			list.render(80).map((line) => line.trimEnd()),
			["> Alpha  1", "", "[  Mixcode]", "  Beta   2", "  Gamma  3", "", "  Enter/Space to change · Esc to cancel"],
		);
	});

	it("keeps mouse clicks on settings when a heading sits inside the window", () => {
		const clicked: string[] = [];
		const list = new SettingsList(
			[
				{ id: "a", label: "Alpha", currentValue: "1", values: ["1"] },
				{ id: "b", label: "Beta", currentValue: "2", values: ["2"], section: "Mixcode" },
			],
			10,
			testTheme,
			(id) => clicked.push(id),
			() => {},
		);
		list.render(80);

		// Rows: 0 Alpha, 1 blank, 2 heading, 3 Beta.
		assert.strictEqual(list.handleMouse?.(mouse(0, 2)), undefined);
		list.handleMouse?.(mouse(0, 3));
		assert.deepStrictEqual(clicked, ["b"]);
	});

	it("keeps navigation on settings and drops the headings while searching", () => {
		const changes: string[] = [];
		const list = new SettingsList(
			[
				{ id: "a", label: "Alpha", currentValue: "1", values: ["1"] },
				{ id: "b", label: "Beta", currentValue: "2", values: ["2", "x"], section: "Mixcode" },
			],
			10,
			testTheme,
			(_id, value) => changes.push(value),
			() => {},
			{ enableSearch: true },
		);

		assert.match(list.render(80).join("\n"), /\[ {2}Mixcode\]/);

		for (const character of "Beta") list.handleInput(character);
		const filtered = list.render(80).join("\n");
		assert.match(filtered, /Beta/);
		assert.doesNotMatch(filtered, /\[ {2}Mixcode\]/);

		list.handleInput("\r");
		list.handleInput("\r");
		assert.deepStrictEqual(changes, ["x", "2"]);
	});
});
