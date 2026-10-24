/**
 * Values the composer chrome reads on every TUI frame: what the empty editor
 * hints at, and the input card's title and context reading.
 */

import type { ContextUsage } from "../../../../../core/extensions/types.ts";
import type { AppKeybinding } from "../../../../../core/keybindings.ts";
import { type HomeSelectionState, homeSelectedTab } from "../../../../../core/mixcode/home/home-state.ts";
import type { AgentTab } from "../../../../../core/mixcode/multi-tab/tab-manager.ts";
import { theme } from "../../../theme/theme.ts";
import { keyGlyphText, primaryKeyGlyphText } from "../key-hints.ts";
import { exactContextUsageText } from "./input-meta.ts";
import type { EditorCardChrome } from "./prompt-editor.ts";

/** Composer hint naming the two keys that open a picker. */
const FILES_COMMANDS_HINT = "  @ files  / commands";

/** Share of the context window past which the card marks the usage as a warning. */
const CONTEXT_WARNING_RATIO = 0.85;

/** What the composer chrome needs from the live tab set. */
export interface ComposerContext {
	/** The Home surface, which composes for the agent its roster selects. */
	homeSelection: HomeSelectionState;
	/** Open agent tabs in tab-manager order; undefined before the manager exists. */
	tabs: readonly AgentTab[] | undefined;
	/** Title of the tab in front; undefined while Home is rendered or no tab exists. */
	activeTabTitle: string | undefined;
	/** Vim mode of the tab in front, which the composer renders read-only. */
	vimActive: boolean;
	/** True when zen mode hides the tab bar; the card marks it with `[ZEN]`. */
	zenMode: boolean;
	/** True while the draft starts with `!` and runs as a shell command. */
	shellMode: boolean;
	/** TUI mode; the widget-panel key hint is left out of the modes that never split. */
	uiMode: string;
	/** Context reading of the session in front; absent on Home. Read only when the card renders. */
	readUsage: () => ContextUsage | undefined;
	/** Model context window, used when the usage reading carries none. */
	fallbackContextWindow: number;
	/** True while the tab in front runs with a `/context-limit` override. */
	contextLimitOverridden: boolean;
}

/**
 * Hint for the empty composer: on Home it names the agent the next message goes
 * to, in vim mode it lists the modal keys, and otherwise it describes the draft.
 */
export function composerPlaceholder(context: ComposerContext): string {
	if (context.homeSelection.active) {
		const selected = context.tabs ? homeSelectedTab(context.homeSelection, context.tabs) : undefined;
		return theme.fg(
			"dim",
			`${selected ? `Send to ${selected.title}...` : "Select an agent..."}${FILES_COMMANDS_HINT}`,
		);
	}
	if (context.vimActive) {
		return theme.fg("dim", `Vim: ${vimKeyHints()}`);
	}
	const hints = composerKeyHints(context.uiMode);
	return theme.fg("dim", `Describe your next change...${FILES_COMMANDS_HINT}${hints}`);
}

/**
 * One vim action's main key, capitalized the way a hint reads. A single-letter key
 * keeps its case, because it names that exact key: `q` exits, `Q` does not.
 */
function vimKeyLabel(action: AppKeybinding): string {
	const label = primaryKeyGlyphText(action);
	return label.length > 1 ? label.charAt(0).toUpperCase() + label.slice(1) : label;
}

/**
 * Key row of the modal transcript surface. Every key comes from the keybindings, so a
 * rebound vim action is named by the key the user has; `topPrefix` appears twice because
 * its jump is a two-key chord (`gg`). An unbound action drops its segment, which keeps
 * the row from naming a key that does nothing.
 */
function vimKeyHints(): string {
	const lineKeys = [vimKeyLabel("app.vim.lineDown"), vimKeyLabel("app.vim.lineUp")].filter(Boolean).join("/");
	const pageKeys = [vimKeyLabel("app.vim.pageUp"), vimKeyLabel("app.vim.pageDown")].filter(Boolean).join("/");
	const topPrefix = vimKeyLabel("app.vim.topPrefix");
	const endKeys = [topPrefix ? `${topPrefix}${topPrefix}` : "", vimKeyLabel("app.vim.bottom")]
		.filter(Boolean)
		.join("/");
	const messageKeys = [vimKeyLabel("app.vim.nextUserMessage"), vimKeyLabel("app.vim.previousUserMessage")]
		.filter(Boolean)
		.join("/");
	const exitKey = vimKeyLabel("app.vim.exit");
	const segments = [
		lineKeys && `${lineKeys} scroll`,
		pageKeys,
		endKeys && `${endKeys} ends`,
		messageKeys && `${messageKeys} msg`,
		exitKey && `${exitKey} exit`,
	];
	return segments.filter(Boolean).join(" · ");
}

/**
 * The two keys that act on an empty composer besides `@` and `/`: leaving for
 * Home and toggling the widget side panel. Read from the keybindings, so a
 * rebound key still names the key the user has, and an unbound one drops its
 * half. The panel half is left out where the key does nothing, which is every
 * TUI mode that does not split the chat.
 */
function composerKeyHints(uiMode: string): string {
	const home = keyGlyphText("app.home.returnHome");
	const widgets = uiMode === "fullscreen" ? keyGlyphText("app.widgets.panel") : "";
	const parts = [home && `${home} Home`, widgets && `${widgets} widgets`].filter(Boolean);
	return parts.length > 0 ? `  ${parts.join(" · ")}` : "";
}

/**
 * Labels for the input card: the active tab's name and its exact context usage.
 */
export function editorCardChrome(context: ComposerContext): EditorCardChrome {
	const home = context.homeSelection.active;
	const tabs = context.tabs;
	// Home composes for the agent its roster selects rather than the tab in front.
	const title = home
		? tabs
			? homeSelectedTab(context.homeSelection, tabs)?.title
			: undefined
		: context.activeTabTitle;
	const usage = home ? undefined : context.readUsage();
	const tokens = usage?.tokens ?? undefined;
	const contextWindow = usage?.contextWindow ?? context.fallbackContextWindow;
	return {
		title: title ?? "New message",
		contextText: home ? "" : exactContextUsageText(tokens, contextWindow, context.contextLimitOverridden),
		contextWarning: tokens !== undefined && contextWindow > 0 && tokens >= contextWindow * CONTEXT_WARNING_RATIO,
		vimMode: context.vimActive,
		// The badge belongs to the agent surface: Home shows the tab bar again.
		zenMode: context.zenMode,
		shellMode: context.shellMode,
	};
}
