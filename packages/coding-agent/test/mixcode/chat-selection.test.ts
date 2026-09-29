/**
 * The text a mouse drag copies out of a framed surface: the frame the drag crossed must not come
 * with it, and what counts as frame differs per surface.
 */
import { describe, expect, it } from "vitest";
import { normalizeSelectionText } from "../../src/core/mixcode/selection/chat-selection.ts";

describe("normalizeSelectionText", () => {
	it("leaves transcript text alone", () => {
		expect(normalizeSelectionText("a tool wrote  this\nand this", "chat")).toBe("a tool wrote  this\nand this");
	});

	it("keeps an unknown surface's text unchanged", () => {
		expect(normalizeSelectionText("│ x │", "whatever")).toBe("│ x │");
	});

	it("drops the prompt card's border rows", () => {
		const lines = [
			"──────────────────────────────",
			" hello world                  ",
			" second line                  ",
			"──────────────────────────────",
		];
		// These rules are the whole frame, so the body keeps the spacing it was written with.
		expect(normalizeSelectionText(lines.join("\n"), "input")).toBe(" hello world\n second line");
	});

	it("keeps meaningful formatting inside the prompt card", () => {
		const lines = [
			"──────────────────────────────────",
			"     indented code                ",
			" ---                             ",
			" enter | accept are words        ",
			" scroll · marker is text         ",
			"──────────────────────────────────",
		];
		// The card draws rules, not side borders, so every leading space is the user's own indentation.
		expect(normalizeSelectionText(lines.join("\n"), "input")).toBe(
			"     indented code\n ---\n enter | accept are words\n scroll · marker is text",
		);
	});

	it("drops a framed surface's borders and its key-hint row", () => {
		const lines = [
			"┌─ BTW answer ─────────────────┐",
			"│ visible one                  │",
			"│ visible two                  │",
			"│ ↑↓ scroll · enter accept     │",
			"└──────────────────────────────┘",
		];
		expect(normalizeSelectionText(lines.join("\n"), "input")).toBe("visible one\nvisible two");
	});

	it("drops the notice panel's frame, its padding column and its key-hint row", () => {
		const lines = [
			"╭─ Notice ─────────────────────╮",
			"│ hello notice body            │",
			"│ second line here             │",
			"│ ↑ 2 earlier lines hidden     │",
			"│ c/y copy · Esc/q close       │",
			"╰──────────────────────────────╯",
		];
		expect(normalizeSelectionText(lines.join("\n"), "notice")).toBe(
			"hello notice body\nsecond line here\n↑ 2 earlier lines hidden",
		);
		expect(normalizeSelectionText("│ Esc/q close │", "notice")).toBe("");
	});

	it("copies nothing from a range that holds only frame rows", () => {
		expect(normalizeSelectionText("┌──────────┐\n└──────────┘", "input")).toBe("");
	});
});
