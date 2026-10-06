import type { AssistantMessage } from "@earendil-works/pi-ai";
import {
	Container,
	stripTerminalSequences,
	Text,
	type TUI,
	TuiAltScreen,
	type TuiMouseEvent,
	type TuiMouseEventType,
} from "@earendil-works/pi-tui";
import type { Terminal as XtermTerminal } from "@xterm/headless";
import { beforeEach, describe, expect, it } from "vitest";
import { VirtualTerminal } from "../../../tui/test/virtual-terminal.ts";
import { AssistantMessageComponent } from "../../src/modes/interactive/components/assistant-message.ts";
import { ToolExecutionComponent } from "../../src/modes/interactive/components/tool-execution.ts";
import { initTheme, theme } from "../../src/modes/interactive/theme/theme.ts";
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
	it.each([
		{ state: "pending", width: 40 },
		{ state: "success", width: 40 },
		{ state: "error", width: 40 },
		{ state: "pending", width: 80 },
		{ state: "success", width: 80 },
		{ state: "error", width: 80 },
	])("fills every card cell in a $state tool at width $width", async ({ state, width }) => {
		const terminal = new VirtualTerminal(width, 20);
		const tui = new TuiAltScreen(terminal);
		const component = readToolComponent();
		if (state !== "pending") {
			component.updateResult({
				content: [{ type: "text", text: "first paragraph\n\nsecond paragraph" }],
				isError: state === "error",
			});
		}
		const height = component.render(width).length;
		const root = new Container();
		root.addChild(component);
		root.addChild(new Text(theme.bg("selectedBg", "reference"), 0, 0));
		tui.setLayoutRoot(root);
		const xterm = (terminal as unknown as { xterm: XtermTerminal }).xterm;
		const cells = (row: number) => {
			const line = xterm.buffer.active.getLine(row)!;
			return Array.from({ length: width }, (_, column) => {
				const cell = line.getCell(column)!;
				return { bg: cell.getBgColor(), fg: cell.getFgColor() };
			});
		};

		tui.start();
		try {
			await terminal.waitForRender();
			const plain = Array.from({ length: height }, (_, row) => cells(row));
			const expectedBackground = cells(height)[0]!.bg;
			expect(plain[1]![0]!.bg).not.toBe(expectedBackground);
			const text = terminal.getViewport();

			// Hover the upper padding, body, and lower padding through real mouse input.
			for (const row of [1, 2, height - 1]) {
				terminal.sendInput(`\x1b[<35;2;${row + 1}M`);
				await terminal.waitForRender();
				expect(cells(0)).toEqual(plain[0]);
				for (let cardRow = 1; cardRow < height; cardRow++) {
					const painted = cells(cardRow);
					expect(
						painted.map((cell) => cell.bg),
						`card row ${cardRow}`,
					).toEqual(Array(width).fill(expectedBackground));
					expect(painted.map((cell) => cell.fg)).toEqual(plain[cardRow]!.map((cell) => cell.fg));
				}
				expect(terminal.getViewport()).toEqual(text);
			}

			terminal.sendInput(`\x1b[<35;2;${height + 1}M`);
			await terminal.waitForRender();
			expect(Array.from({ length: height }, (_, row) => cells(row))).toEqual(plain);
		} finally {
			tui.stop();
		}
	});

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
