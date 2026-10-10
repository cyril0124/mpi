import { type Component, Container, ScrollView, Text, type TuiAltScreen, VStack } from "@earendil-works/pi-tui";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderLayoutFrame } from "../../../tui/src/layout.ts";
import { VirtualTerminal } from "../../../tui/test/virtual-terminal.ts";
import { KeybindingsManager } from "../../src/core/keybindings.ts";
import {
	createVimTabState,
	handleVimKey,
	type VimKeyHost,
	type VimTabState,
} from "../../src/core/mixcode/vim/vim-mode.ts";
import { createChatViewport } from "../../src/modes/interactive/chat-viewport.ts";
import { DockWidgetBudget } from "../../src/modes/interactive/components/mixcode/dock-widgets/dock-widgets.ts";
import { WindowedTranscript } from "../../src/modes/interactive/components/mixcode/windowed-chat/windowed-transcript.ts";
import { UserMessageComponent } from "../../src/modes/interactive/components/user-message.ts";
import { createInteractiveTui, InteractiveMode } from "../../src/modes/interactive/interactive-mode.ts";
import { initTheme } from "../../src/modes/interactive/theme/theme.ts";

/**
 * Drives the real vim wiring (`InteractiveMode` private methods) against a real
 * alternate-screen renderer, a real windowed transcript and a real transcript
 * scroll view, so the whole path is exercised: key -> vim module -> controller ->
 * scroll view -> painted rows.
 *
 * The wiring lives on private methods, so they are bound to a stub `this` that
 * carries the live renderer, transcript and tab state.
 */
type VimWiringContext = {
	renderer: ReturnType<typeof createInteractiveTui>;
	transcriptScrollView: ScrollView;
	windowedTranscript: WindowedTranscript;
	tabManager: { getActive: () => { vim: VimTabState } };
	fallbackVimState: VimTabState;
	/** The surface flag the vim entry points consult; Home covers the tab transcript. */
	homeSelection: { active: boolean };
	keybindings: KeybindingsManager;
	ui: { requestRender: () => void };
	editor: { borderColor: unknown };
	showStatus: (message: string) => void;
	updateEditorBorderColor: () => void;
	notifyToast: (type: string, message: string) => void;
	refreshVimChrome: () => void;
	viewportTui: () => TuiAltScreen | undefined;
	createVimHost: () => VimKeyHost;
	vimTabState: () => VimTabState;
	enterActiveTabVimMode: () => void;
	leaveVimModeIfUnavailable: () => void;
	leaveVimMode: () => void;
	afterVimExit: () => void;
	handleVimKeyInput: (data: string) => boolean;
	showUserMessagePreview: (labels: readonly string[], selected: number) => void;
	hideUserMessagePreview: () => void;
	rowsBelowTranscript: () => number;
};

type VimWiringPrototype = {
	createVimHost(this: VimWiringContext): VimKeyHost;
	vimTabState(this: VimWiringContext): VimTabState;
	notifyToast(this: VimWiringContext, type: string, message: string): void;
	refreshVimChrome(this: VimWiringContext): void;
	viewportTui(this: VimWiringContext): TuiAltScreen | undefined;
	enterActiveTabVimMode(this: VimWiringContext): void;
	leaveVimModeIfUnavailable(this: VimWiringContext): void;
	leaveVimMode(this: VimWiringContext): void;
	afterVimExit(this: VimWiringContext): void;
	handleVimKeyInput(this: VimWiringContext, data: string): boolean;
};

const proto = InteractiveMode.prototype as unknown as VimWiringPrototype;

beforeEach(() => {
	initTheme("dark");
});

/** Alternating user and assistant blocks, the way `chatContainer` holds messages. */
function transcriptBlocks(pairs: number): Component[] {
	const blocks: Component[] = [];
	for (let index = 1; index <= pairs; index += 1) {
		blocks.push(new UserMessageComponent(`user-${index}`));
		blocks.push(new Text(`reply-${index}`, 0, 0));
	}
	return blocks;
}

/**
 * The stub `this` the real vim wiring runs against. Callers that need a
 * different renderer mode or transcript pass those in; everything else is shared.
 */
function makeWiringContext(options: {
	renderer: VimWiringContext["renderer"];
	transcript: ScrollView;
	windowedTranscript: WindowedTranscript;
	tab: { vim: VimTabState };
	notices: string[];
	previews: Array<{ labels: readonly string[]; selected: number }>;
	requestRender: () => void;
	homeActive?: boolean;
}): VimWiringContext {
	const context: VimWiringContext = {
		renderer: options.renderer,
		transcriptScrollView: options.transcript,
		windowedTranscript: options.windowedTranscript,
		tabManager: { getActive: () => options.tab },
		fallbackVimState: createVimTabState(),
		homeSelection: { active: options.homeActive ?? false },
		keybindings: new KeybindingsManager(),
		ui: { requestRender: options.requestRender },
		editor: { borderColor: undefined },
		showStatus: () => {},
		updateEditorBorderColor: () => {},
		notifyToast: (type, message) => {
			options.notices.push(`${type} ${message}`);
		},
		refreshVimChrome: () => proto.refreshVimChrome.call(context),
		viewportTui: () => proto.viewportTui.call(context),
		createVimHost: () => proto.createVimHost.call(context),
		vimTabState: () => proto.vimTabState.call(context),
		enterActiveTabVimMode: () => proto.enterActiveTabVimMode.call(context),
		leaveVimModeIfUnavailable: () => proto.leaveVimModeIfUnavailable.call(context),
		leaveVimMode: () => proto.leaveVimMode.call(context),
		afterVimExit: () => proto.afterVimExit.call(context),
		handleVimKeyInput: (data) => proto.handleVimKeyInput.call(context, data),
		// The panel is an overlay on the real renderer; the wiring test records what it
		// would show instead of painting it.
		showUserMessagePreview: (labels, selected) => {
			options.previews.push({ labels, selected });
		},
		hideUserMessagePreview: () => {},
		rowsBelowTranscript: () => 0,
	};
	return context;
}

async function bootFullscreen(columns = 40, rows = 12) {
	const terminal = new VirtualTerminal(columns, rows);
	const tui = createInteractiveTui({
		tuiMode: "fullscreen",
		showHardwareCursor: false,
		logDirectory: "/tmp",
		terminal,
	}) as TuiAltScreen;

	// Blocks stay inside one wrapper per row pair so the windowed container owns the
	// child list, exactly like `chatContainer` does in the running app.
	const blocks = transcriptBlocks(20);
	const windowedTranscript = new WindowedTranscript({ blocks: () => blocks });
	const transcript = new ScrollView(windowedTranscript, { follow: "end", primary: true });
	const root = new VStack([
		{ component: transcript, basis: 0, grow: 1, shrink: 1, minSize: 1 },
		{ component: new Text("dock", 0, 0), basis: "auto", grow: 0, shrink: 0 },
	]);
	tui.setLayoutRoot(root);
	tui.start();
	await terminal.waitForRender();

	const tab = { vim: createVimTabState() };
	const notices: string[] = [];
	const previews: Array<{ labels: readonly string[]; selected: number }> = [];
	const context = makeWiringContext({
		renderer: tui,
		transcript,
		windowedTranscript,
		tab,
		notices,
		previews,
		requestRender: () => tui.requestRender(),
	});

	const painted = async () => {
		tui.requestRender();
		await terminal.waitForRender();
		return terminal.getViewport().map((line) => line.trimEnd());
	};
	const chatRows = async () => (await painted()).filter((line) => /^(user|reply)-\d/.test(line));

	return {
		tui,
		terminal,
		transcript,
		windowedTranscript,
		context,
		tab,
		notices,
		previews,
		painted,
		chatRows,
		stop: () => tui.stop(),
	};
}

describe("vim mode against the real transcript viewport", () => {
	it("enters through /vim, scrolls with j/k, and jumps with gg/G", async () => {
		const app = await bootFullscreen();
		try {
			const bottom = await app.chatRows();
			expect(bottom.at(-1)).toBe("reply-20");
			const bottomScrollTop = app.transcript.scrollTop;

			app.context.enterActiveTabVimMode();
			expect(app.tab.vim.active).toBe(true);
			const host = app.context.createVimHost();

			handleVimKey(app.tab.vim, "k", host);
			handleVimKey(app.tab.vim, "k", host);
			const scrolled = await app.chatRows();
			expect(app.transcript.scrollTop).toBe(bottomScrollTop - 6);
			expect(scrolled.at(-1)).not.toBe(bottom.at(-1));

			handleVimKey(app.tab.vim, "G", host);
			expect(await app.chatRows()).toEqual(bottom);

			handleVimKey(app.tab.vim, "g", host);
			handleVimKey(app.tab.vim, "g", host);
			expect(app.transcript.scrollTop).toBe(0);
			// The alternate screen composites its jump-to-end indicator over the top row.
			expect((await app.chatRows())[0]).toMatch(/^(user|reply)-/);
		} finally {
			app.stop();
		}
	});

	it("pages by the live viewport height and leaves vim mode on q", async () => {
		const app = await bootFullscreen();
		try {
			app.context.enterActiveTabVimMode();
			const host = app.context.createVimHost();
			const viewportHeight = app.transcript.viewportHeight;

			handleVimKey(app.tab.vim, "g", host);
			handleVimKey(app.tab.vim, "g", host);
			expect(app.transcript.scrollTop).toBe(0);

			handleVimKey(app.tab.vim, "\x1b[6~", host);
			expect(app.transcript.scrollTop).toBe(viewportHeight - 1);

			handleVimKey(app.tab.vim, "q", host);
			expect(app.tab.vim.active).toBe(false);
		} finally {
			app.stop();
		}
	});

	it("lands on user messages, not assistant replies", async () => {
		const app = await bootFullscreen();
		try {
			app.context.enterActiveTabVimMode();
			const host = app.context.createVimHost();

			// A fresh modal surface sits past the newest message, so the first jump back
			// lands on the last user message and the panel names it.
			handleVimKey(app.tab.vim, "\x1b[1;2C", host);
			await app.painted();
			expect(app.previews.at(-1)?.selected).toBe(19);
			// The transcript is taller than the viewport, so the jump scrolls the row range
			// that carries the message instead of pinning it to the top. A user block pads
			// its text row, so the check trims before matching.
			const painted = await app.painted();
			expect(painted.some((row) => row.trim().startsWith("user-20"))).toBe(true);

			handleVimKey(app.tab.vim, "\x1b[1;2C", host);
			expect(app.previews.at(-1)?.selected).toBe(18);

			handleVimKey(app.tab.vim, "\x1b[C", host);
			expect(app.previews.at(-1)?.selected).toBe(19);

			// Past the last user message the view goes to the newest output instead, and the
			// panel selects the row that stands for it.
			handleVimKey(app.tab.vim, "\x1b[C", host);
			expect(app.previews.at(-1)?.selected).toBe(20);
			expect(app.transcript.isFollowingEnd).toBe(true);
		} finally {
			app.stop();
		}
	});

	it("refuses to enter in regular mode and reports why", async () => {
		const terminal = new VirtualTerminal(40, 12);
		const tui = createInteractiveTui({
			tuiMode: "regular",
			showHardwareCursor: false,
			logDirectory: "/tmp",
			terminal,
		});
		const tab = { vim: createVimTabState() };
		const notices: string[] = [];
		const context = makeWiringContext({
			renderer: tui,
			transcript: new ScrollView(new Text("x", 0, 0), {}),
			windowedTranscript: new WindowedTranscript({ blocks: () => [] }),
			tab,
			notices,
			previews: [],
			requestRender: vi.fn(),
		});

		context.enterActiveTabVimMode();

		expect(tab.vim.active).toBe(false);
		expect(notices.join(" ")).toContain("warning Vim mode needs the fullscreen transcript");
		tui.stop();
	});

	it("refuses to enter while MixCode Home covers the tab transcript", async () => {
		const terminal = new VirtualTerminal(40, 12);
		const tui = createInteractiveTui({
			tuiMode: "fullscreen",
			showHardwareCursor: false,
			logDirectory: "/tmp",
			terminal,
		});
		const tab = { vim: createVimTabState() };
		const notices: string[] = [];
		const context = makeWiringContext({
			renderer: tui,
			transcript: new ScrollView(new Text("x", 0, 0), {}),
			windowedTranscript: new WindowedTranscript({ blocks: () => [] }),
			tab,
			notices,
			previews: [],
			requestRender: vi.fn(),
			homeActive: true,
		});

		context.enterActiveTabVimMode();

		expect(tab.vim.active).toBe(false);
		expect(notices.join(" ")).toContain("warning Vim mode is not available on MixCode Home");
		tui.stop();
	});

	it("drops the modal state when the renderer loses its transcript viewport", async () => {
		const app = await bootFullscreen();
		try {
			app.context.enterActiveTabVimMode();
			app.context.renderer = { mode: "regular" } as unknown as VimWiringContext["renderer"];

			app.context.leaveVimModeIfUnavailable();

			expect(app.tab.vim.active).toBe(false);
		} finally {
			app.stop();
		}
	});
});

describe("vim mode chrome", () => {
	it("refreshes the editor frame when the exit key leaves the modal surface", async () => {
		const app = await bootFullscreen();
		try {
			const refresh = vi.fn();
			app.context.refreshVimChrome = refresh;
			app.context.enterActiveTabVimMode();
			expect(app.tab.vim.active).toBe(true);
			refresh.mockClear();

			expect(app.context.handleVimKeyInput("q")).toBe(true);
			expect(app.tab.vim.active).toBe(false);
			expect(refresh).toHaveBeenCalledTimes(1);
		} finally {
			app.stop();
		}
	});

	it("does not refresh the frame for keys that stay inside vim mode", async () => {
		const app = await bootFullscreen();
		try {
			app.context.enterActiveTabVimMode();
			const refresh = vi.fn();
			app.context.refreshVimChrome = refresh;

			expect(app.context.handleVimKeyInput("j")).toBe(true);
			expect(app.context.handleVimKeyInput("G")).toBe(true);
			expect(refresh).not.toHaveBeenCalled();
		} finally {
			app.stop();
		}
	});
});

describe("vim mode and the editor widget slots", () => {
	it("drops the widget rows but keeps the dock's separating row above the editor", () => {
		let vimActive = false;
		const above = new Map([["above", new Text("widget-above", 0, 0)]]);
		const below = new Map([["below", new Text("widget-below", 0, 0)]]);
		const budget = new DockWidgetBudget({
			widgets: () => ({ above, below }),
			chromeRows: () => 0,
			viewportRows: () => 12,
			// Vim mode hides the widget rows; the slot keeps its separating row.
			widgetsHidden: () => vimActive,
		});
		// A transcript taller than its viewport fills every chat row with content, so the tail
		// holds only the dock's own rows, and 3 editor rows fill the editor entry's minimum.
		const transcriptText = Array.from({ length: 30 }, (_, index) => `chat-${index}`).join("\n");
		const editorText = "editor-a\neditor-b\neditor-c";
		const viewport = createChatViewport({
			document: new Text(transcriptText, 0, 0),
			pendingMessages: new Container(),
			status: new Container(),
			widgetsAbove: budget.above,
			editor: new Text(editorText, 0, 0),
			widgetsBelow: budget.below,
			footer: new Text("footer-row", 0, 0),
		});
		const rows = () => renderLayoutFrame(viewport.root, 30, 12, () => {}).lines.map((line) => line.trimEnd());

		// Everything the dock draws while the widget rows render.
		expect(rows().slice(-7)).toEqual([
			"",
			"widget-above",
			"editor-a",
			"editor-b",
			"editor-c",
			"widget-below",
			"footer-row",
		]);

		vimActive = true;
		expect(rows().slice(-5)).toEqual(["", "editor-a", "editor-b", "editor-c", "footer-row"]);
	});
});
