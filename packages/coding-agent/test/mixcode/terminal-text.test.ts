import { describe, expect, it } from "vitest";
import { reopenAfterReset } from "../../src/modes/interactive/components/mixcode/terminal-text.ts";

/**
 * The reset-safe paint wrapper: it restores a paint after any sequence that turns
 * an attribute back off, and leaves sequences that open a style alone.
 */
describe("reopenAfterReset", () => {
	const open = "\x1b[48;2;1;1;1m\x1b[38;2;9;9;9m";

	it("re-opens the paint after an inner reset", () => {
		const result = reopenAfterReset(open, "plain\x1b[39mrest");
		expect(result).toBe(`${open}plain\x1b[39m${open}rest`);
	});

	it("leaves an inner style open untouched", () => {
		const accent = "\x1b[38;2;200;100;50m";
		const result = reopenAfterReset(open, `${accent}lit\x1b[39m`);
		expect(result).not.toContain(`${accent}${open}`);
		expect(result).toContain(`${accent}lit\x1b[39m${open}`);
	});
});
