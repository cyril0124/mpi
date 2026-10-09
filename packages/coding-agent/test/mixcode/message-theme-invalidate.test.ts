import type { AssistantMessage } from "@earendil-works/pi-ai";
import { Container } from "@earendil-works/pi-tui";
import { describe, expect, it } from "vitest";
import { AssistantMessageComponent } from "../../src/modes/interactive/components/assistant-message.ts";
import { UserMessageComponent } from "../../src/modes/interactive/components/user-message.ts";
import { InteractiveMode } from "../../src/modes/interactive/interactive-mode.ts";
import {
	getMarkdownTheme,
	initTheme,
	loadThemeFromPath,
	setThemeInstance,
} from "../../src/modes/interactive/theme/theme.ts";
import { loadAllHighlightLanguages, supportsLanguage } from "../../src/utils/syntax-highlight.ts";

const THEME_DIR = new URL("../../src/modes/interactive/theme/", import.meta.url).pathname;

/** Returns the SGR color sequence immediately before the inline code span in rendered lines. */
function codeColor(lines: string[]): string {
	const match = lines.join("\n").match(/(\u001b\[[0-9;]*m)world/);
	expect(match).not.toBeNull();
	return match![1]!;
}

function message(): UserMessageComponent {
	// Inline code is used here because the surrounding box resamples its background on every
	// render, which would mask a stale Markdown cache. The inline code span retains whatever
	// color the Markdown body produced when it last rendered.
	return new UserMessageComponent("hello `world`", getMarkdownTheme(), 1, [], undefined, "both");
}

describe("message block theme invalidation", () => {
	it("recolours memoized markdown after a theme switch", () => {
		initTheme("dark");
		const component = message();
		const darkColor = codeColor(component.render(40));

		setThemeInstance(loadThemeFromPath(`${THEME_DIR}light.json`));
		// A fresh component in the new theme is the reference: its Markdown cache is cold.
		const freshColor = codeColor(message().render(40));
		expect(freshColor).not.toBe(darkColor);

		component.invalidate();
		expect(codeColor(component.render(40))).toBe(freshColor);
	});

	it("keeps identical output when the theme did not change", () => {
		initTheme("dark");
		const component = message();
		const before = component.render(40);
		component.invalidate();
		expect(component.render(40)).toEqual(before);
	});
});

/** Returns the SGR color sequence immediately before the deleted line of a fenced diff block. */
function deletionColor(lines: string[]): string {
	const match = lines.join("\n").match(/(\u001b\[[0-9;]*m)-removed/);
	expect(match).not.toBeNull();
	return match![1]!;
}

function assistantMessageBlock(markdown: string): AssistantMessageComponent {
	const message: AssistantMessage = {
		role: "assistant",
		content: [{ type: "text", text: markdown }],
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
	return new AssistantMessageComponent(message, false);
}

describe("message block grammar invalidation", () => {
	it("re-highlights memoized markdown once the deferred grammars load", async () => {
		initTheme("dark");
		// The diff grammar is deferred, so blocks painted during startup hold plain rows.
		expect(supportsLanguage("diff")).toBe(false);
		const markdown = "```diff\n--- a/x\n+++ b/x\n@@ -1 +1 @@\n-removed\n+added\n```";
		const block = assistantMessageBlock(markdown);
		const parkedBlock = assistantMessageBlock(markdown);
		const chat = new Container();
		chat.addChild(block);
		const plainColor = deletionColor(block.render(60));
		expect(deletionColor(parkedBlock.render(60))).toBe(plainColor);
		const parkedChat = new Container();
		parkedChat.addChild(parkedBlock);
		const host = {
			chatContainer: parkedChat,
			loadedResourcesContainer: new Container(),
			// The fixture carries no compaction notice, so parking a transcript clears nothing.
			clearCompactionHistoryNotice: () => {},
			runtimeHost: { session: { sessionManager: { getBranch: () => [] }, isStreaming: false } },
		};
		const captureTranscript = Reflect.get(InteractiveMode.prototype, "captureTranscript") as (
			this: typeof host,
			tabId: string,
		) => void;
		captureTranscript.call(host, "tab");
		host.chatContainer = chat;

		await loadAllHighlightLanguages();

		// A cold block is the reference: it paints with the grammars already registered.
		const freshLines = assistantMessageBlock(markdown).render(60);
		expect(deletionColor(freshLines)).not.toBe(plainColor);

		// A plain invalidation keeps the rows the block's children memoized.
		block.invalidate();
		expect(deletionColor(block.render(60))).toBe(plainColor);

		// The startup flush drops them in the chat and in a parked tab, so the next paint matches
		// a cold block. It is private, so drive it against the fields the app provides.
		const flushTranscriptRenderCaches = Reflect.get(InteractiveMode.prototype, "flushTranscriptRenderCaches") as (
			this: typeof host,
		) => void;
		flushTranscriptRenderCaches.call(host);
		expect(block.render(60)).toEqual(freshLines);
		expect(parkedBlock.render(60)).toEqual(freshLines);
	});
});
