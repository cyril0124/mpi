/**
 * Modal navigation for the fullscreen transcript viewport.
 *
 * Vim mode owns keyboard input while it is active: it scrolls the transcript,
 * jumps between prompts, and leaves on an explicit exit key. State is per tab
 * (see `AgentTab.vim`); the controller is supplied by `InteractiveMode`, which
 * owns the transcript scroll view.
 */
import type { KeybindingsManager } from "../../keybindings.ts";

/** How long an empty-editor `ctrl+u` keeps the vim-entry confirmation open. */
export const VIM_ENTER_ARM_WINDOW_MS = 1_000;
/** Rows moved by one `j` / `k` press. */
export const VIM_LINE_SCROLL_ROWS = 3;

export interface VimTabState {
	/** True while the modal transcript surface owns input. */
	active: boolean;
	/** `g` was pressed once; a second `g` jumps to the oldest row. */
	topArmed: boolean;
	/** `Date.now()` when an empty-editor `ctrl+u` armed entry. */
	enterArmedAt: number | undefined;
}

export function createVimTabState(): VimTabState {
	return { active: false, topArmed: false, enterArmedAt: undefined };
}

/** Clear every modal flag, including the armed jump and the entry timer. */
export function resetVimTabState(state: VimTabState): void {
	state.active = false;
	state.topArmed = false;
	state.enterArmedAt = undefined;
}

/** Transcript navigation the modal surface drives. Positive values move towards older output. */
export interface VimTranscriptController {
	/** True when an in-app transcript viewport exists (fullscreen mode). */
	available(): boolean;
	scrollLines(lines: number): void;
	scrollPages(pages: number): void;
	scrollToOldest(): void;
	scrollToNewest(): void;
	/** False when no further user message exists in that direction. */
	jumpUserMessage(direction: -1 | 1): boolean;
}

/**
 * What the modal surface needs from its host. Both members repaint on their own:
 * the controller owns the viewport's rendering, and `notify` shows transient
 * feedback.
 */
export interface VimKeyHost {
	keybindings: KeybindingsManager;
	controller: VimTranscriptController;
	notify(message: string): void;
}

/**
 * Vim mode owns every key while active. These actions keep working, because a
 * modal surface that swallowed tab switching or tool expansion would be a trap.
 */
const VIM_PASSTHROUGH_ACTIONS = [
	"app.tab.next",
	"app.tab.previous",
	"app.tools.expand",
	"app.thinking.toggle",
] as const;

/**
 * Handle one chunk of input while vim mode is active.
 *
 * Returns true when the key was consumed. A false return must be routed to the
 * normal handler for that action (tab switching, tool expand, thinking toggle).
 */
export function handleVimKey(state: VimTabState, data: string, host: VimKeyHost): boolean {
	if (!state.active) return false;
	const keys = host.keybindings;
	for (const action of VIM_PASSTHROUGH_ACTIONS) {
		if (keys.matches(data, action)) {
			state.topArmed = false;
			return false;
		}
	}

	if (keys.matches(data, "app.vim.exit")) {
		exitVimMode(state);
		return true;
	}

	if (keys.matches(data, "app.vim.top")) {
		state.topArmed = false;
		host.controller.scrollToOldest();
		return true;
	}

	// `g` arms the two-key top jump; the second `g` performs it.
	if (keys.matches(data, "app.vim.topPrefix")) {
		if (state.topArmed) {
			state.topArmed = false;
			host.controller.scrollToOldest();
			return true;
		}
		state.topArmed = true;
		host.notify("Press g again to jump to the oldest message");
		return true;
	}

	state.topArmed = false;

	if (keys.matches(data, "app.vim.lineUp")) {
		host.controller.scrollLines(VIM_LINE_SCROLL_ROWS);
		return true;
	}
	if (keys.matches(data, "app.vim.lineDown")) {
		host.controller.scrollLines(-VIM_LINE_SCROLL_ROWS);
		return true;
	}
	if (keys.matches(data, "app.vim.pageUp")) {
		host.controller.scrollPages(1);
		return true;
	}
	if (keys.matches(data, "app.vim.pageDown")) {
		host.controller.scrollPages(-1);
		return true;
	}
	if (keys.matches(data, "app.vim.bottom")) {
		host.controller.scrollToNewest();
		return true;
	}
	if (keys.matches(data, "app.vim.nextUserMessage")) {
		handleUserMessageJump(state, host, 1);
		return true;
	}
	if (keys.matches(data, "app.vim.previousUserMessage")) {
		handleUserMessageJump(state, host, -1);
		return true;
	}

	// Modal surface: swallow anything unbound so it cannot reach the editor.
	return true;
}

/** Jump one user message, or report why the view could not move. */
function handleUserMessageJump(state: VimTabState, host: VimKeyHost, direction: -1 | 1): void {
	state.topArmed = false;
	if (host.controller.jumpUserMessage(direction)) {
		host.notify(direction === 1 ? "Next user message" : "Previous user message");
		return;
	}
	if (direction === 1) {
		// Jumping past the last user message selects the newest output.
		host.controller.scrollToNewest();
		host.notify("Newest output");
		return;
	}
	host.notify("No older user message");
}

/**
 * Enter the modal surface. Reports the fullscreen requirement instead when the host
 * has no transcript viewport, and returns whether the surface is now active.
 */
export function enterVimMode(state: VimTabState, host: VimKeyHost): boolean {
	state.enterArmedAt = undefined;
	state.topArmed = false;
	if (state.active) return true;
	if (!host.controller.available()) {
		host.notify("Vim mode needs the fullscreen transcript (run /settings and enable fullscreen)");
		return false;
	}
	state.active = true;
	return true;
}

export function exitVimMode(state: VimTabState): void {
	resetVimTabState(state);
}

/** Outcome of one key while the empty-editor vim entry can be armed. */
export interface VimEnterArmResult {
	/** The key armed the window and is waiting for a confirmation key. */
	armed: boolean;
	/** The key entered vim mode. */
	entered: boolean;
	/** The key belonged to the arm or its confirmation and must not reach the editor. */
	consumed: boolean;
}

/**
 * Empty-editor `ctrl+u` arms vim entry; `u` or another `ctrl+u` inside the
 * window enters it.
 */
export function handleVimEnterArmKey(
	state: VimTabState,
	data: string,
	host: VimKeyHost,
	canArm: boolean,
	now: number,
): VimEnterArmResult {
	if (state.active) return { armed: false, entered: false, consumed: false };
	const armedAt = state.enterArmedAt;
	if (armedAt !== undefined) {
		state.enterArmedAt = undefined;
		const confirmKey =
			host.keybindings.matches(data, "app.vim.enterConfirm") || host.keybindings.matches(data, "app.vim.enter");
		if (confirmKey && now - armedAt <= VIM_ENTER_ARM_WINDOW_MS) {
			return { armed: false, entered: enterVimMode(state, host), consumed: true };
		}
	}
	if (!canArm || !host.keybindings.matches(data, "app.vim.enter")) {
		return { armed: false, entered: false, consumed: false };
	}
	state.enterArmedAt = now;
	host.notify("Again: u or ctrl+u → vim");
	return { armed: true, entered: false, consumed: true };
}

/**
 * A tab activation moves the modal surface to the tab being focused, so at most one
 * tab is modal.
 */
export function transferVimMode(from: VimTabState, to: VimTabState): void {
	if (from === to || !from.active) return;
	to.active = true;
	to.topArmed = false;
	to.enterArmedAt = undefined;
	resetVimTabState(from);
}
