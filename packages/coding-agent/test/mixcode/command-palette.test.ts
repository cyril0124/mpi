import { fuzzyFilter, setKeybindings, stripTerminalSequences, type TUI, TuiMainScreen } from "@earendil-works/pi-tui";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { defaultEditorTheme } from "../../../tui/test/test-themes.ts";
import { VirtualTerminal } from "../../../tui/test/virtual-terminal.ts";
import { KeybindingsManager } from "../../src/core/keybindings.ts";
import { BUILTIN_SLASH_COMMANDS } from "../../src/core/slash-commands.ts";
import { CustomEditor } from "../../src/modes/interactive/components/custom-editor.ts";
import {
	CommandPaletteComponent,
	type CommandPaletteEntry,
} from "../../src/modes/interactive/components/mixcode/command-palette/command-palette.ts";
import { QuitConfirmComponent } from "../../src/modes/interactive/components/mixcode/quit-confirm/quit-confirm.ts";
import { InteractiveMode } from "../../src/modes/interactive/interactive-mode.ts";
import { initTheme, theme } from "../../src/modes/interactive/theme/theme.ts";

/**
 * The command palette and the quit confirmation, driven the way the terminal
 * drives them: real key bytes into the focused overlay, asserted on the rendered
 * screen. Several tests call the InteractiveMode methods that wire them, so a change
 * in those methods (which commands are offered, how the overlay is asked for)
 * fails here too.
 */

/** The overlay the palette is shown with; the quit panel uses its own width. */
const PALETTE_OVERLAY = { anchor: "center", width: "78%", maxHeight: "80%", margin: 1 } as const;

beforeEach(() => {
	initTheme("dark");
	setKeybindings(new KeybindingsManager());
});

afterEach(() => {
	setKeybindings(new KeybindingsManager());
});

/** Row budget the palette is given here: 5 visible rows plus its 7 chrome rows. The app sizes it from the terminal. */
const ROW_BUDGET = 12;

/** The style the palette paints matched characters in. */
const highlight = (character: string) => theme.bg("searchMatchBg", theme.fg("searchMatchText", character));

/** Entries whose descriptions mention a query their names must not match. */
const ENTRIES: CommandPaletteEntry[] = [
	{ name: "model", description: "Choose the trace model" },
	{ name: "new", description: "Start a new session" },
	{ name: "tree", description: "Navigate the session tree" },
	{ name: "quit", description: "Quit pi" },
];

function plain(lines: string[]): string {
	// Colors are asserted nowhere here; only which rows and marker are on screen.
	return lines.map((line) => stripTerminalSequences(line)).join("\n");
}

/** Pointer event for the palette's own hit testing. */
function mouse(type: "move" | "press" | "click") {
	return {
		type,
		button: type === "move" ? ("none" as const) : ("left" as const),
		x: 5,
		y: 4,
		screenX: 5,
		screenY: 4,
		width: 80,
		height: 24,
		shift: false,
		alt: false,
		ctrl: false,
	};
}

/** Show a component the way the app does, and wait for it to paint. */
async function mountOverlay(component: CommandPaletteComponent): Promise<{
	terminal: VirtualTerminal;
	ui: TUI;
	screen: () => string;
}> {
	const terminal = new VirtualTerminal(80, 24);
	const ui = new TuiMainScreen(terminal);
	ui.start();
	ui.showOverlay(component, PALETTE_OVERLAY);
	await terminal.waitForRender();
	return { terminal, ui, screen: () => plain(terminal.getViewport()) };
}

describe("command palette", () => {
	it("floats over the draft in a framed panel and filters on the name only", async () => {
		const runs: string[] = [];
		const palette = new CommandPaletteComponent(
			ENTRIES,
			ROW_BUDGET,
			(name) => runs.push(name),
			() => {},
		);
		const { terminal, ui, screen } = await mountOverlay(palette);
		try {
			const screenLines = screen().split("\n");
			const frame = plain(palette.render(80)).split("\n");
			expect(frame[0]).toContain("┌");
			expect(frame[0]).toContain("Command Palette");
			expect(frame.at(-1)!.startsWith("└")).toBe(true);
			// What the terminal paints is that panel: 78% of 80 columns, floating.
			const panelLine = (marker: string) =>
				screenLines
					.find((line) => line.includes(marker))!
					.trimEnd()
					.replace(/^\s*/, "");
			expect(panelLine("┌")).toContain("Command Palette");
			expect(panelLine("┌").length).toBe(62);
			expect(panelLine("└").length).toBe(62);
			for (const entry of ENTRIES) expect(screen()).toContain(`/${entry.name}`);
			// The first row carries the selection marker.
			expect(screen()).toContain("→ /model");

			// "tr" is a subsequence of /model's description but not of its name.
			terminal.sendInput("t");
			terminal.sendInput("r");
			await terminal.waitForRender();
			expect(screen()).toContain("/tree");
			expect(screen()).not.toContain("/model");
			expect(screen()).not.toContain("/quit");

			// Backspace drops one character of the query at a time.
			terminal.sendInput("\x7f");
			await terminal.waitForRender();
			expect(screen()).toContain("/tree");
			expect(screen()).not.toContain("/model");
			terminal.sendInput("\x7f");
			await terminal.waitForRender();
			expect(screen()).toContain("/model");

			// Enter runs the highlighted row of the filtered list and leaves the
			// query text in place.
			terminal.sendInput("t");
			terminal.sendInput("r");
			await terminal.waitForRender();
			terminal.sendInput("\r");
			await terminal.waitForRender();
			expect(runs).toEqual(["tree"]);
		} finally {
			ui.stop();
		}
	});

	it("moves the highlight with the arrows and closes on escape", async () => {
		const runs: string[] = [];
		let cancels = 0;
		const palette = new CommandPaletteComponent(
			ENTRIES,
			ROW_BUDGET,
			(name) => runs.push(name),
			() => cancels++,
		);
		const { terminal, ui, screen } = await mountOverlay(palette);
		try {
			terminal.sendInput("\x1b[B");
			await terminal.waitForRender();
			expect(screen()).toContain("→ /new");
			expect(screen()).not.toContain("→ /model");

			// Moving the highlight must not type into the query.
			terminal.sendInput("\r");
			await terminal.waitForRender();
			expect(runs).toEqual(["new"]);

			terminal.sendInput("\x1b");
			await terminal.waitForRender();
			expect(cancels).toBe(1);
		} finally {
			ui.stop();
		}
	});

	it("shows a placeholder when nothing matches and runs nothing on enter", async () => {
		const runs: string[] = [];
		const palette = new CommandPaletteComponent(
			ENTRIES,
			ROW_BUDGET,
			(name) => runs.push(name),
			() => {},
		);
		const { terminal, ui, screen } = await mountOverlay(palette);
		try {
			for (const character of "zzz") terminal.sendInput(character);
			await terminal.waitForRender();
			expect(screen()).toContain("No matching commands");
			expect(screen()).not.toContain("/model");

			terminal.sendInput("\r");
			await terminal.waitForRender();
			expect(runs).toEqual([]);
		} finally {
			ui.stop();
		}
	});

	it("paints the row under the pointer without moving the selection or accepting it", () => {
		const runs: string[] = [];
		const palette = new CommandPaletteComponent(
			ENTRIES,
			ROW_BUDGET,
			(name) => runs.push(name),
			() => {},
		);
		const rows = () => palette.render(80);
		// The match highlight shares the selected background color, so the cue is
		// identified by its underline.
		const cue = "\x1b[4m";

		// Entry rows start below the frame, the search row and the separator; a row
		// only becomes a hover target once the palette has painted it.
		rows();
		expect(palette.handleMouse({ ...mouse("move"), x: 5, y: 4 })).toEqual({ handled: true, render: true });
		expect(palette.handleMouse({ ...mouse("move"), x: 5, y: 4 })).toEqual({ handled: true, render: false });
		const painted = rows();
		expect(plain(painted)).toContain("→ /model");
		expect(painted[4]).toContain(cue);
		expect(painted[3]).not.toContain(cue);
		expect(runs).toEqual([]);

		// Filtering replaces the rows, so the cue cannot follow the row index.
		palette.handleInput("t");
		expect(rows().join("\n")).not.toContain(cue);

		// A click after hovering still accepts the row under the pointer.
		palette.handleInput("\x7f");
		palette.handleMouse({ ...mouse("press"), x: 5, y: 4 });
		palette.handleMouse({ ...mouse("click"), x: 5, y: 4 });
		expect(runs).toEqual(["new"]);
	});

	it("paints the characters the query matched", () => {
		const palette = new CommandPaletteComponent(
			[{ name: "tree", description: "Navigate the session tree" }],
			ROW_BUDGET,
			() => {},
			() => {},
		);
		expect(palette.render(80).join("\n")).not.toContain(highlight("t"));

		palette.handleInput("t");
		palette.handleInput("r");

		const rendered = palette.render(80).join("\n");
		expect(rendered).toContain(highlight("t"));
		expect(rendered).toContain(highlight("r"));
	});

	it("does not open while the editor's command popup owns the keyboard", () => {
		let opened = 0;
		const prototype = InteractiveMode.prototype as unknown as {
			handlePaletteShortcut(this: unknown): void;
		};
		for (const [showingAutocomplete, expected] of [
			[true, 0],
			[false, 1],
		] as const) {
			const context = Object.assign(Object.create(InteractiveMode.prototype), {
				editor: { isShowingAutocomplete: () => showingAutocomplete },
				showCommandPalette: () => opened++,
			});
			prototype.handlePaletteShortcut.call(context);
			expect(opened).toBe(expected);
		}
	});

	it("paints a transposed token the same way the list matches it", () => {
		const entry = { name: "gpt-4", description: "x" };
		// The list keeps a row for a digits/letters swap, so the row has to show why.
		expect(fuzzyFilter([entry], "4gpt", (item) => `/${item.name}`)).toEqual([entry]);
		const palette = new CommandPaletteComponent(
			[entry],
			ROW_BUDGET,
			() => {},
			() => {},
		);
		for (const character of "4gpt") palette.handleInput(character);

		const rendered = palette.render(80).join("\n");
		for (const character of "gpt4") expect(rendered).toContain(highlight(character));
		expect(rendered).not.toContain(highlight("/"));
		expect(rendered).not.toContain(highlight("-"));
	});

	it("offers every collected command except itself and submits through the editor", async () => {
		const submitted: string[] = [];
		const editorText: string[] = [];
		let draft = "keep me";
		let seenByCommand: string | undefined;
		let shown: CommandPaletteComponent | undefined;
		let overlayOptions: unknown;
		let hidden = false;
		const context = Object.assign(Object.create(InteractiveMode.prototype), {
			skillCommands: new Map<string, string>(),
			ui: {
				terminal: { rows: 24 },
				showOverlay: (component: CommandPaletteComponent, options: unknown) => {
					shown = component;
					overlayOptions = options;
					return {
						hide: () => {
							hidden = true;
						},
					};
				},
			},
			editor: {
				getText: () => draft,
				setText: (text: string) => {
					editorText.push(text);
					draft = text;
				},
			},
			defaultEditor: {
				onSubmit: async (text: string) => {
					submitted.push(text);
					seenByCommand = draft;
					// Command branches consume the editor's text.
					draft = "";
				},
			},
			showError: (message: string) => {
				throw new Error(message);
			},
		});
		// `session` and `settingsManager` are getter-only on the real prototype.
		Object.defineProperty(context, "session", {
			value: {
				scopedModels: [],
				modelRuntime: { getAvailableSnapshot: () => [] },
				getAvailableThinkingLevels: () => [],
				promptTemplates: [],
				extensionRunner: { getRegisteredCommands: () => [] },
				resourceLoader: { getSkills: () => ({ skills: [] }) },
			},
		});
		Object.defineProperty(context, "settingsManager", { value: { getEnableSkillCommands: () => false } });
		const prototype = InteractiveMode.prototype as unknown as {
			showCommandPalette(this: unknown): void;
		};

		prototype.showCommandPalette.call(context);

		expect(overlayOptions).toEqual(PALETTE_OVERLAY);
		expect(shown).toBeDefined();
		const rendered = plain(shown!.render(80));
		expect(rendered).toContain("/model");
		expect(rendered).toContain("/tree");
		// The list is clipped by the row budget, so this only proves the window is bounded.
		expect(rendered).toContain("(1/");

		// Enter runs whatever the list leads with, through the editor submit path, and
		// takes the overlay down with it. The command sees its own text, and the draft
		// that was in the editor comes back once the command is done with it.
		const first = BUILTIN_SLASH_COMMANDS.filter((command) => command.name !== "palette")[0]!;
		shown!.handleInput("\r");
		await Promise.resolve();
		expect(submitted).toEqual([`/${first.name}`]);
		expect(seenByCommand).toBe(`/${first.name}`);
		expect(editorText).toEqual([`/${first.name}`, "keep me"]);
		expect(hidden).toBe(true);

		// A query only the palette command could match finds nothing: it never lists itself.
		for (const character of "pal") shown!.handleInput(character);
		expect(plain(shown!.render(80))).toContain("No matching commands");
	});

	it("gives the draft back when the command fails", async () => {
		let draft = "keep me";
		const shownErrors: string[] = [];
		const context = Object.assign(Object.create(InteractiveMode.prototype), {
			ui: {
				showOverlay: () => ({ hide: () => {} }),
			},
			editor: {
				getText: () => draft,
				setText: (text: string) => {
					draft = text;
				},
			},
			defaultEditor: {
				onSubmit: async () => {
					draft = "";
					throw new Error("Missing argument");
				},
			},
			showError: (message: string) => shownErrors.push(message),
		});
		const prototype = InteractiveMode.prototype as unknown as {
			runCommandFromPalette(this: unknown, name: string): void;
		};

		prototype.runCommandFromPalette.call(context, "settings");
		await Promise.resolve();

		expect(shownErrors).toEqual(["Missing argument"]);
		expect(draft).toBe("keep me");
	});

	it("gives the draft back when the command leaves it alone", async () => {
		let draft = "keep me";
		const context = Object.assign(Object.create(InteractiveMode.prototype), {
			ui: { showOverlay: () => ({ hide: () => {} }) },
			editor: {
				getText: () => draft,
				setText: (text: string) => {
					draft = text;
				},
			},
			// An extension command or a prompt template submits without clearing the editor.
			defaultEditor: { onSubmit: async () => {} },
			showError: () => {},
		});
		const prototype = InteractiveMode.prototype as unknown as {
			runCommandFromPalette(this: unknown, name: string): void;
		};

		prototype.runCommandFromPalette.call(context, "my-template");
		await Promise.resolve();

		expect(draft).toBe("keep me");
	});
});

describe("quit confirmation", () => {
	/** Call the real InteractiveMode method against a real TUI and a stubbed quit. */
	async function openQuitPanel(options: {
		shutdown: () => void;
	}): Promise<{ terminal: VirtualTerminal; ui: TUI; screen: () => string }> {
		const terminal = new VirtualTerminal(80, 24);
		const ui = new TuiMainScreen(terminal);
		const context = Object.assign(Object.create(InteractiveMode.prototype), {
			ui,
			shutdown: options.shutdown,
		});
		const prototype = InteractiveMode.prototype as unknown as {
			showQuitConfirm(this: unknown): void;
		};
		ui.start();
		prototype.showQuitConfirm.call(context);
		await terminal.waitForRender();
		return { terminal, ui, screen: () => plain(terminal.getViewport()) };
	}

	it("asks first, in a framed panel, and quits only on y", async () => {
		let shutdowns = 0;
		const { terminal, ui, screen } = await openQuitPanel({ shutdown: () => shutdowns++ });
		try {
			const screenLines = screen().split("\n");
			const panelLine = (marker: string) =>
				screenLines
					.find((line) => line.includes(marker))!
					.trimEnd()
					.replace(/^\s*/, "");
			expect(panelLine("┌")).toContain("Quit");
			expect(panelLine("┌").length).toBe(72);
			expect(panelLine("└").length).toBe(72);
			const question = panelLine("Are you sure");
			expect(question.startsWith("│")).toBe(true);
			expect(question.endsWith("│")).toBe(true);

			// Anything but y, n and the cancel chord leaves the panel up.
			terminal.sendInput("z");
			await terminal.waitForRender();
			expect(screen()).toContain("Are you sure you want to quit?");
			expect(shutdowns).toBe(0);

			terminal.sendInput("y");
			await terminal.waitForRender();
			expect(shutdowns).toBe(1);
		} finally {
			ui.stop();
		}
	});

	it("asks for a centered 72-column overlay", () => {
		let overlayOptions: unknown;
		const context = Object.assign(Object.create(InteractiveMode.prototype), {
			ui: {
				showOverlay: (_component: unknown, options: unknown) => {
					overlayOptions = options;
					return { hide: () => {} };
				},
			},
			shutdown: () => {},
		});
		const prototype = InteractiveMode.prototype as unknown as {
			showQuitConfirm(this: unknown): void;
		};

		prototype.showQuitConfirm.call(context);

		expect(overlayOptions).toEqual({ anchor: "center", width: 72, margin: 1 });
	});

	it("cancels on n and on escape without quitting", async () => {
		for (const cancelKey of ["n", "\x1b"]) {
			let shutdowns = 0;
			const { terminal, ui, screen } = await openQuitPanel({ shutdown: () => shutdowns++ });
			try {
				terminal.sendInput(cancelKey);
				await terminal.waitForRender();
				expect(screen()).not.toContain("Are you sure you want to quit?");
				expect(shutdowns).toBe(0);
			} finally {
				ui.stop();
			}
		}
	});

	it("ignores keys it does not own", () => {
		let confirmed = 0;
		let cancelled = 0;
		const quitPanel = new QuitConfirmComponent(
			() => confirmed++,
			() => cancelled++,
		);
		quitPanel.handleInput("x");
		quitPanel.handleInput("\x1b[1;5C");
		expect([confirmed, cancelled]).toEqual([0, 0]);
		quitPanel.handleInput("n");
		expect(cancelled).toBe(1);
	});
});

describe("palette and quit chords", () => {
	it("routes ctrl+p to the palette and ctrl+q to the quit panel, never to the exit key", () => {
		const keybindings = new KeybindingsManager({ "app.palette": "ctrl+p", "app.quit": "ctrl+q" });
		setKeybindings(keybindings);
		const editor = new CustomEditor(new TuiMainScreen(new VirtualTerminal()), defaultEditorTheme, keybindings);
		let palette = 0;
		let quit = 0;
		let exit = 0;
		editor.onAction("app.palette", () => palette++);
		editor.onAction("app.quit", () => quit++);
		editor.onCtrlD = () => exit++;

		editor.handleInput("\x10"); // ctrl+p
		editor.handleInput("\x11"); // ctrl+q
		editor.handleInput("\x04"); // ctrl+d

		expect([palette, quit, exit]).toEqual([1, 1, 1]);
	});
});
