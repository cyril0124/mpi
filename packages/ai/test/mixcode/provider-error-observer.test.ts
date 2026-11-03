import { BedrockRuntimeServiceException } from "@aws-sdk/client-bedrock-runtime";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { streamSimple as streamSimpleBedrock } from "../../src/api/bedrock-converse-stream.ts";
import { stream as streamOpenAICompletions } from "../../src/api/openai-completions.ts";
import { stream as streamOpenAIResponses } from "../../src/api/openai-responses.ts";
import type { Model } from "../../src/types.ts";

// openai SDK APIError shape: "<status> status code (no body)" message, the
// parsed body kept on `.error`.
class FakeAPIError extends Error {
	status: number;
	error: unknown;
	constructor(status: number, parsedBody: unknown) {
		super(`${status} status code (no body)`);
		this.name = "PermissionDeniedError";
		this.status = status;
		this.error = parsedBody;
	}
}

const bedrockMock = vi.hoisted(() => ({
	sendError: undefined as unknown,
	respond: undefined as ((attempt: number) => Promise<unknown>) | undefined,
	attempts: 0,
}));

const openaiMock = vi.hoisted(() => ({
	parsedBody: { error: "blocked by gateway WAF" } as unknown,
	caughtError: undefined as Error | undefined,
}));

vi.mock("openai", () => {
	function throwingCreate() {
		const promise = Promise.resolve(undefined) as unknown as { withResponse: () => Promise<never> };
		promise.withResponse = async () => {
			openaiMock.caughtError = new FakeAPIError(403, openaiMock.parsedBody);
			throw openaiMock.caughtError;
		};
		return promise;
	}
	class FakeOpenAI {
		chat = { completions: { create: throwingCreate } };
		responses = { create: throwingCreate };
	}
	return { default: FakeOpenAI };
});

vi.mock("@aws-sdk/client-bedrock-runtime", () => {
	class BedrockRuntimeServiceException extends Error {
		constructor(options: { name: string; message: string }) {
			super(options.message);
			this.name = options.name;
		}
	}

	class BedrockRuntimeClient {
		middlewareStack = { add: () => {} };
		send(): Promise<unknown> {
			bedrockMock.attempts++;
			return bedrockMock.respond?.(bedrockMock.attempts) ?? Promise.reject(bedrockMock.sendError);
		}
	}

	class ConverseStreamCommand {
		readonly input: unknown;
		constructor(input: unknown) {
			this.input = input;
		}
	}

	return {
		BedrockRuntimeClient,
		BedrockRuntimeServiceException,
		ConverseStreamCommand,
		StopReason: {
			END_TURN: "end_turn",
			STOP_SEQUENCE: "stop_sequence",
			MAX_TOKENS: "max_tokens",
			MODEL_CONTEXT_WINDOW_EXCEEDED: "model_context_window_exceeded",
			TOOL_USE: "tool_use",
		},
		CachePointType: { DEFAULT: "default" },
		CacheTTL: { ONE_HOUR: "ONE_HOUR" },
		ConversationRole: { ASSISTANT: "assistant", USER: "user" },
		ImageFormat: { JPEG: "jpeg", PNG: "png", GIF: "gif", WEBP: "webp" },
		ToolResultStatus: { ERROR: "error", SUCCESS: "success" },
	};
});

import { getModel, normalizeContext } from "../../src/compat.ts";

const context = normalizeContext({
	systemPrompt: "",
	messages: [{ role: "user", content: [{ type: "text", text: "hi" }], timestamp: 0 }],
	tools: [],
});

const completionsModel: Model<"openai-completions"> = {
	id: "test-model",
	name: "Test Model",
	api: "openai-completions",
	provider: "openrouter",
	baseUrl: "https://openrouter.ai/api/v1",
	reasoning: false,
	input: ["text"],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 1000,
	maxTokens: 100,
};

const responsesModel: Model<"openai-responses"> = {
	id: "gpt-test",
	name: "GPT Test",
	api: "openai-responses",
	provider: "openai",
	baseUrl: "https://api.openai.com/v1",
	reasoning: false,
	input: ["text"],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 1000,
	maxTokens: 100,
};

async function drainResult(stream: {
	[Symbol.asyncIterator](): AsyncIterator<unknown>;
	result(): Promise<{ errorMessage?: string; stopReason?: string }>;
}) {
	for await (const _event of stream) {
		void _event;
	}
	return stream.result();
}

describe("provider error observer", () => {
	beforeEach(() => {
		openaiMock.parsedBody = { error: "blocked by gateway WAF" };
		openaiMock.caughtError = undefined;
		bedrockMock.respond = undefined;
		bedrockMock.attempts = 0;
	});

	it("openai-completions (body-blind text) surfaces status + body despite observer failure", async () => {
		const onProviderError = vi.fn(() => {
			throw new Error("diagnostics observer failed");
		});
		const output = await drainResult(
			streamOpenAICompletions(completionsModel, context, { apiKey: "test", onProviderError }),
		);

		expect(onProviderError).toHaveBeenCalledExactlyOnceWith(openaiMock.caughtError, completionsModel);
		expect(output.stopReason).toBe("error");
		expect(output.errorMessage).toContain("403");
		expect(output.errorMessage).toContain("blocked by gateway WAF");
		expect(output.errorMessage).not.toBe("403 status code (no body)");
	});

	it("openai-responses keeps the prefix and body despite an async observer failure", async () => {
		const onProviderError = vi.fn(async () => {
			throw new Error("async diagnostics observer failed");
		});
		const output = await drainResult(
			streamOpenAIResponses(responsesModel, context, { apiKey: "test", onProviderError }),
		);

		expect(onProviderError).toHaveBeenCalledExactlyOnceWith(openaiMock.caughtError, responsesModel);
		expect(output.stopReason).toBe("error");
		expect(output.errorMessage).toContain("OpenAI API error (403)");
		expect(output.errorMessage).toContain("blocked by gateway WAF");
	});

	it("bedrock streamSimple forwards terminal errors to the observer", async () => {
		bedrockMock.sendError = Object.assign(new Error("UnknownError"), {
			name: "UnknownError",
			$metadata: { httpStatusCode: 403 },
			$response: { statusCode: 403, body: '{"message":"blocked by gateway WAF"}' },
		});

		const model = getModel("amazon-bedrock", "us.anthropic.claude-opus-4-8");
		const onProviderError = vi.fn();
		const output = await drainResult(
			streamSimpleBedrock(model, normalizeContext({ messages: context.messages }), { onProviderError }),
		);

		expect(onProviderError).toHaveBeenCalledExactlyOnceWith(bedrockMock.sendError, model);
		expect(output.stopReason).toBe("error");
		expect(output.errorMessage).toContain("403");
		expect(output.errorMessage).toContain("blocked by gateway WAF");
		expect(output.errorMessage).not.toContain("Unknown: UnknownError");
	});

	it.each(["success", "failure"] as const)(
		"bedrock only reports terminal errors when strict-tool fallback ends in %s",
		async (outcome) => {
			const strictError = new BedrockRuntimeServiceException({
				name: "ValidationException",
				message: "Schemas contains too many parameters with union types (20 parameters with type arrays or anyOf).",
				$fault: "client",
				$metadata: { httpStatusCode: 400 },
			});
			const terminalError = new Error("fallback gateway failure");
			bedrockMock.respond = async (attempt) => {
				if (attempt === 1) throw strictError;
				if (outcome === "failure") throw terminalError;
				return {
					$metadata: { httpStatusCode: 200 },
					stream: (async function* () {
						yield { messageStart: { role: "assistant" } };
						yield { contentBlockDelta: { contentBlockIndex: 0, delta: { text: "Recovered" } } };
						yield { contentBlockStop: { contentBlockIndex: 0 } };
						yield { messageStop: { stopReason: "end_turn" } };
					})(),
				};
			};
			const model = {
				...getModel("amazon-bedrock", "global.anthropic.claude-opus-5"),
				compat: { supportsStrictMode: true },
			};
			const onProviderError = vi.fn();
			const onPayload = vi.fn();
			const output = await streamSimpleBedrock(
				model,
				normalizeContext({
					messages: context.messages,
					tools: [
						{
							name: "lookup",
							description: "Look up a value",
							parameters: { type: "object", properties: { value: { type: "string" } }, required: ["value"] },
							constrainedSampling: { type: "json_schema", strict: "prefer" },
						},
					],
				}),
				{ onProviderError, onPayload, cacheRetention: "none" },
			).result();

			const attempts = onPayload.mock.calls as unknown as [
				{ toolConfig: { tools: { toolSpec: { strict?: boolean } }[] } },
			][];
			expect(bedrockMock.attempts).toBe(2);
			expect(attempts[0][0].toolConfig.tools[0].toolSpec.strict).toBe(true);
			expect(attempts[1][0].toolConfig.tools[0].toolSpec.strict).toBeUndefined();
			expect(output.diagnostics).toEqual([expect.objectContaining({ type: "bedrock_strict_tools_fallback" })]);
			if (outcome === "success") {
				expect(output.stopReason).toBe("stop");
				expect(output.content).toEqual([{ type: "text", text: "Recovered" }]);
				expect(onProviderError).not.toHaveBeenCalled();
			} else {
				expect(output.stopReason).toBe("error");
				expect(output.errorMessage).toContain(terminalError.message);
				expect(onProviderError).toHaveBeenCalledExactlyOnceWith(terminalError, model);
			}
		},
	);
});
