import type { AssistantMessage } from "@earendil-works/pi-ai";
import { stripTerminalSequences, type TUI, type TuiMouseEvent, type TuiMouseEventType } from "@earendil-works/pi-tui";
import { beforeEach, describe, expect, it } from "vitest";
import { AssistantMessageComponent } from "../../src/modes/interactive/components/assistant-message.ts";
import { ToolExecutionComponent } from "../../src/modes/interactive/components/tool-execution.ts";
import { initTheme } from "../../src/modes/interactive/theme/theme.ts";
import { hoverBackgroundOpen } from "./test-utils.ts";

/**
 * A passive move over a message block paints the pointer cue, and the cue clears
 * when the pointer leaves, even though the block's card render is memoized.
 */

beforeEach(() => {
	initTheme("dark");
});

function fakeTui(): TUI {
	return { requestRender: () => {} } as unknown as TUI;
}

function move(x: number, y: number, width: number, height: number): TuiMouseEvent {
	return {
		type: "move" as TuiMouseEventType,
		button: "none",
		x,
		y,
		screenX: x,
		screenY: y,
		width,
		height,
		shift: false,
		alt: false,
		ctrl: false,
	};
}

function readToolComponent(): ToolExecutionComponent {
	return new ToolExecutionComponent(
		"read",
		"tool-hover",
		{ file_path: "README.md" },
		{},
		undefined,
		fakeTui(),
		process.cwd(),
	);
}

function assistantThinkingComponent(): AssistantMessageComponent {
	const message: AssistantMessage = {
		role: "assistant",
		content: [{ type: "thinking", thinking: "private reasoning" }],
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

describe("message block hover across a memoized render", () => {
	it("paints the cue after a move even though the card render is memoized", () => {
		const component = readToolComponent();
		const width = 80;
		const plainLines = component.render(width);
		expect(plainLines.length).toBeGreaterThan(1);
		expect(plainLines.join("\n")).not.toContain(hoverBackgroundOpen());

		// A passive move over the card asks for a repaint.
		const result = component.handleMouse(move(0, 1, width, plainLines.length));
		expect(result?.render).toBe(true);

		const hovered = component.render(width);
		expect(hovered.join("\n")).toContain(hoverBackgroundOpen());
	});

	it("drops the cue again when the pointer leaves", () => {
		const component = readToolComponent();
		const width = 80;
		const height = component.render(width).length;

		component.handleMouse(move(0, 1, width, height));
		expect(component.render(width).join("\n")).toContain(hoverBackgroundOpen());

		component.handleMouse(move(-1, -1, width, height));
		expect(component.render(width).join("\n")).not.toContain(hoverBackgroundOpen());
	});

	it("paints a memoized assistant block's thinking region while hovered", () => {
		const component = assistantThinkingComponent();
		const width = 60;
		const lines = component.render(width);
		const thinkingRow = lines.findIndex((line) => stripTerminalSequences(line).includes("private reasoning"));
		expect(thinkingRow).toBeGreaterThanOrEqual(0);

		const result = component.handleMouse(move(2, thinkingRow, width, lines.length));
		expect(result?.render).toBe(true);
		expect(component.render(width).join("\n")).toContain(hoverBackgroundOpen());
	});
});
