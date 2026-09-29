/**
 * Toast card: the box width it asks the overlay for, the rows it paints, and the
 * icon and color each type gets.
 */
import { visibleWidth } from "@earendil-works/pi-tui";
import { beforeEach, describe, expect, it } from "vitest";
import type { ToastType } from "../../src/core/mixcode/toast/toast.ts";
import {
	ToastCardComponent,
	toastBoxWidth,
	toastMessageRows,
} from "../../src/modes/interactive/components/mixcode/toast/toast-card.ts";
import { initTheme, type ThemeColor, theme } from "../../src/modes/interactive/theme/theme.ts";

beforeEach(() => {
	initTheme("dark");
});

/** The escape prefix the theme emits for a color, taken from the theme itself. */
function colorPrefix(color: ThemeColor): string {
	const probe = theme.fg(color, "X");
	return probe.slice(0, probe.indexOf("X"));
}

describe("toast card sizing", () => {
	it("widens with the message, between 24 and 48 columns and at most 45% of the terminal", () => {
		expect(toastBoxWidth("success", "Copied 11 chars.", 100)).toBe(24);
		expect(toastBoxWidth("error", "x".repeat(200), 100)).toBe(45);
		expect(toastBoxWidth("error", "x".repeat(200), 400)).toBe(48);
	});

	it("paints nothing when the terminal cannot hold the narrowest card", () => {
		expect(toastBoxWidth("success", "Copied 11 chars.", 20)).toBeUndefined();
		expect(toastBoxWidth("success", "Copied 11 chars.", 24)).toBeUndefined();
		expect(toastBoxWidth("success", "Copied 11 chars.", 25)).toBe(24);
	});
});

describe("toast card content", () => {
	it("wraps to at most three rows and cuts the last one short", () => {
		expect(toastMessageRows("success", "Copied 11 chars.", 40)).toHaveLength(1);

		const rows = toastMessageRows("error", "word ".repeat(200), 20);

		expect(rows).toHaveLength(3);
		expect(rows[2]?.endsWith("…")).toBe(true);
	});

	it("frames the message in a rounded box of the requested width", () => {
		const lines = new ToastCardComponent("warning", "Cannot close the last tab.").render(40);
		const plain = lines.map((line) => line.replace(/\x1b\[[0-9;]*m/g, ""));

		expect(plain).toHaveLength(3);
		expect(plain.every((line) => visibleWidth(line) === 40)).toBe(true);
		expect(plain[0]?.startsWith("╭")).toBe(true);
		expect(plain[2]?.startsWith("╰")).toBe(true);
		expect(plain[1]).toContain("⚠");
	});

	it("paints each type with its own icon and color", () => {
		const expected: Array<[ToastType, string, ThemeColor]> = [
			["info", "•", "accent"],
			["success", "✓", "success"],
			["warning", "⚠", "warning"],
			["error", "✖", "error"],
		];

		for (const [type, icon, color] of expected) {
			const lines = new ToastCardComponent(type, "Message").render(30);

			expect(lines[1]).toContain(icon);
			expect(lines.join("")).toContain(colorPrefix(color));
		}
	});
});
