import type { Model } from "../../src/types.ts";

// Protocol regressions must remain testable after a model leaves the live catalog.
export const opencodeGoKimiK26: Model<"openai-completions"> = {
	id: "kimi-k2.6",
	name: "Kimi K2.6",
	api: "openai-completions",
	provider: "opencode-go",
	baseUrl: "https://opencode.ai/zen/go/v1",
	reasoning: true,
	input: ["text", "image"],
	contextWindow: 262144,
	maxTokens: 131072,
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	thinkingLevelMap: { minimal: null, low: null, medium: null },
	compat: {
		supportsStore: false,
		supportsDeveloperRole: false,
		supportsReasoningEffort: false,
		thinkingFormat: "deepseek",
		maxTokensField: "max_tokens",
		supportsLongCacheRetention: false,
	},
};
