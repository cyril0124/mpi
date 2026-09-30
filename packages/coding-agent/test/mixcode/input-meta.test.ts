import { beforeAll, describe, expect, it } from "vitest";
import { renderInputMeta } from "../../src/modes/interactive/components/mixcode/input-dock/input-meta.ts";
import { initTheme } from "../../src/modes/interactive/theme/theme.ts";
import { stripAnsi } from "../../src/utils/ansi.ts";

const MODEL_GLYPH = "\u{f06a9}";

/** The row for a session with a short workdir and a known context reading. */
function render(width: number, iconMode: "nerd" | "ascii" = "nerd") {
	const rendered = renderInputMeta(
		{
			workdir: "/tmp/pi",
			model: "anthropic/claude-sonnet-4-5",
			thinking: "High",
			gitBranch: "main",
			contextTokens: 48_200,
			contextWindow: 200_000,
			extensionStatuses: new Map(),
			iconMode,
		},
		width,
	);
	// Every glyph here is one cell wide, so the stripped row indexes like the regions do.
	const cells = [...stripAnsi(rendered.lines[0] ?? "")];
	const textFor = (action: "models" | "thinking" | "workdir"): string => {
		const region = rendered.regions.find((candidate) => candidate.action === action);
		return region ? cells.slice(region.start, region.start + region.width).join("") : "";
	};
	return { cells, regions: rendered.regions, textFor };
}

describe("meta row icons", () => {
	beforeAll(() => {
		initTheme("dark");
	});

	it("paints the model glyph inside the model field's click target", () => {
		const { textFor } = render(120);

		expect(textFor("models")).toContain(MODEL_GLYPH);
		expect(textFor("models")).toContain("anthropic/claude-sonnet-4-5");
		expect(textFor("thinking")).toContain("High");
		expect(textFor("workdir")).toBe("/tmp/pi");
	});

	it("drops the model glyph when the left block has to compact", () => {
		const wide = render(120);
		const narrow = render(70);

		expect([...wide.textFor("models")]).toContain(MODEL_GLYPH);
		expect([...narrow.textFor("models")]).not.toContain(MODEL_GLYPH);
		expect(narrow.textFor("models")).toContain("claude-sonnet-4-5");
	});

	it("paints no private-use glyph in the ASCII set", () => {
		const { cells } = render(120, "ascii");

		expect(cells.filter((cell) => (cell.codePointAt(0) ?? 0) > 0xe000)).toEqual([]);
	});
});
