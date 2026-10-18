import { describe, expect, it } from "vitest";
import { splitCompactArguments } from "../../src/core/mixcode/compact-arguments.ts";

/** A catalog holding one provider, so the classification of the leading word stays the whole test. */
const catalog = {
	hasModel: (reference: string) => reference === "manual-e2e/alpha" || reference === "openrouter/vendor/model-1",
	hasProvider: (provider: string) => provider === "manual-e2e" || provider === "openrouter",
};

describe("splitCompactArguments", () => {
	it("keeps the whole argument as instructions when the first word cannot be a model reference", () => {
		expect(splitCompactArguments("tighten the summary", catalog)).toEqual({
			instructions: "tighten the summary",
		});
		expect(splitCompactArguments("", catalog)).toEqual({ instructions: "" });
	});

	it("takes a resolvable model reference off the front, keeping only the instructions", () => {
		expect(splitCompactArguments("manual-e2e/alpha tighten the summary", catalog)).toEqual({
			modelRef: "manual-e2e/alpha",
			instructions: "tighten the summary",
		});
		expect(splitCompactArguments("openrouter/vendor/model-1", catalog)).toEqual({
			modelRef: "openrouter/vendor/model-1",
			instructions: "",
		});
	});

	/**
	 * A path has the same `word/word` form as `provider/modelId`. Reading it as a model
	 * reference refuses instructions that name a file.
	 */
	it("reads a path as instructions instead of a model reference", () => {
		expect(splitCompactArguments("src/auth.ts tighten the summary", catalog)).toEqual({
			instructions: "src/auth.ts tighten the summary",
		});
		expect(splitCompactArguments("src/auth tighten the summary", catalog)).toEqual({
			instructions: "src/auth tighten the summary",
		});
	});

	it("reports a misspelled model reference of a known provider", () => {
		expect(splitCompactArguments("manual-e2e/nope tighten the summary", catalog)).toEqual({
			unknownModelRef: "manual-e2e/nope",
			instructions: "",
		});
	});
});
