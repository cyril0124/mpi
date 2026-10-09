import { visibleWidth } from "@earendil-works/pi-tui";
import { beforeAll, describe, expect, test } from "vitest";
import {
	ClockedMessageBody,
	formatMessageClock,
} from "../../src/modes/interactive/components/mixcode/message-clock.ts";
import { UserMessageComponent } from "../../src/modes/interactive/components/user-message.ts";
import { getMarkdownTheme, initTheme } from "../../src/modes/interactive/theme/theme.ts";
import { stripAnsi } from "../../src/utils/ansi.ts";

/**
 * The send time a message block carries on its first text row: it sits at the right end of the
 * body's content area, blank rows ahead of the text stay blank, and the rows the body pads
 * itself keep the block's surface unbroken.
 */
beforeAll(() => {
	initTheme("dark");
});

/** A body with one blank row, one text row and one blank row, padded to the width it is given. */
const paddedBody = {
	invalidate: () => {},
	render: (width: number) => ["", " x", ""].map((text) => text.padEnd(width)),
};

/** Records the cells handed to a painter, which is where the block's background goes. */
const recordPainted = (painted: string[]) => (text: string) => {
	painted.push(text);
	return text;
};

describe("message send time", () => {
	test("the clock lands on the first row that carries text", () => {
		const painted: string[] = [];
		const rows = new ClockedMessageBody(paddedBody, "5:07 PM", recordPainted(painted), 1).render(20);

		// 8 cells of clock, so the body renders 12 wide. Every row fills the block, and the text
		// row hands the padding cell after the clock to the painter.
		expect(rows.map(stripAnsi)).toEqual([" ".repeat(20), `${" x".padEnd(11)} 5:07 PM `, " ".repeat(20)]);
		expect(rows.map((row) => visibleWidth(row))).toEqual([20, 20, 20]);
		expect(painted).toEqual([" ".repeat(8), " 5:07 PM ", " ".repeat(8)]);
	});

	test("a body without a clock is left exactly as it renders", () => {
		expect(new ClockedMessageBody(paddedBody, "").render(20)).toEqual([
			"".padEnd(20),
			" x".padEnd(20),
			"".padEnd(20),
		]);
	});

	test("a user message draws its own timestamp beside the first line of text", () => {
		const timestamp = Date.UTC(2026, 0, 2, 15, 4);
		const clock = formatMessageClock(timestamp);
		expect(clock).not.toBe("");

		const rows = new UserMessageComponent("hello", getMarkdownTheme(), 1, [], "both", timestamp).render(40);
		const plain = rows.map((row) => stripAnsi(row));
		const firstText = plain.findIndex((row) => row.trim() !== "");
		expect(firstText).toBeGreaterThanOrEqual(0);
		expect(plain[firstText]).toContain(clock);
		// A blank row keeps no clock, and every row fills the block.
		for (const row of plain) {
			if (row.trim() === "") expect(row).not.toContain(clock);
		}
		expect(new Set(rows.map((row) => visibleWidth(row)))).toEqual(new Set([40]));
	});
});
