/**
 * The typed-word confirmation panels behind `/delete-all-sessions` and
 * `/close-all-sessions`, driven the way the terminal drives them: real key
 * bytes into the focused overlay, asserted on the rendered screen. Typing the
 * word is the only way to confirm, so a stray `y`, Enter or arrow key can
 * never delete every tab's session file or close every other tab.
 */
import { setKeybindings, stripTerminalSequences, type TUI, TuiMainScreen } from "@earendil-works/pi-tui";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { VirtualTerminal } from "../../../tui/test/virtual-terminal.ts";
import { KeybindingsManager } from "../../src/core/keybindings.ts";
import {
	TypedWordConfirmComponent,
	type TypedWordConfirmOptions,
} from "../../src/modes/interactive/components/mixcode/typed-word-confirm/typed-word-confirm.ts";
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

/** One panel's wiring: which InteractiveMode method opens it and what it renders. */
interface PanelSpec {
	/** Open the panel through the InteractiveMode method that wires it. */
	open(totalTabs: number): Promise<boolean>;
	title: string;
	word: string;
	/** How the panel names the count it was given, at count 3 and at count 1. */
	pluralBody: string;
	singularBody: string;
}

/** Overlay width, the one the quit panel uses. */
const WIDTH = 72;

const PANELS: Record<"delete" | "close", PanelSpec> = {
	delete: {
		open: (
			InteractiveMode.prototype as unknown as {
				showDeleteAllSessionsConfirm: (this: unknown, totalTabs: number) => Promise<boolean>;
			}
		).showDeleteAllSessionsConfirm,
		title: "Delete all sessions",
		word: "delete",
		pluralBody: "Delete the session files of all 3 open tabs",
		singularBody: "Delete the session files of all 1 open tab",
	},
	close: {
		open: (
			InteractiveMode.prototype as unknown as {
				showCloseAllSessionsConfirm: (this: unknown, otherTabs: number) => Promise<boolean>;
			}
		).showCloseAllSessionsConfirm,
		title: "Close all sessions",
		word: "close",
		pluralBody: "Close 3 other open tabs?",
		singularBody: "Close 1 other open tab?",
	},
};

async function openPanel(
	kind: "delete" | "close",
	totalTabs: number,
): Promise<{
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
	const answer = PANELS[kind].open.call(context, totalTabs);
	await terminal.waitForRender();
	return { terminal, ui, screen: () => plain(terminal.getViewport()), answer };
}

describe.each(["delete", "close"] as const)("typed-word confirmation (%s)", (kind) => {
	const spec = PANELS[kind];
	const typedLine = () => `Type ${spec.word.toUpperCase()} to confirm: `;

	it("shows the tab count and confirms only on the typed word", async () => {
		const { terminal, ui, screen, answer } = await openPanel(kind, 3);
		try {
			const panel = overlayPanelLine(screen().split("\n"), "┌");
			expect(panel).toContain(spec.title);
			expect(panel.length).toBe(WIDTH);
			expect(screen()).toContain(spec.pluralBody);
			expect(screen()).toContain(typedLine());

			// Enter, `y` and arrows are not confirmations, and no key is part of the word yet.
			for (const key of ["\r", "y", "Y", "\x1b[B", "\x1b[1;5C"]) {
				terminal.sendInput(key);
				await terminal.waitForRender();
			}
			expect(screen()).toContain(typedLine());

			// Only a prefix of the word moves the input, so a stray or out-of-order letter cannot.
			const stray = spec.word.slice(1, 3);
			for (const letter of stray) {
				terminal.sendInput(letter);
				await terminal.waitForRender();
			}
			expect(screen()).toContain(typedLine());

			for (const letter of spec.word.slice(0, 3)) {
				terminal.sendInput(letter);
				await terminal.waitForRender();
			}
			expect(screen()).toContain(`Type ${spec.word.toUpperCase()} to confirm: ${spec.word.slice(0, 3)}`);

			for (let press = 0; press < 2; press++) {
				terminal.sendInput("\x7f");
				await terminal.waitForRender();
			}
			expect(screen()).toContain(`Type ${spec.word.toUpperCase()} to confirm: ${spec.word.slice(0, 1)}`);

			// The word itself confirms, on its last letters.
			terminal.sendInput(spec.word.slice(1));
			await terminal.waitForRender();
			expect(screen()).not.toContain(typedLine());
			await expect(answer).resolves.toBe(true);
		} finally {
			ui.stop();
		}
	});

	it("renders the singular body for a single tab", async () => {
		const { ui, screen } = await openPanel(kind, 1);
		try {
			expect(screen()).toContain(spec.singularBody);
		} finally {
			ui.stop();
		}
	});

	it("takes the whole word as one injected chunk", async () => {
		const { terminal, ui, screen, answer } = await openPanel(kind, 2);
		try {
			// `mpi ctl send-keys <word>` sends the letters as one chunk, not six keypresses.
			terminal.sendInput(spec.word);
			await terminal.waitForRender();
			expect(screen()).not.toContain(typedLine());
			await expect(answer).resolves.toBe(true);
		} finally {
			ui.stop();
		}
	});

	it("ignores a bracketed paste, the shape a real paste arrives in", async () => {
		const { terminal, ui, screen } = await openPanel(kind, 2);
		try {
			terminal.sendInput(`\x1b[200~${spec.word}\x1b[201~`);
			await terminal.waitForRender();
			expect(screen()).toContain(typedLine());
		} finally {
			ui.stop();
		}
	});

	it("cancels on n and on escape", async () => {
		for (const cancelKey of ["n", "\x1b"]) {
			const { terminal, ui, screen, answer } = await openPanel(kind, 2);
			try {
				terminal.sendInput(cancelKey);
				await terminal.waitForRender();
				expect(screen()).not.toContain(typedLine());
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

		void spec.open.call(context, 2);

		expect(overlayOptions).toEqual({ anchor: "center", width: WIDTH, margin: 1 });
	});
});

describe("typed-word confirmation component", () => {
	it("ignores keys it does not own", () => {
		let confirmed = 0;
		let cancelled = 0;
		const options: TypedWordConfirmOptions = {
			title: "Close all sessions",
			word: "close",
			body: ["Close 1 other open tab?"],
			onConfirm: () => confirmed++,
			onCancel: () => cancelled++,
		};
		const panel = new TypedWordConfirmComponent(options);
		for (const key of ["z", "\r", "\x1b[B", "\x1b[1;5C", "c\x1b"]) panel.handleInput(key);
		expect([confirmed, cancelled]).toEqual([0, 0]);
		panel.handleInput("close");
		expect(confirmed).toBe(1);
		panel.handleInput("n");
		expect(cancelled).toBe(1);
	});
});
