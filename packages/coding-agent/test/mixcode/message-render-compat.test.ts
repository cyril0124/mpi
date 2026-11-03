import type { AssistantMessage } from "@earendil-works/pi-ai";
import { stripTerminalSequences, Text, type TUI } from "@earendil-works/pi-tui";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
	MarkdownTransformContext,
	MarkdownTransformer,
	ToolRenderContext,
} from "../../src/core/extensions/types.ts";
import { AssistantMessageComponent } from "../../src/modes/interactive/components/assistant-message.ts";
import { formatMessageClock } from "../../src/modes/interactive/components/mixcode/message-clock.ts";
import { ToolExecutionComponent } from "../../src/modes/interactive/components/tool-execution.ts";
import {
	splitOversizedUserMessage,
	UserMessageComponent,
} from "../../src/modes/interactive/components/user-message.ts";
import { getMarkdownTheme, initTheme } from "../../src/modes/interactive/theme/theme.ts";

beforeEach(() => initTheme("dark"));
afterEach(() => vi.restoreAllMocks());

function message(content: AssistantMessage["content"]): AssistantMessage {
	return {
		role: "assistant",
		content,
		api: "openai-responses",
		provider: "openai",
		model: "gpt-4o-mini",
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "stop",
		timestamp: 0,
	};
}

describe("merged message rendering", () => {
	it("reuses streamed code blocks while transformers receive metadata and the final state", () => {
		const contexts: MarkdownTransformContext[] = [];
		const capture: MarkdownTransformer = (text, context) => {
			contexts.push(context);
			return `${text}\n\n${context.isStreaming ? "streaming" : "complete"}`;
		};
		const markdownTheme = getMarkdownTheme();
		const highlight = vi.fn(markdownTheme.highlightCode!);
		markdownTheme.highlightCode = highlight;
		const block = new AssistantMessageComponent(
			undefined,
			false,
			markdownTheme,
			undefined,
			1,
			[capture],
			"answer-id",
			"2025-01-15T10:30:00.000Z",
		);
		const first = message([{ type: "text", text: "```ts\nconst answer = 42;\n```\n\nfirst" }]);
		block.updateContent(first, true);
		expect(stripTerminalSequences(block.render(70).join("\n"))).toContain("streaming");
		const calls = highlight.mock.calls.length;
		const next = message([{ type: "text", text: "```ts\nconst answer = 42;\n```\n\nfirst second" }]);
		block.updateContent(next, true);
		block.render(70);
		block.updateContent(next, false);
		expect(stripTerminalSequences(block.render(70).join("\n"))).toContain("complete");
		expect(highlight.mock.calls.length).toBe(calls);
		expect(contexts.map((context) => context.isStreaming)).toEqual([true, true, false]);
		expect(
			contexts.every(
				(context) => context.messageId === "answer-id" && context.timestamp === "2025-01-15T10:30:00.000Z",
			),
		).toBe(true);
	});

	it("keeps optional and blank labels safe while the cached tail clock runs and freezes", () => {
		const now = vi.spyOn(Date, "now").mockReturnValue(1000);
		const block = new AssistantMessageComponent(
			undefined,
			true,
			undefined,
			undefined,
			1,
			[],
			"thinking-id",
			undefined,
			true,
		);
		const thinking = message([{ type: "thinking", thinking: "first\nsecond\nthird\nfourth" }]);
		block.updateContent(thinking, true);
		expect(stripTerminalSequences(block.render(60).join("\n"))).toContain("0ms");
		now.mockReturnValue(2500);
		expect(stripTerminalSequences(block.render(60).join("\n"))).toContain("1.5s");
		block.setHiddenThinkingLabel("   ");
		expect(stripTerminalSequences(block.render(60).join("\n"))).toContain("fourth");
		block.updateContent(thinking, false);
		const stopped = block.render(60);
		now.mockReturnValue(9000);
		expect(block.render(60)).toEqual(stopped);
		block.setBoxedHiddenThinking(false);
		expect(stripTerminalSequences(block.render(60).join("\n"))).toContain("Thinking...");
	});

	it("keeps split-message zone marks and numeric clocks separate from transformer metadata", () => {
		const contexts: MarkdownTransformContext[] = [];
		const capture: MarkdownTransformer = (text, context) => {
			contexts.push(context);
			return text;
		};
		const sentAt = new Date(2025, 0, 15, 7, 45).getTime();
		const parts = splitOversizedUserMessage(Array.from({ length: 450 }, (_, i) => `line-${i}`).join("\n"));
		expect(parts.length).toBe(3);
		const rows = parts.map((part) =>
			new UserMessageComponent(
				part.text,
				undefined,
				1,
				[capture],
				"user-id",
				"2025-01-15T10:30:00.000Z",
				part.marks,
				part.marks === "start" ? sentAt : undefined,
			)
				.render(60)
				.join("\n"),
		);
		expect(rows[0]).toContain("\x1b]133;A\x07");
		expect(stripTerminalSequences(rows[0]!)).toContain(formatMessageClock(sentAt));
		expect(rows[1]).not.toContain("\x1b]133;");
		expect(rows[2]).toContain("\x1b]133;B\x07\x1b]133;C\x07");
		expect(contexts).toHaveLength(3);
		expect(
			contexts.every(
				(context) =>
					context.messageId === "user-id" &&
					context.timestamp === "2025-01-15T10:30:00.000Z" &&
					!context.isStreaming,
			),
		).toBe(true);
	});

	it("flushes argument deltas before a same-width card cache hit and honors renderer invalidation", () => {
		let context: ToolRenderContext | undefined;
		let suffix = "pending";
		const renderCall = vi.fn((args: unknown, _theme: unknown, current: ToolRenderContext) => {
			const { path } = args as { path: string };
			context = current;
			const text = current.lastComponent instanceof Text ? current.lastComponent : new Text("", 0, 0);
			text.setText(`${path} ${suffix} ${current.keyText("app.tools.expand")}`);
			return text;
		});
		const requestRender = vi.fn();
		const block = new ToolExecutionComponent(
			"read",
			"tool-id",
			{ path: "before.ts" },
			{},
			{ renderCall },
			{ requestRender } as unknown as TUI,
			process.cwd(),
		);
		expect(stripTerminalSequences(block.render(60).join("\n"))).toContain("before.ts pending");
		const calls = renderCall.mock.calls.length;
		block.updateArgs({ path: "partial.ts" });
		block.updateArgs({ path: "after.ts" });
		expect(renderCall).toHaveBeenCalledTimes(calls);
		expect(stripTerminalSequences(block.render(60).join("\n"))).toContain("after.ts pending");
		expect(renderCall).toHaveBeenCalledTimes(calls + 1);
		expect(requestRender).toHaveBeenCalledTimes(2);
		expect(typeof context!.keyHint).toBe("function");
		suffix = "ready";
		context!.invalidate();
		expect(stripTerminalSequences(block.render(60).join("\n"))).toContain("after.ts ready");
	});
});
