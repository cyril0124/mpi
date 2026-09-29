/**
 * The published selection surfaces. The order matters: the notice panel floats over the
 * transcript and the prompt card, so a drag inside it has to resolve to the notice, or the
 * copied text would come from the surface underneath and keep the panel's frame.
 */

import type { Component } from "@earendil-works/pi-tui";
import { describe, expect, it } from "vitest";
import { normalizeSelectionText } from "../../src/core/mixcode/selection/chat-selection.ts";
import { createMouseSelectionOptions } from "../../src/modes/interactive/mixcode/selection/selection-surface.ts";

function fakeComponent(name: string): Component {
	return { render: () => [`<${name}>`], invalidate: () => {} };
}

const chat = fakeComponent("chat");
const input = fakeComponent("input");
const notice = fakeComponent("notice");

function options(overrides: { modalOpen?: boolean; notice?: Component; chat?: Component; input?: Component }) {
	return createMouseSelectionOptions({
		chat: () => overrides.chat,
		input: () => overrides.input,
		notice: () => overrides.notice,
		modalOpen: () => overrides.modalOpen === true,
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
});
