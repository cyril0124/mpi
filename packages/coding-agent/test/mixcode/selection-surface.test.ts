/**
 * The published selection surfaces. The order matters: the notice panel floats over the
 * transcript and the prompt card, so a drag inside it has to resolve to the notice, or the
 * copied text would come from the surface underneath and keep the panel's frame.
 */

import type { Component } from "@earendil-works/pi-tui";
import { beforeEach, describe, expect, it } from "vitest";
import { normalizeSelectionText } from "../../src/core/mixcode/selection/chat-selection.ts";
import { createMouseSelectionOptions } from "../../src/modes/interactive/mixcode/selection/selection-surface.ts";
import { initTheme, theme } from "../../src/modes/interactive/theme/theme.ts";

beforeEach(() => {
	initTheme("dark");
});

function fakeComponent(name: string): Component {
	return { render: () => [`<${name}>`], invalidate: () => {} };
}

const chat = fakeComponent("chat");
const input = fakeComponent("input");
const notice = fakeComponent("notice");

function options(overrides: {
	modalOpen?: boolean;
	notice?: Component;
	chat?: Component;
	input?: Component;
	cueRows?: readonly number[];
}) {
	return createMouseSelectionOptions({
		chat: () => overrides.chat,
		input: () => overrides.input,
		notice: () => overrides.notice,
		modalOpen: () => overrides.modalOpen === true,
		cueRow: (row) => overrides.cueRows?.includes(row) ?? false,
	});
}

describe("selection surfaces", () => {
	it("publishes the notice ahead of the surfaces it floats over", () => {
		const surfaces = options({ chat, input, notice }).surfaces?.() ?? [];
		expect(surfaces.map((surface) => surface.kind)).toEqual(["notice", "chat", "input"]);
	});

	it("keeps the composer selectable when the transcript is not showing", () => {
		const surfaces = options({ input }).surfaces?.() ?? [];
		expect(surfaces.map((surface) => surface.kind)).toEqual(["input"]);
	});

	it("leaves only the notice selectable while a modal owns the pointer", () => {
		const surfaces = options({ chat, input, notice, modalOpen: true }).surfaces?.() ?? [];
		expect(surfaces.map((surface) => surface.kind)).toEqual(["notice"]);
	});

	it("publishes nothing while a modal is open and no notice is up", () => {
		expect(options({ chat, input, modalOpen: true }).surfaces?.() ?? []).toEqual([]);
	});

	it("wires the copied text through the normalizer for the surface it came from", () => {
		const { normalizeText } = options({ notice });
		expect(normalizeText?.("│ body │", "notice")).toBe("body");
		expect(normalizeText?.("│ body │", "chat")).toBe("│ body │");
		expect(normalizeSelectionText("│ body │", "input")).toBe("body");
	});

	it("clears the highlight on release", () => {
		expect(options({ chat }).clearOnRelease).toBe(true);
	});

	it("underlines a selected chat row only inside a block that carries the cue", () => {
		const { highlight } = options({ chat, cueRows: [7] });
		expect(highlight?.("body", { kind: "chat", row: 7 })).toBe(theme.bg("selectedBg", "\x1b[4mbody\x1b[24m"));
	});

	it("keeps the plain selection background outside a cued block and off the other surfaces", () => {
		const { highlight } = options({ chat, cueRows: [7] });
		const plain = theme.bg("selectedBg", "body");
		for (const line of [
			{ kind: "chat", row: 6 },
			{ kind: "chat", row: 8 },
			{ kind: "input", row: 7 },
			{ kind: "notice", row: 7 },
		]) {
			expect(highlight?.("body", line)).toBe(plain);
		}
	});
});
