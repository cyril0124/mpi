/**
 * The `/delete-all-sessions` confirmation panel, driven the way the terminal
 * drives it: real key bytes into the focused overlay, asserted on the rendered
 * screen. Typing the word is the only way to confirm, so a stray `y`, Enter or
 * arrow key can never delete every tab's session file.
 */
import { setKeybindings, stripTerminalSequences, type TUI, TuiMainScreen } from "@earendil-works/pi-tui";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { VirtualTerminal } from "../../../tui/test/virtual-terminal.ts";
import { KeybindingsManager } from "../../src/core/keybindings.ts";
import {
	DELETE_ALL_SESSIONS_CONFIRM_TITLE,
	DELETE_ALL_SESSIONS_CONFIRM_WIDTH,
	DELETE_ALL_SESSIONS_CONFIRM_WORD,
	DeleteAllSessionsConfirmComponent,
} from "../../src/modes/interactive/components/mixcode/delete-all-sessions-confirm/delete-all-sessions-confirm.ts";
import { InteractiveMode } from "../../src/modes/interactive/interactive-mode.ts";
import { initTheme } from "../../src/modes/interactive/theme/theme.ts";
import { overlayPanelLine } from "./test-utils.ts";

beforeEach(() => {
	initTheme("dark");
	setKeybindings(new KeybindingsManager());
});

afterEach(() => {
	setKeybindings(new KeybindingsManager());
});

function plain(lines: string[]): string {
	return lines.map((line) => stripTerminalSequences(line)).join("\n");
}

/** The panel method, called without constructing a full InteractiveMode. */
const showPanel = (
	InteractiveMode.prototype as unknown as {
		showDeleteAllSessionsConfirm: (this: unknown, totalTabs: number) => Promise<boolean>;
	}
).showDeleteAllSessionsConfirm;

describe("delete all sessions confirmation", () => {
	/** Open the real panel through the InteractiveMode method that wires it. */
	async function openPanel(totalTabs: number): Promise<{
		terminal: VirtualTerminal;
		ui: TUI;
		screen: () => string;
		answer: Promise<boolean>;
	}> {
		const terminal = new VirtualTerminal(80, 24);
		const ui = new TuiMainScreen(terminal);
		const context = Object.assign(Object.create(InteractiveMode.prototype), {
			ui,
			programStatus: { setBlocked: () => {} },
		});
		ui.start();
		const answer = showPanel.call(context, totalTabs);
		await terminal.waitForRender();
		return { terminal, ui, screen: () => plain(terminal.getViewport()), answer };
	}

	it("shows the tab count and confirms only on the typed word", async () => {
		const { terminal, ui, screen, answer } = await openPanel(3);
		try {
			const panel = overlayPanelLine(screen().split("\n"), "┌");
			expect(panel).toContain(DELETE_ALL_SESSIONS_CONFIRM_TITLE);
			expect(panel.length).toBe(DELETE_ALL_SESSIONS_CONFIRM_WIDTH);
			expect(screen()).toContain("Delete the session files of all 3 open tabs");
			expect(screen()).toContain("Type DELETE to confirm: ");

			// Enter, `y` and arrows are not confirmations, and no key is part of the word yet.
			for (const key of ["\r", "y", "Y", "\x1b[B", "\x1b[1;5C"]) {
				terminal.sendInput(key);
				await terminal.waitForRender();
			}
			expect(screen()).toContain("Type DELETE to confirm: ");

			// Only a prefix of the word moves the input, so a stray or out-of-order letter cannot.
			for (const letter of ["e", "l"]) {
				terminal.sendInput(letter);
				await terminal.waitForRender();
			}
			expect(screen()).toContain("Type DELETE to confirm: ");

			for (const letter of "del") {
				terminal.sendInput(letter);
				await terminal.waitForRender();
			}
			expect(screen()).toContain("Type DELETE to confirm: del");

			for (let press = 0; press < 2; press++) {
				terminal.sendInput("\x7f");
				await terminal.waitForRender();
			}
			expect(screen()).toContain("Type DELETE to confirm: d");

			// The word itself confirms, on its last letter.
			terminal.sendInput("elete");
			await terminal.waitForRender();
			expect(screen()).not.toContain("Type DELETE to confirm:");
			await expect(answer).resolves.toBe(true);
		} finally {
			ui.stop();
		}
	});

	it("takes the whole word as one injected chunk", async () => {
		const { terminal, ui, screen, answer } = await openPanel(2);
		try {
			// `mpi ctl send-keys delete` sends the letters as one chunk, not six keypresses.
			terminal.sendInput(DELETE_ALL_SESSIONS_CONFIRM_WORD);
			await terminal.waitForRender();
			expect(screen()).not.toContain("Type DELETE to confirm:");
			await expect(answer).resolves.toBe(true);
		} finally {
			ui.stop();
		}
	});

	it("ignores a bracketed paste, the shape a real paste arrives in", async () => {
		const { terminal, ui, screen } = await openPanel(2);
		try {
			terminal.sendInput(`\x1b[200~${DELETE_ALL_SESSIONS_CONFIRM_WORD}\x1b[201~`);
			await terminal.waitForRender();
			expect(screen()).toContain("Type DELETE to confirm: ");
		} finally {
			ui.stop();
		}
	});

	it("cancels on n and on escape", async () => {
		for (const cancelKey of ["n", "\x1b"]) {
			const { terminal, ui, screen, answer } = await openPanel(2);
			try {
				terminal.sendInput(cancelKey);
				await terminal.waitForRender();
				expect(screen()).not.toContain("Type DELETE to confirm:");
				await expect(answer).resolves.toBe(false);
			} finally {
				ui.stop();
			}
		}
	});

	it("asks for a centered panel the width of the quit confirmation", () => {
		let overlayOptions: unknown;
		const context = Object.assign(Object.create(InteractiveMode.prototype), {
			ui: {
				showOverlay: (_component: unknown, options: unknown) => {
					overlayOptions = options;
					return { hide: () => {} };
				},
			},
			programStatus: { setBlocked: () => {} },
		});

		void showPanel.call(context, 2);

		expect(overlayOptions).toEqual({ anchor: "center", width: DELETE_ALL_SESSIONS_CONFIRM_WIDTH, margin: 1 });
	});

	it("ignores keys it does not own", () => {
		let confirmed = 0;
		let cancelled = 0;
		const panel = new DeleteAllSessionsConfirmComponent(
			1,
			() => confirmed++,
			() => cancelled++,
		);
		for (const key of ["z", "\r", "\x1b[B", "\x1b[1;5C", "d\x1b"]) panel.handleInput(key);
		expect([confirmed, cancelled]).toEqual([0, 0]);
		panel.handleInput(DELETE_ALL_SESSIONS_CONFIRM_WORD);
		expect(confirmed).toBe(1);
		panel.handleInput("n");
		expect(cancelled).toBe(1);
	});
});
