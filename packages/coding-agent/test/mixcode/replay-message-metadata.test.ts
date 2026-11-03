import type { AssistantMessage } from "@earendil-works/pi-ai/compat";
import { Container } from "@earendil-works/pi-tui";
import { describe, expect, test, vi } from "vitest";
import type { MarkdownTransformer } from "../../src/core/extensions/types.ts";
import type { SessionEntry } from "../../src/core/session-manager.ts";
import { formatMessageClock } from "../../src/modes/interactive/components/mixcode/message-clock.ts";
import {
	OVERSIZED_MESSAGE_MAX_LINES,
	UserMessageComponent,
} from "../../src/modes/interactive/components/user-message.ts";
import { InteractiveMode } from "../../src/modes/interactive/interactive-mode.ts";
import { getMarkdownTheme, initTheme } from "../../src/modes/interactive/theme/theme.ts";
import { stripAnsi } from "../../src/utils/ansi.ts";

describe("InteractiveMode replay message metadata", () => {
	test("keeps persisted metadata and send time separate across chunked replay and live continuation", () => {
		initTheme("dark");
		const transform = vi.fn<MarkdownTransformer>((markdown) => markdown);
		const editor = { addToHistory: vi.fn(), setHistory: vi.fn() };
		const chatContainer = new Container();
		const context = Object.setPrototypeOf(
			{
				chatContainer,
				pendingTools: new Map(),
				editor,
				settingsManager: { getShowCacheMissNotices: () => false },
				getMarkdownThemeWithSettings: getMarkdownTheme,
				getMarkdownTransformers: () => [transform],
				mixcodeSettings: { ui: { boxedHiddenThinking: true, showResponseModelNotices: false } },
				hideThinkingBlock: true,
				hiddenThinkingLabel: "",
				outputPad: 1,
				ui: { requestRender: vi.fn() },
			},
			InteractiveMode.prototype,
		) as {
			renderSessionEntries(entries: SessionEntry[]): void;
			startStreamingMessage(message: AssistantMessage): void;
		};
		const sentAt = Date.UTC(2024, 0, 1, 12, 34);
		const entryTimestamp = "2025-01-02T01:02:03Z";
		const assistant: AssistantMessage = {
			role: "assistant",
			content: [
				{ type: "thinking", thinking: "reasoning tail" },
				{ type: "text", text: "retained reply" },
			],
			api: "openai-completions",
			provider: "openai",
			model: "test-model",
			usage: {
				input: 1,
				output: 1,
				cacheRead: 0,
				cacheWrite: 0,
				totalTokens: 2,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
			},
			stopReason: "stop",
			timestamp: sentAt + 1000,
		};
		const entries: SessionEntry[] = [
			{
				type: "message",
				id: "user-entry",
				parentId: null,
				timestamp: entryTimestamp,
				message: {
					role: "user",
					content: Array.from(
						{ length: OVERSIZED_MESSAGE_MAX_LINES + 5 },
						(_, index) => `retained line ${index}`,
					).join("\n"),
					timestamp: sentAt,
				},
			},
			{
				type: "message",
				id: "assistant-entry",
				parentId: "user-entry",
				timestamp: entryTimestamp,
				message: assistant,
			},
		];

		context.renderSessionEntries(entries);
		const rendered = chatContainer.render(100).join("\n");
		const userComponents = chatContainer.children.filter((child) => child instanceof UserMessageComponent);
		expect(userComponents).toHaveLength(2);
		expect(stripAnsi(rendered)).toContain(formatMessageClock(sentAt));
		expect(stripAnsi(rendered)).toContain("retained reply");
		const userOutput = userComponents.flatMap((component) => component.render(100)).join("\n");
		expect(userOutput.split("\x1b]133;A\x07")).toHaveLength(2);
		const userContexts = transform.mock.calls
			.filter(([, meta]) => meta.messageType === "user")
			.map(([, meta]) => meta);
		expect(userContexts.length).toBeGreaterThanOrEqual(2);
		for (const meta of userContexts)
			expect(meta).toMatchObject({ messageId: "user-entry", timestamp: entryTimestamp, isStreaming: false });
		expect(transform.mock.calls).toContainEqual([
			"retained reply",
			expect.objectContaining({ messageId: "assistant-entry", timestamp: entryTimestamp, isStreaming: false }),
		]);

		chatContainer.clear();
		transform.mockClear();
		context.startStreamingMessage(assistant);
		expect(stripAnsi(chatContainer.render(100).join("\n"))).toContain("reasoning tail");
		expect(transform.mock.calls).toContainEqual([
			"retained reply",
			expect.objectContaining({ messageId: undefined, timestamp: undefined, isStreaming: true }),
		]);
		expect(editor.addToHistory).not.toHaveBeenCalled();
		expect(editor.setHistory).not.toHaveBeenCalled();
	});
});
