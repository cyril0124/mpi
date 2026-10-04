import { visibleWidth } from "@earendil-works/pi-tui";
import { beforeAll, describe, expect, it } from "vitest";
import {
	renderBottomEdge,
	renderTopEdge,
} from "../../src/modes/interactive/components/mixcode/input-dock/editor-card.ts";
import { initTheme } from "../../src/modes/interactive/theme/theme.ts";

/** Edge painter stand-in: the production one only adds color, which no width depends on. */
const frame = (text: string) => text;

/** Badges the composer puts on the left of the top edge; the edge adds their spacing itself. */
const MODE_LABELS = ["", "[VIM]", "[SHELL] [ZEN] ↑ 12"];
const CONTEXTS = ["", "12.3k/200k"];

describe("input card edges", () => {
	beforeAll(() => {
		initTheme("dark");
	});

	// A title wider than the edge is the case under test: the edge truncates it rather than
	// overflowing, and every width it accepts must keep the row exactly `width` columns wide.
	it("keeps the top edge exactly `width` columns wide", () => {
		// 10 is the narrowest width the composer still draws the card at.
		for (let width = 10; width <= 140; width++) {
			for (let titleWidth = 0; titleWidth <= 160; titleWidth += 3) {
				for (const modeLabel of MODE_LABELS) {
					for (const context of CONTEXTS) {
						const title = "T".repeat(titleWidth);
						const line = renderTopEdge(width, title, context, frame, modeLabel);
						const scenario = `width=${width} title=${titleWidth} modes=${JSON.stringify(modeLabel)} context=${context}`;
						expect(visibleWidth(line), scenario).toBe(width);
					}
				}
			}
		}
	});

	it("keeps the bottom edge exactly `width` columns wide", () => {
		for (let width = 10; width <= 140; width++) {
			for (let hintWidth = 0; hintWidth <= 80; hintWidth += 3) {
				const line = renderBottomEdge(width, "h".repeat(hintWidth), frame);
				expect(visibleWidth(line), `bottom width=${width} hint=${hintWidth}`).toBe(width);
			}
		}
	});

	it("drops the context before truncating a title that cannot share the edge", () => {
		const narrow = renderTopEdge(30, "a-long-tab-title", "9k/200k", frame);
		const wide = renderTopEdge(120, "a-long-tab-title", "9k/200k", frame);

		expect(narrow).toContain("a-long-tab-title");
		expect(narrow).not.toContain("9k/200k");
		expect(wide).toContain("9k/200k");
	});
});
