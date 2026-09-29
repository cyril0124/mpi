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
	handleVimKeyInput: (data: string) => boolean;
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
	requestRender: () => void;
}): VimWiringContext {
	const context: VimWiringContext = {
		renderer: options.renderer,
		transcriptScrollView: options.transcript,
		windowedTranscript: options.windowedTranscript,
		tabManager: { getActive: () => options.tab },
		fallbackVimState: createVimTabState(),
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
		handleVimKeyInput: (data) => proto.handleVimKeyInput.call(context, data),
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
	const context = makeWiringContext({
		renderer: tui,
		transcript,
		windowedTranscript,
		tab,
		notices,
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

			handleVimKey(app.tab.vim, "g", host);
			handleVimKey(app.tab.vim, "g", host);
			await app.painted();
			expect(app.transcript.scrollTop).toBe(0);

			// A user block is three rows (blank, text, blank) and a reply one row, so the
			// user blocks start at rows 0, 4, 8, ... and the replies sit at 3, 7, 11, ...
			// Each jump paints its window, which measures the blocks it touches.
			handleVimKey(app.tab.vim, "\x1b[C", host);
			await app.painted();
			expect(app.transcript.scrollTop).toBe(4);
			handleVimKey(app.tab.vim, "\x1b[C", host);
			await app.painted();
			expect(app.transcript.scrollTop).toBe(8);
			handleVimKey(app.tab.vim, "\x1b[1;2C", host);
			await app.painted();
			expect(app.transcript.scrollTop).toBe(4);
			handleVimKey(app.tab.vim, "\x1b[1;2C", host);
			await app.painted();
			expect(app.transcript.scrollTop).toBe(0);

			// Past the last user message the view goes to the newest output instead.
			handleVimKey(app.tab.vim, "G", host);
			handleVimKey(app.tab.vim, "\x1b[C", host);
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
			requestRender: vi.fn(),
		});

		context.enterActiveTabVimMode();

		expect(tab.vim.active).toBe(false);
		expect(notices.join(" ")).toContain("warning Vim mode needs the fullscreen transcript");
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
	it("hides both widget rows while vim mode owns the viewport", () => {
		let vimActive = false;
		const viewport = createChatViewport({
			document: new Text("transcript body", 0, 0),
			pendingMessages: new Container(),
			status: new Container(),
			widgetsAbove: new Text("widget-above", 0, 0),
			editor: new Text("editor-row", 0, 0),
			widgetsBelow: new Text("widget-below", 0, 0),
			footer: new Text("footer-row", 0, 0),
			widgetsVisible: () => !vimActive,
		});
		const rows = () => renderLayoutFrame(viewport.root, 30, 12, () => {}).lines.join("\n");

		expect(rows()).toContain("widget-above");
		expect(rows()).toContain("widget-below");

		vimActive = true;
		expect(rows()).not.toContain("widget-above");
		expect(rows()).not.toContain("widget-below");
		expect(rows()).toContain("editor-row");
	});
});
