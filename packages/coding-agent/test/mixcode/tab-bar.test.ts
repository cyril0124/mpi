import { beforeEach, describe, expect, it } from "vitest";
import { TabBar, type TabBarModel } from "../../src/modes/interactive/components/mixcode/multi-tab/tab-bar.ts";
import { initTheme, theme } from "../../src/modes/interactive/theme/theme.ts";

/**
 * Chip layout as the terminal shows it: what a chip looks like, how many rows
 * it takes, when tabs collapse into overflow counts, and where a click lands.
 */
beforeEach(() => {
	initTheme("dark");
});

function model(count: number, activeIndex: number, overrides: Partial<TabBarModel> = {}): TabBarModel {
	const tabs = Array.from({ length: count }, (_, index) => ({
		id: `t${index}`,
		title: `tab${index}`,
		status: "idle" as const,
		unread: false,
		recentRank: -1,
	}));
	return { tabs, activeId: `t${activeIndex}`, rulePainter: (text) => text, ...overrides };
}

/** Mouse event for hit testing; the component reads type, button, x, and y. */
function click(x: number, y: number) {
	return {
		type: "click" as const,
		button: "left" as const,
		x,
		y,
		screenX: x,
		screenY: y,
		width: 40,
		height: 4,
		shift: false,
		alt: false,
		ctrl: false,
	};
}

/** Layout assertions read the plain text; colors are asserted separately. */
function plain(text: string): string {
	return text.replace(/\x1b\[[0-9;]*m/g, "");
}

describe("tab bar layout", () => {
	it("renders one row of chips and a full-width rule", () => {
		const bar = new TabBar(
			() => model(3, 1),
			() => {},
		);
		const lines = bar.render(80);
		expect(lines).toHaveLength(2);
		expect(plain(lines[0]!)).toBe(" - tab0  ▌- tab1   - tab2 ");
		expect(lines[1]).toBe("─".repeat(80));
	});

	it("separates chips with a single space", () => {
		const bar = new TabBar(
			() => model(2, 0),
			() => {},
		);
		const row = plain(bar.render(80)[0]!);
		expect(row).toBe("▌- tab0   - tab1 ");
		expect(row).not.toContain("│");
	});

	it("wraps indented under the first chip and caps the row count", () => {
		const bar = new TabBar(
			() => model(16, 15, { maxRows: 3 }),
			() => {},
		);
		const lines = bar.render(40).map(plain);
		expect(lines).toHaveLength(4);
		expect(lines[0]!.startsWith(" +7 … ")).toBe(true);
		// The left hint leads row 0; continuation rows indent to the same column.
		expect(lines[1]!.indexOf("- tab")).toBe(lines[0]!.indexOf("- tab"));
		expect(lines[2]!.includes("▌")).toBe(true);
		expect(lines[3]).toBe("─".repeat(40));
		for (const line of lines.slice(0, 3)) expect(line.length).toBeLessThanOrEqual(40);
	});

	it("wraps under the first agent chip when a Home chip leads the bar", () => {
		const bar = new TabBar(
			() => model(20, 0, { maxRows: 3, home: { id: "home", label: "MixCode Home" } }),
			() => {},
		);
		const chipRows = bar
			.render(100)
			.map(plain)
			.filter((line) => line.includes("- tab"));
		expect(chipRows).toHaveLength(3);
		// Every row's first chip sits at the same column, past the Home chip and
		// its gutter.
		expect(chipRows.map((line) => line.indexOf("- tab"))).toEqual([16, 16, 16]);
	});

	it("counts the tabs hidden on the right on the last row", () => {
		const bar = new TabBar(
			() => model(16, 0, { maxRows: 3 }),
			() => {},
		);
		const lines = bar.render(40).map(plain);
		expect(lines[2]!.trimEnd().endsWith(" … +5")).toBe(true);
	});

	it("keeps the active chip visible when the tabs overflow", () => {
		const bar = new TabBar(
			() => model(16, 15, { maxRows: 3 }),
			() => {},
		);
		const lines = bar.render(40).map(plain);
		expect(lines.slice(0, 3).join("\n")).toContain("tab15");
	});

	it("marks a colored active chip inside its color pair", () => {
		const colored = model(2, 0);
		colored.tabs = [{ ...colored.tabs[0]!, color: "red" }, colored.tabs[1]!];
		const bar = new TabBar(
			() => colored,
			() => {},
		);
		const row = bar.render(80)[0]!;
		expect(row).toContain("▐");
		expect(row).not.toContain("▌");
		expect(row).not.toContain(theme.fg("success", "✓"));
	});

	it("emphasizes a completed chip whatever its recency", () => {
		const bar = new TabBar(
			() => ({
				tabs: [
					{ id: "a", title: "done-tab", status: "done", unread: true, recentRank: -1 },
					{ id: "b", title: "idle-tab", status: "idle", unread: false, recentRank: -1 },
				],
				activeId: "b",
				rulePainter: (text) => text,
			}),
			() => {},
		);
		const row = bar.render(80)[0]!;
		expect(row).toContain("✓");
		expect(row).toContain(theme.bold(theme.fg("success", "done-tab")));
	});
});

describe("tab bar clicks", () => {
	it("maps a click in any row to the chip under the pointer", () => {
		const selected: string[] = [];
		const bar = new TabBar(
			() => model(16, 15, { maxRows: 3 }),
			(id) => selected.push(id),
		);
		const lines = bar.render(40).map(plain);
		expect(bar.handleMouse(click(9, 1))).toEqual({ handled: true });
		expect(selected).toHaveLength(1);
		expect(lines[1]).toContain(`- tab${selected[0]!.slice(1)}`);
		// The rule row and the area past the last chip are not clickable.
		expect(bar.handleMouse(click(9, 3))).toBeUndefined();
		expect(bar.handleMouse(click(90, 0))).toBeUndefined();
		expect(selected).toHaveLength(1);
	});

	it("renders nothing without tabs", () => {
		const bar = new TabBar(
			() => model(0, 0),
			() => {},
		);
		expect(bar.render(40)).toEqual([]);
	});
});
