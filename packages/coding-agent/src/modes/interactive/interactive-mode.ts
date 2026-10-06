/**
 * Interactive mode for the coding agent.
 * Handles TUI rendering and user interaction, delegating business logic to AgentSession.
 */

import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { format } from "node:util";
import type { AgentMessage, ThinkingLevel } from "@earendil-works/pi-agent-core";
import type { AuthEvent, AuthPrompt } from "@earendil-works/pi-ai";
import {
	type AssistantMessage,
	type ImageContent,
	isRetryableAssistantError,
	type Message,
	type Model,
	type Usage,
} from "@earendil-works/pi-ai/compat";
import type {
	AutocompleteProvider,
	ClipboardResult,
	EditorComponent,
	Keybinding,
	KeyId,
	MarkdownTheme,
	OverlayHandle,
	OverlayOptions,
	TuiMainScreenRenderState,
	TuiSelectionOptions,
} from "@earendil-works/pi-tui";
import * as TuiLayouts from "@earendil-works/pi-tui";
import {
	CombinedAutocompleteProvider,
	type Component,
	Container,
	countGraphemes,
	Markdown,
	matchesKey,
	Spacer,
	setCapabilityOverrides,
	setKeybindings,
	type Terminal,
	Text,
	type TUI,
	TuiAltScreen,
	TuiMainScreen,
	visibleWidth,
} from "@earendil-works/pi-tui";
import { spawn } from "child_process";
import {
	APP_NAME,
	APP_TITLE,
	CONFIG_DIR_NAME,
	getAgentDir,
	getAuthPath,
	getDebugLogPath,
	getDocsPath,
	VERSION,
} from "../../config.ts";
import { type AgentSession, type AgentSessionEvent, parseSkillBlock } from "../../core/agent-session.ts";
import {
	type AgentSessionRuntime,
	type CreateAgentSessionRuntimeFactory,
	SessionImportFileNotFoundError,
} from "../../core/agent-session-runtime.ts";
import type { AgentSessionRuntimeDiagnostic } from "../../core/agent-session-services.ts";
import {
	CACHE_TTL_MS,
	type CacheMiss,
	collectCacheMisses,
	computeCacheWaste,
	detectCacheMiss,
} from "../../core/cache-stats.ts";
import { formatCacheWarmingStatus, formatCacheWarmingUsage } from "../../core/cache-warmer.ts";
import { findExtensionStackMatches, recordCrash, takeUnnotifiedCrash } from "../../core/crash-log.ts";
import { DEFAULT_THINKING_LEVEL, THINKING_LEVEL_OPTIONS } from "../../core/defaults.ts";
import type {
	AutocompleteProviderFactory,
	ContextUsage,
	EditorFactory,
	ExtensionCommandContext,
	ExtensionContext,
	ExtensionRunner,
	ExtensionUIContext,
	ExtensionUIDialogOptions,
	ExtensionWidgetOptions,
	MarkdownTransformer,
	ProjectTrustContext,
	ToolInfo,
	UserBashEventResult,
	WorkingIndicatorOptions,
} from "../../core/extensions/index.ts";
import { FooterDataProvider, type ReadonlyFooterDataProvider } from "../../core/footer-data-provider.ts";
import { configureHttpDispatcher, formatHttpIdleTimeoutMs } from "../../core/http-dispatcher.ts";
import { type AppKeybinding, KeybindingsManager } from "../../core/keybindings.ts";
import { createCompactionSummaryMessage, createCustomMessage } from "../../core/messages.ts";
import { applyCacheMissNoticeSetting } from "../../core/mixcode/cache-miss-notice-setting.ts";
import {
	getConsoleHistory,
	unwireConsoleSink,
	wireConsoleSink,
} from "../../core/mixcode/console/console-tui-bridge.ts";
import { resolveOutputEditor } from "../../core/mixcode/console/output-editor.ts";
import { runWithConsoleTab } from "../../core/mixcode/console-scope.ts";
import {
	applyContextLimitToSession,
	baseContextWindow,
	type ContextLimitValue,
	clearContextLimitOverride,
	isContextLimitActive,
	parseContextLimitValue,
} from "../../core/mixcode/context-limit.ts";
import { emitMarkDone, setWaitingForInputCount } from "../../core/mixcode/extension-event-bus.ts";
import {
	type FollowUpHost,
	flushSteerQueue,
	popQueuedMessage,
	resumeFollowUps,
	submitFollowUps,
} from "../../core/mixcode/follow-up/runtime-follow-up.ts";
import {
	createFollowUpQueueState,
	discardFollowUps,
	FOLLOW_UP_BATCH_FLAG,
	type FollowUpQueueState,
	parseFollowUpArgs,
	pauseFollowUps,
	type QueueKind,
	syncFollowUpPreview,
} from "../../core/mixcode/follow-up/runtime-follow-up-queue.ts";
import { scheduleSteerSettleFlush } from "../../core/mixcode/follow-up/steer-settle-flush.ts";
import {
	adjustHomeSelectionAfterClose,
	clampHomeSelectedTabIndex,
	createHomeSelection,
	HOME_TAB_ID,
	type HomeRosterTab,
	homeSelectedTab,
	moveHomeSelection,
	nextTabId,
	selectHomeTabById,
	syncHomeSelectionToTab,
	toggleHomeNonIdleOnly,
	visibleRosterIndices,
} from "../../core/mixcode/home/home-state.ts";
import {
	DEFAULT_BOXED_HIDDEN_THINKING,
	DEFAULT_ICON_MODE,
	DEFAULT_INLINE_WIDGETS,
	DEFAULT_SHOW_RESPONSE_MODEL_NOTICES,
	type IconMode,
	loadMixCodeSettings,
	type MixCodeSettings,
	mixcodeSettingsFilePath,
	writeBoxedHiddenThinkingSetting,
	writeIconModeSetting,
	writeInlineWidgetsSetting,
	writeShowResponseModelNoticesSetting,
} from "../../core/mixcode/mixcode-settings.ts";
import {
	type MixcodeTabMeta,
	readOpenTabs,
	readTabMeta,
	readWorkspaces,
	replaceOpenTabSessionIds,
	resolveSessionPath,
} from "../../core/mixcode/multi-tab/mixcode-state.ts";
import { SharedTabLayout } from "../../core/mixcode/multi-tab/shared-tab-layout.ts";
import { type AgentTab, TabManager, tabBusyReason } from "../../core/mixcode/multi-tab/tab-manager.ts";
import { waitForTabBindOrPark } from "../../core/mixcode/multi-tab/tab-restore-park.ts";
import {
	defaultAgentTitle,
	isTabColorName,
	isWorkingStatus,
	nextAvailableAgentTitle,
	TAB_COLOR_NAMES,
	type TabColorName,
	type TabLoadingPhase,
} from "../../core/mixcode/multi-tab/types.ts";
import { listTrash, restoreFromTrash, trashDir } from "../../core/mixcode/session-trash.ts";
import { persistSessionCwd, writeSessionFile } from "../../core/mixcode/session-workdir.ts";
import { applySessionCopiedSettings, reloadSettingsAcrossTabs } from "../../core/mixcode/settings-tab-sync.ts";
import { type EditorFlagRequest, parseEditorFlag } from "../../core/mixcode/system-inspection/editor-flag.ts";
import { getEffectiveSystemPrompt } from "../../core/mixcode/system-inspection/effective-system-prompt.ts";
import { renderSystemPromptSectionStats } from "../../core/mixcode/system-inspection/system-prompt-stats.ts";
import { renderSystemToolsText } from "../../core/mixcode/system-inspection/system-tools.ts";
import {
	activeToast,
	clearToast,
	copyConfirmation,
	copyFailure,
	pushToast,
	TOAST_DURATION_MS,
	type ToastHost,
	type ToastType,
} from "../../core/mixcode/toast/toast.ts";
import {
	USER_MESSAGE_PREVIEW_MIN_WIDTH,
	USER_MESSAGE_PREVIEW_TTL_MS,
	USER_MESSAGE_PREVIEW_WIDTH,
	userMessagePreviewLabel,
	userMessagePreviewRows,
	userMessagePreviewWindow,
} from "../../core/mixcode/vim/user-message-preview.ts";
import {
	createVimTabState,
	enterVimMode,
	handleVimEnterArmKey,
	handleVimKey,
	resetVimTabState,
	type VimKeyHost,
	type VimTabState,
} from "../../core/mixcode/vim/vim-mode.ts";
import {
	defaultModelPerProvider,
	findExactModelReferenceMatch,
	resolveModelScopeFromModels,
} from "../../core/model-resolver.ts";
import { CredentialSynchronizationError } from "../../core/model-runtime.ts";
import { DefaultPackageManager } from "../../core/package-manager.ts";
import type { ResourceDiagnostic } from "../../core/resource-loader.ts";
import { formatMissingSessionCwdPrompt, MissingSessionCwdError } from "../../core/session-cwd.ts";
import {
	getDefaultSessionDir,
	type SessionEntry,
	SessionManager,
	sessionEntryToContextMessages,
	type UsageEntry,
} from "../../core/session-manager.ts";
import type { FullscreenExitOutput, TuiMode } from "../../core/settings-manager.ts";
import { BUILTIN_SLASH_COMMANDS } from "../../core/slash-commands.ts";
import type { SourceInfo } from "../../core/source-info.ts";
import { isInstallTelemetryEnabled } from "../../core/telemetry.ts";
import { withBuiltInRenderers } from "../../core/tools/renderers/index.ts";
import type { TruncationResult } from "../../core/tools/truncate.ts";
import { hasTrustRequiringProjectResources, ProjectTrustStore } from "../../core/trust-manager.ts";
import { getUsageCostBreakdown } from "../../core/usage-totals.ts";
import { getChangelogPath, getNewEntries, normalizeChangelogLinks, parseChangelog } from "../../utils/changelog.ts";
import { copyToClipboard, readClipboardText } from "../../utils/clipboard.ts";
import { extensionForImageMimeType, readClipboardImage } from "../../utils/clipboard-image.ts";
import { parseGitUrl } from "../../utils/git.ts";
import { getCwdRelativePath, resolvePath } from "../../utils/paths.ts";
import { getPiUserAgent } from "../../utils/pi-user-agent.ts";
import { killTrackedDetachedChildren } from "../../utils/shell.ts";
import { loadAllHighlightLanguages } from "../../utils/syntax-highlight.ts";
import { ensureTool, type ToolStatus } from "../../utils/tools-manager.ts";
import { reportBug } from "./bug-report.ts";
import { createChatViewport } from "./chat-viewport.ts";
import { ArminComponent } from "./components/armin.ts";
import { AssistantMessageComponent } from "./components/assistant-message.ts";
import { BashExecutionComponent } from "./components/bash-execution.ts";
import { BranchSummaryMessageComponent } from "./components/branch-summary-message.ts";
import { CompactionSummaryMessageComponent } from "./components/compaction-summary-message.ts";
import { CustomEntryComponent } from "./components/custom-entry.ts";
import { CustomMessageComponent } from "./components/custom-message.ts";
import { DaxnutsComponent } from "./components/daxnuts.ts";
import { DynamicBorder } from "./components/dynamic-border.ts";
import { EarendilAnnouncementComponent } from "./components/earendil-announcement.ts";
import { ExtensionEditorComponent } from "./components/extension-editor.ts";
import { ExtensionInputComponent } from "./components/extension-input.ts";
import { ExtensionSelectorComponent, type ExtensionSelectorOptions } from "./components/extension-selector.ts";
import { type FooterComponent, formatTokens } from "./components/footer.ts";
import { formatKeyText, keyDisplayText, keyHint, keyText, rawKeyHint } from "./components/keybinding-hints.ts";
import { LoginDialogComponent } from "./components/login-dialog.ts";
import { createMermaidMarkdownTransformer } from "./components/mermaid.ts";
import {
	CommandPaletteComponent,
	type CommandPaletteEntry,
} from "./components/mixcode/command-palette/command-palette.ts";
import { ConsoleNotice, consoleNoticeOverlayOptions } from "./components/mixcode/console/console-notice.ts";
import { ContextLimitSelectorComponent } from "./components/mixcode/context-limit/context-limit-selector.ts";
import { DockWidgetBudget } from "./components/mixcode/dock-widgets/dock-widgets.ts";
import {
	QueuePreviewComponent,
	type QueuePreviewData,
	type QueuePreviewHints,
} from "./components/mixcode/follow-up/queue-preview.ts";
import {
	clearHomeTabCache,
	type HomeCard,
	type HomeSnapshot,
	homePreviewOf,
	mapHomeMessages,
} from "./components/mixcode/home/home-model.ts";
import { type HomeAction, HomeView, type HomeViewModel } from "./components/mixcode/home/home-view.ts";
import { hasPointerCueAt } from "./components/mixcode/hover/hover-block.ts";
import {
	createInlineWidgetTabState,
	InlineWidgetsComponent,
	type InlineWidgetTabState,
} from "./components/mixcode/inline-widgets/inline-widgets.ts";
import {
	type ComposerContext,
	composerPlaceholder,
	editorCardChrome,
} from "./components/mixcode/input-dock/composer-state.ts";
import { MixcodeDockFooter } from "./components/mixcode/input-dock/dock-footer.ts";
import type { InputMetaData, MetaAction } from "./components/mixcode/input-dock/input-meta.ts";
import { MixcodePromptEditor } from "./components/mixcode/input-dock/prompt-editor.ts";
import { primaryKeyGlyphText } from "./components/mixcode/key-hints.ts";
import { TabBar, type TabBarItem, type TabBarModel } from "./components/mixcode/multi-tab/tab-bar.ts";
import { bindWorkingIndicatorRedraw } from "./components/mixcode/multi-tab/tab-glyphs.ts";
import { TabJumpComponent, type TabJumpEntry } from "./components/mixcode/multi-tab/tab-jump.ts";
import { bindTabLoadingRedraw } from "./components/mixcode/multi-tab/tab-loading.ts";
import type { TabRuleChrome } from "./components/mixcode/multi-tab/tab-rule-chrome.ts";
import { zenStatusMarkers } from "./components/mixcode/multi-tab/zen-status.ts";
import { QuitConfirmComponent } from "./components/mixcode/quit-confirm/quit-confirm.ts";
import {
	SETTINGS_PANEL_HEIGHT_PERCENT,
	SETTINGS_PANEL_WIDTH_PERCENT,
} from "./components/mixcode/settings/settings-panel.ts";
import { bindActiveTabShimmerRedraw } from "./components/mixcode/tab-shimmer.ts";
import {
	TOAST_MARGIN,
	ToastCardComponent,
	toastBoxWidth,
	toastCardRows,
} from "./components/mixcode/toast/toast-card.ts";
import { UserMessagePreviewPanel } from "./components/mixcode/vim-user-messages/user-message-preview-panel.ts";
import {
	createWidgetPanelTabState,
	WIDGET_PANEL_MIN_TERMINAL_WIDTH,
	WidgetPanelComponent,
	type WidgetPanelTabState,
} from "./components/mixcode/widget-panel/widget-panel.ts";
import { WindowedTranscript } from "./components/mixcode/windowed-chat/windowed-transcript.ts";
import {
	WORKDIR_PICKER_HEIGHT_PERCENT,
	WORKDIR_PICKER_WIDTH_PERCENT,
	WorkdirPickerComponent,
} from "./components/mixcode/workdir-picker/workdir-picker.ts";
import { ModelSelectorComponent } from "./components/model-selector.ts";
import { type AuthSelectorProvider, OAuthSelectorComponent } from "./components/oauth-selector.ts";
import { ScopedModelsSelectorComponent } from "./components/scoped-models-selector.ts";
import { SessionSelectorComponent } from "./components/session-selector.ts";
import { SettingsSelectorComponent } from "./components/settings-selector.ts";
import { SkillInvocationMessageComponent } from "./components/skill-invocation-message.ts";
import {
	BranchSummaryStatusIndicator,
	CompactionStatusIndicator,
	IdleStatus,
	RetryStatusIndicator,
	type StatusIndicator,
	WorkingStatusIndicator,
} from "./components/status-indicator.ts";
import { ThinkingSelectorComponent } from "./components/thinking-selector.ts";
import { ToolExecutionComponent } from "./components/tool-execution.ts";
import { TreeSelectorComponent } from "./components/tree-selector.ts";
import { TrustSelectorComponent } from "./components/trust-selector.ts";
import { splitOversizedUserMessage, UserMessageComponent } from "./components/user-message.ts";
import { UserMessageSelectorComponent } from "./components/user-message-selector.ts";
import { type ExternalEditorResult, editInExternalEditor } from "./external-editor.ts";
import {
	type BatchCommandHost,
	handleBatchCommand as runBatchCommand,
	runBatchFile as runBatchScript,
} from "./mixcode/batch/batch-command.ts";
import { type CommandSource, collectSlashCommands, type TabArgumentOption } from "./mixcode/command-list.ts";
import { responseModelNoticeText } from "./mixcode/model-mismatch/notice.ts";
import {
	bindRuntimeCallbacks as bindRuntimeCallbacksImpl,
	handleCloseTab as handleCloseTabImpl,
	handleNewTab as handleNewTabImpl,
	handleResumeIntoTab as handleResumeIntoTabImpl,
	type ResumeTabHost,
	type RuntimeCallbackHost,
	type TabLifecycleHost,
} from "./mixcode/multi-tab/tab-lifecycle.ts";
import {
	handleCloseAllSessions as handleCloseAllSessionsImpl,
	handleCloseSession as handleCloseSessionImpl,
	handleDeleteAllSessions as handleDeleteAllSessionsImpl,
	handleDeleteSession as handleDeleteSessionImpl,
	type SessionActionHost,
} from "./mixcode/multi-tab/tab-session-actions.ts";
import {
	deleteWorkspaceCommand as deleteWorkspaceCommandImpl,
	restoreWorkspaceCommand as restoreWorkspaceCommandImpl,
	saveWorkspaceCommand as saveWorkspaceCommandImpl,
	type WorkspaceHost,
} from "./mixcode/multi-tab/tab-workspace.ts";
import { createMouseSelectionOptions } from "./mixcode/selection/selection-surface.ts";
import { refreshModelCatalogs } from "./model-catalog-refresh.ts";
import { shareSession } from "./session-share.ts";
import {
	getAvailableThemes,
	getAvailableThemesWithPaths,
	getEditorTheme,
	getMarkdownTheme,
	getThemeByName,
	onThemeChange,
	setRegisteredThemes,
	stopThemeWatcher,
	Theme,
	type ThemeColor,
	theme,
} from "./theme/theme.ts";
import { InteractiveThemeController } from "./theme/theme-controller.ts";
import { createInteractiveTui, createInteractiveTuiReference } from "./tui-renderer.ts";

export { createInteractiveTui, createInteractiveTuiReference } from "./tui-renderer.ts";

/** Interface for components that can be expanded/collapsed */
interface Expandable {
	setExpanded(expanded: boolean): void;
}

interface WorkingStatusEditor extends EditorComponent {
	readonly embedWorkingStatus: boolean;
	setWorkingStatusIndicator(indicator: StatusIndicator | undefined): void;
}

function isWorkingStatusEditor(editor: EditorComponent): editor is WorkingStatusEditor {
	return (
		"embedWorkingStatus" in editor &&
		editor.embedWorkingStatus === true &&
		"setWorkingStatusIndicator" in editor &&
		typeof editor.setWorkingStatusIndicator === "function"
	);
}

interface AutocompleteEditor extends EditorComponent {
	isShowingAutocomplete(): boolean;
}

/** True while the editor's own command popup owns the keyboard. */
function isShowingAutocomplete(editor: EditorComponent): boolean {
	return (
		"isShowingAutocomplete" in editor &&
		typeof editor.isShowingAutocomplete === "function" &&
		(editor as AutocompleteEditor).isShowingAutocomplete()
	);
}

function isExpandable(obj: unknown): obj is Expandable {
	return typeof obj === "object" && obj !== null && "setExpanded" in obj && typeof obj.setExpanded === "function";
}

class ExpandableText extends Text implements Expandable {
	private readonly getCollapsedText: () => string;
	private readonly getExpandedText: () => string;

	constructor(
		getCollapsedText: () => string,
		getExpandedText: () => string,
		expanded = false,
		paddingX = 0,
		paddingY = 0,
	) {
		super(expanded ? getExpandedText() : getCollapsedText(), paddingX, paddingY);
		this.getCollapsedText = getCollapsedText;
		this.getExpandedText = getExpandedText;
	}

	setExpanded(expanded: boolean): void {
		this.setText(expanded ? this.getExpandedText() : this.getCollapsedText());
	}
}

type CompactionQueuedMessage = {
	text: string;
	mode: "steer" | "followUp";
};

type CompactionCostNotice = {
	type: "compaction_cost";
	kind: "compaction" | "branch_summary";
	usage: Usage;
};

type RenderSessionItem = AgentMessage | Extract<SessionEntry, { type: "custom" | "usage" }> | CompactionCostNotice;

function isCustomSessionEntry(item: RenderSessionItem): item is Extract<SessionEntry, { type: "custom" }> {
	return "type" in item && item.type === "custom";
}

function isCompactionCostNotice(item: RenderSessionItem): item is CompactionCostNotice {
	return "type" in item && item.type === "compaction_cost";
}

function isUsageSessionEntry(item: RenderSessionItem): item is Extract<SessionEntry, { type: "usage" }> {
	return "type" in item && item.type === "usage";
}

const DEAD_TERMINAL_ERROR_CODES = new Set(["EIO", "EPIPE", "ENOTCONN"]);

function isDeadTerminalError(error: unknown): boolean {
	if (!error || typeof error !== "object" || !("code" in error)) {
		return false;
	}
	const code = (error as NodeJS.ErrnoException).code;
	return code !== undefined && DEAD_TERMINAL_ERROR_CODES.has(code);
}

export function formatCrashExtensionHint(extensionMatches: readonly string[] | undefined): string | undefined {
	const matches = Array.isArray(extensionMatches)
		? extensionMatches.filter((match): match is string => typeof match === "string" && match.length > 0)
		: [];
	if (matches.length === 0) return undefined;
	const quoted = matches.map((match) => `\`${match}\``);
	const labels =
		quoted.length === 1
			? quoted[0]
			: quoted.length === 2
				? quoted.join(" and ")
				: `${quoted.slice(0, -1).join(", ")}, and ${quoted[quoted.length - 1]}`;
	const noun = matches.length === 1 ? "extension" : "extensions";
	const pronoun = matches.length === 1 ? "it" : "them";
	return `A stack frame came from loaded ${noun} ${labels}, which may be involved. Try disabling ${pronoun} with \`${APP_NAME} config\`, or run \`${APP_NAME} -ne\` to confirm.`;
}

const ANTHROPIC_SUBSCRIPTION_AUTH_WARNING =
	"Anthropic subscription auth is active. Third-party harness usage draws from extra usage and is billed per token, not your Claude plan limits. Manage extra usage at https://claude.ai/settings/usage. Disable this warning in /settings.";

function isAnthropicSubscriptionAuthKey(apiKey: string | undefined): boolean {
	return typeof apiKey === "string" && apiKey.startsWith("sk-ant-oat");
}

function isUnknownModel(model: Model<any> | undefined): boolean {
	return !!model && model.provider === "unknown" && model.id === "unknown" && model.api === "unknown";
}

function hasDefaultModelProvider(providerId: string): providerId is keyof typeof defaultModelPerProvider {
	return providerId in defaultModelPerProvider;
}

function llamaCppPostLoginGuidance(actionLabel: string, loadedModelCount: number): string {
	return loadedModelCount === 0
		? `${actionLabel}. No llama.cpp models are loaded. Use /llama to load a model, then /model to select it.`
		: `${actionLabel}. Use /model to select a loaded llama.cpp model, or /llama to manage models.`;
}

/**
 * Parse `/new-session [--focus|--no-focus] [title]`.
 * Defaults to focusing the new tab.
 */
function parseNewSessionArgs(args: string): { title?: string; focus: boolean; error?: string } {
	let rest = args.trim();
	let focus = true;
	const match = rest.match(/^(--focus|--no-focus)\b\s*/);
	if (match) {
		focus = match[1] === "--focus";
		rest = rest.slice(match[0].length).trim();
	} else if (rest.startsWith("--")) {
		return { focus: true, error: "Usage: /new-session [--focus|--no-focus] [title]" };
	}
	return { title: rest || undefined, focus };
}

type ExtensionFooterFactory = (
	tui: TUI,
	thm: Theme,
	footerData: ReadonlyFooterDataProvider,
) => Component & { dispose?(): void };
type ExtensionHeaderFactory = (tui: TUI, thm: Theme) => Component & { dispose?(): void };

/** Extension-owned UI belonging to one tab, swapped when the tab becomes active. */
interface TabExtensionUi {
	widgetsAbove: Map<string, Component & { dispose?(): void }>;
	widgetsBelow: Map<string, Component & { dispose?(): void }>;
	footerFactory: ExtensionFooterFactory | undefined;
	headerFactory: ExtensionHeaderFactory | undefined;
	statuses: Map<string, string>;
	autocompleteWrappers: AutocompleteProviderFactory[];
	editorFactory: EditorFactory | undefined;
	workingMessage: string | undefined;
	workingVisible: boolean;
	workingIndicatorOptions: WorkingIndicatorOptions | undefined;
	hiddenThinkingLabel: string | undefined;
	toolsExpanded: boolean;
	/** Notices an extension raised for this tab while it was not the focused one. */
	notices: Array<{ message: string; type?: "info" | "warning" | "error" }>;
}

/**
 * An extension interaction that belongs to one tab.
 *
 * An extension of one session opens it, and a session belongs to one tab, so the
 * surface it takes (the editor slot, or an overlay) is that tab's.
 */
interface TabInteraction {
	/** Which surface the interaction took, which decides how it is parked. */
	kind: "selector" | "input" | "editor" | "custom" | "overlay";
	/** The tab that owns it, so a close can hand the slot back to what it parked. */
	tabId?: string;
	/** Draft a custom component displaced, read when it takes the slot. */
	savedDraft?: string;
	/** Component shown on the editor slot; undefined for an overlay interaction. */
	component?: Component & { dispose?(): void };
	/** True while `component` occupies the editor slot. */
	mounted: boolean;
	/** Overlay handle and whether it takes the keyboard; undefined for a slotted one. */
	overlay?: { handle: OverlayHandle; capturing: boolean };
	/** Drops the interaction from its tab's pending list. Set by `trackTabInteraction`. */
	untrack?: () => void;
}

/**
 * A terminal-input listener an extension asked for through `ctx.ui.onTerminalInput`, kept for
 * the tab that registered it across tab switches.
 */
interface ExtensionTerminalInputSubscription {
	/** Tab that owns the listener; undefined in single-session mode, where it always answers. */
	tabId: string | undefined;
	handler: (data: string) => { consume?: boolean; data?: string } | undefined;
	/** Present only while the listener is registered with the renderer. */
	unsubscribe?: () => void;
}

/**
 * Options for InteractiveMode initialization.
 */
export interface InteractiveModeOptions {
	/** Providers that were migrated to auth.json (shows warning) */
	migratedProviders?: string[];
	/** Diagnostics collected before the interactive TUI was initialized. */
	startupDiagnostics?: AgentSessionRuntimeDiagnostic[];
	/** Warning message if session model couldn't be restored */
	modelFallbackMessage?: string;
	/** Cwd to trust after reload if it gained a .pi directory during this implicitly trusted session. */
	autoTrustOnReloadCwd?: string;
	/** Initial message to send on startup (can include @file content) */
	initialMessage?: string;
	/** Batch script to execute after the TUI is initialized. */
	initialBatch?: { script: string; args: string[] };
	/** Images to attach to the initial message */
	initialImages?: ImageContent[];
	/** Additional messages to send after the initial message */
	initialMessages?: string[];
	/** Force verbose startup (overrides quietStartup setting) */
	verbose?: boolean;
	/** TUI layout mode. */
	tuiMode?: TuiMode;
	/** Initial interactive theme setting for this invocation. */
	initialThemeSetting?: string;
	/** Terminal implementation. Defaults to the current process terminal. */
	terminal?: Terminal;
	/**
	 * Factory used to create additional agent runtimes for multi-tab sessions.
	 * When omitted the instance stays single-session (one tab, no tab bar).
	 */
	createRuntime?: CreateAgentSessionRuntimeFactory;
}

/** Share of the terminal height the command-palette overlay may take. */
const COMMAND_PALETTE_HEIGHT_PERCENT = 80;
/** Share of the terminal width the command-palette overlay may take. */
const COMMAND_PALETTE_WIDTH_PERCENT = 78;
/** Share of the terminal height the Tab Jump overlay may take; matches the palette's. */
const TAB_JUMP_HEIGHT_PERCENT = 80;
/** Share of the terminal width the Tab Jump overlay may take; matches the palette's. */
const TAB_JUMP_WIDTH_PERCENT = 78;
/** Share of the terminal's rows the Tab Jump list itself may show. */
const TAB_JUMP_MAX_ROWS_SHARE = 0.5;
/** Floor of visible rows the Tab Jump list keeps, so a short terminal still shows one. */
const TAB_JUMP_MIN_VISIBLE_ROWS = 5;
/** Fixed width of the quit dialog: one sentence and two buttons. */
const QUIT_CONFIRM_WIDTH = 72;
/**
 * Share of the terminal rows the tab bar may take before its chips collapse into
 * the overflow counts; the bar must not push the transcript off the screen.
 */
const TAB_BAR_MAX_ROWS_SHARE = 0.1;

// The command list the editor's autocomplete and the command palette share lives in
// `./mixcode/command-list.ts`, next to the palette that also reads it.

/**
 * Run agent work inside the console scope of the tab that owns it, so the lines the
 * work emits carry that tab's title in `/console-history`. A single-session instance
 * without a tab manager, and a harness driving one method on a hand-built `this`,
 * pass no tab and the work runs unwrapped.
 */
function runInTabConsole<T>(tab: AgentTab | undefined, fn: () => Promise<T>): Promise<T> {
	return tab ? runWithConsoleTab(tab.title, fn) : fn();
}

/** Tab id the inline widget state uses when the session runs without a tab manager. */
const SINGLE_SESSION_TAB_ID = "session";

/** How long the s/f queue-edit choice stays armed after the dequeue key. */
const QUEUE_EDIT_ARM_WINDOW_MS = 1000;

/** Delay before `/mark-done` reaches host extensions, so the user can leave the pane first. */
const MARK_DONE_SIGNAL_DELAY_MS = 5_000;

/** Prompt for the armed queue-edit choice, naming the keys the bindings currently carry. */
function queueEditArmMessage(): string {
	const steer = primaryKeyGlyphText("app.queueEdit.steer");
	const followUp = primaryKeyGlyphText("app.queueEdit.followUp");
	const cancel = primaryKeyGlyphText("app.queueEdit.cancel");
	return `${steer}: Steer · ${followUp}: Follow-up · ${cancel}: cancel`;
}

/** Columns the vim user-message preview keeps clear on the right, for the transcript scrollbar. */
const USER_MESSAGE_PREVIEW_RIGHT_MARGIN = 2;
/** Rows the preview leaves between itself and the dock below the transcript. */
const USER_MESSAGE_PREVIEW_BOTTOM_GAP_ROWS = 1;
/** Rows the preview's own frame spends on its borders. */
const USER_MESSAGE_PREVIEW_FRAME_ROWS = 2;

/**
 * True for the transcript blocks that render a user message. The alternate
 * screen's own prompt jump matches OSC 133 markers, which assistant replies
 * carry too; the block's type is the only place that tells a user message apart.
 */
function isUserMessageBlock(block: Component): block is UserMessageComponent {
	return block instanceof UserMessageComponent;
}

/** One tab reopened from the persisted startup layout. */
interface RestoredTab {
	id: string;
	title?: string;
	titleLocked?: boolean;
	unread: boolean;
}

/**
 * One Home roster row. A live tab carries `tab`; a persisted tab still being
 * restored has none yet, so the roster can list the whole layout on the first
 * frame instead of growing one tab at a time. `HomeRosterTab` is what selection
 * and the non-idle filter index against.
 */
interface HomeRosterEntry extends HomeRosterTab {
	tab?: AgentTab;
	loadingPhase?: TabLoadingPhase;
	/** Persisted title/colour, kept for a placeholder whose tab does not exist yet. */
	title?: string;
	color?: TabColorName;
}

/** Flattened blocks for the windowed transcript, with the child lists they were built from. */
interface TranscriptBlocksCache {
	documentChildren: readonly Component[];
	chatChildren: readonly Component[];
	documentLength: number;
	chatLength: number;
	blocks: Component[];
}

/** Draft the command palette replaced while it runs a command. */
interface PaletteCommandDraft {
	/**
	 * That draft with the paste markers expanded, which is what `/editor` reads: the palette
	 * overwrote the editor with the command text, so the editor no longer holds it.
	 */
	expandedText: string;
	/**
	 * Set by `/editor` once the external editor wrote, so the palette keeps that result, an
	 * emptied draft included, instead of restoring the draft it replaced.
	 */
	ownsEditor: boolean;
}

/**
 * A non-capturing overlay that takes itself down after a timeout. A newer `show`
 * supersedes the one on screen: the older timer sees the generation change and
 * leaves the newer card in place.
 */
class TransientOverlay {
	private generation = 0;
	private timer: NodeJS.Timeout | undefined;
	private handle: OverlayHandle | undefined;

	/** Show `component` for `durationMs`; `onExpire` runs only if this show is still current. */
	show(ui: TUI, component: Component, options: OverlayOptions, durationMs: number, onExpire: () => void): void {
		const generation = ++this.generation;
		this.handle = ui.showOverlay(component, options);
		const timer = setTimeout(() => {
			if (generation !== this.generation) return;
			onExpire();
			ui.requestRender();
		}, durationMs);
		timer.unref();
		this.timer = timer;
		ui.requestRender();
	}

	/** Drop the timer and hide the card. */
	hide(): void {
		if (this.timer !== undefined) {
			clearTimeout(this.timer);
			this.timer = undefined;
		}
		this.handle?.hide();
		this.handle = undefined;
	}
}

export class InteractiveMode {
	private runtimeHost: AgentSessionRuntime;
	private tabManager: TabManager | undefined;
	private tabBarContainer: Container | undefined;
	/** MixCode Home selection and filter; `active` means Home is the rendered surface. */
	private readonly homeSelection = createHomeSelection();
	/** Set while Home activation sits in the tab-switch queue, so a repeat cannot double-run it. */
	private homeActivationQueued = false;
	/** Extension packages the startup check found outdated; Home lists them above the roster. */
	private packageUpdates: string[] = [];
	/** Footer children parked while Home hides that per-agent chrome. */
	private homeParkedFooter: Component[] | undefined;
	/** Status-area children parked while Home hides them. */
	private homeParkedStatus: Component[] | undefined;
	private homeView: HomeView | undefined;
	/** Per-tab mapped transcript lines for the Home previews, keyed by tab id. */
	private readonly homeMessageCache = new Map<string, HomeSnapshot>();
	/** Last context reading, reused until the active session's messages or model change. */
	private contextUsageCache:
		| {
				session: AgentSession;
				source: readonly AgentMessage[];
				length: number;
				model: AgentSession["state"]["model"];
				value: ContextUsage | undefined;
		  }
		| undefined;
	/** Stopper for the interval that repaints the active tab's title shimmer. */
	private stopTabShimmerRedraw: (() => void) | undefined;
	/** Stopper for the interval that animates the working indicators drawn outside the editor. */
	private stopWorkingIndicatorRedraw: (() => void) | undefined;
	/** Stopper for the interval that repaints a loading chip's spinner. */
	private stopTabLoadingRedraw: (() => void) | undefined;
	/** Workdir that scopes the persisted open-tab layout. */
	private readonly tabsWorkdir: string;
	/** Vim-mode state used when no tab manager exists (single-session fallback). */
	private fallbackVimState: VimTabState | undefined;
	/** Toast slot used when no tab manager exists (single-session fallback). */
	private fallbackToastHost: ToastHost | undefined;
	/** Toast overlay slot; a newer toast replaces the card on screen. */
	private readonly toastOverlay = new TransientOverlay();
	/** Vim user-message preview slot; a newer preview replaces the card on screen. */
	private readonly userMessagePreviewOverlay = new TransientOverlay();

	/** Set once the startup restore has been attempted; gates layout persistence. */
	private tabsRestoreAttempted = false;
	/** Shared tab layout: owns delta-aware publishing and peer sync. */
	private sharedTabLayout: SharedTabLayout | undefined;
	/** Messages the shared layout already reported, so a repeating sync failure warns once. */
	private readonly sharedLayoutErrorShown = new Set<string>();
	/** Serializes async tab transitions (activation, create, close). */
	private tabSwitchQueue: Promise<void> = Promise.resolve();
	private renderer: TuiMainScreen | TuiAltScreen;
	private ui: TUI;
	private mainScreenRenderState: TuiMainScreenRenderState | undefined;
	private loadedResourcesContainer: Container;
	private chatContainer: Container;
	private documentContainer: Container;
	/** Fullscreen transcript: renders only the visible blocks of the chat. */
	private windowedTranscript: WindowedTranscript;
	private transcriptScrollView: TuiLayouts.ScrollView | undefined;
	private transcriptBlocksCache: TranscriptBlocksCache | undefined;
	private fullscreenLayoutRoot: Component | undefined;
	private pendingMessagesContainer: Container;
	private statusContainer: Container;
	private defaultEditor: MixcodePromptEditor;
	private editor: EditorComponent;
	private editorComponentFactory: EditorFactory | undefined;
	private autocompleteProvider: AutocompleteProvider | undefined;
	private autocompleteProviderWrappers: AutocompleteProviderFactory[] = [];
	private fdPath: string | undefined;
	private editorContainer: Container;
	private activeSelectorToken?: object;
	private activeSelectorDispose?: () => void;
	private footer: FooterComponent;
	private footerContainer: Container;
	private footerDataProvider: FooterDataProvider;
	// Stored so the same manager can be injected into custom editors, selectors, and extension UI.
	private keybindings: KeybindingsManager;
	private version: string;
	private isInitialized = false;
	private onInputCallback?: (text: string) => void;
	private pendingUserInputs: string[] = [];
	private activeStatusIndicator: StatusIndicator | undefined = undefined;
	private activeWorkingIndicatorEmbedded = false;
	private readonly idleStatus = new IdleStatus();
	private workingMessage: string | undefined = undefined;
	private workingVisible = true;
	private workingIndicatorOptions: WorkingIndicatorOptions | undefined = undefined;
	private readonly defaultWorkingMessage = "Working";
	/** Extension label replacing every hidden thinking block; absent by default. */
	private hiddenThinkingLabel: string | undefined = undefined;

	private lastSigintTime = 0;
	private lastEscapeTime = 0;
	private changelogMarkdown: string | undefined = undefined;
	/** Console notice panel: the box bridged console lines are painted into. */
	private consoleNotice:
		| { component: ConsoleNotice; handle: OverlayHandle; unsubscribe: () => void; width: number }
		| undefined;
	private startupNoticesShown = false;
	private anthropicSubscriptionWarningShown = false;

	// Status line tracking (for mutating immediately-sequential status updates)
	private lastStatusSpacer: Spacer | undefined = undefined;
	private lastStatusText: Text | undefined = undefined;
	private managedToolStatusStarted = false;

	// Streaming message tracking
	private streamingComponent: AssistantMessageComponent | undefined = undefined;
	private readonly entriesRenderedByBoundaryCompaction = new Set<string>();
	private streamingMessage: AssistantMessage | undefined = undefined;

	// Tool execution tracking: toolCallId -> component
	private pendingTools = new Map<string, ToolExecutionComponent>();

	// Tool output expansion state
	private toolOutputExpanded = false;

	// Thinking block visibility state
	private hideThinkingBlock = false;
	private outputPad = 1;
	private readonly mermaidMarkdownTransformer: MarkdownTransformer = createMermaidMarkdownTransformer({
		getMode: () => this.settingsManager.getMermaidRenderingMode(),
		theme,
	});

	// Skill commands: command name -> skill file path
	private skillCommands = new Map<string, string>();

	// Agent subscription unsubscribe function
	private unsubscribe?: () => void;
	private signalCleanupHandlers: Array<() => void> = [];

	// Track if editor is in bash mode (text starts with !)
	private isBashMode = false;

	// Track current bash execution component
	private bashComponent: BashExecutionComponent | undefined = undefined;

	// Track pending bash components (shown in pending area, moved to chat on submit)
	private pendingBashComponents: BashExecutionComponent[] = [];

	// Auto-compaction state
	private autoCompactionEscapeHandler?: () => void;

	// Auto-retry state
	private retryEscapeHandler?: () => void;

	/** Parked compaction messages, one queue per tab. */
	private readonly compactionQueues = new Map<string, CompactionQueuedMessage[]>();
	/** Follow-up rounds and steer/follow-up queue bookkeeping (see core/mixcode/follow-up/). */
	private readonly followUpStates = new Map<string, FollowUpQueueState>();
	/** True from the moment a manual compact is requested until compaction_end. */
	private compactionClaimed = false;
	/** Manual compaction model labels belong to their originating sessions. */
	private readonly compactionModelRefs = new Map<AgentSession, string>();
	/** Deadline of the armed queue-edit choice (s/f) after the dequeue key; 0 = unarmed. */
	private queueEditArmDeadline = 0;
	/** Timer that drops the choice toast when the arm window ends. */
	private queueEditArmTimer: NodeJS.Timeout | undefined;
	/** Prompt painted while the choice is armed, so the window clears the toast it showed. */
	private queueEditArmMessage: string | undefined;

	// Shutdown state
	private shutdownRequested = false;

	/** The `/bug` hint is shown at most once per session so error output stays readable. */
	private bugReportHintShown = false;

	// Extension UI state
	/** Pending extension interactions per tab: only the tab on screen mounts one. */
	private readonly tabInteractions = new Map<string, TabInteraction[]>();
	private extensionTerminalInputSubscriptions = new Set<ExtensionTerminalInputSubscription>();
	/** Listener that answers the app's chrome shortcuts above a focused extension dialog. */
	private extensionDialogShortcutUnsubscribe?: () => void;

	// Extension widgets (components rendered above/below the editor)
	private extensionWidgetsAbove = new Map<string, Component & { dispose?(): void }>();
	private extensionWidgetsBelow = new Map<string, Component & { dispose?(): void }>();
	private dockWidgets!: DockWidgetBudget;
	private widgetPanel!: WidgetPanelComponent;

	// Custom footer from extension (undefined = use built-in footer)
	private customFooter: (Component & { dispose?(): void }) | undefined = undefined;
	private customFooterFactory: ExtensionFooterFactory | undefined = undefined;
	private customHeaderFactory: ExtensionHeaderFactory | undefined = undefined;
	/** Per-tab extension UI (widgets, footer/header, statuses), swapped on tab switch. */
	private readonly tabUi = new Map<string, TabExtensionUi>();
	/** Tab whose extension UI is currently mounted; used to capture state on switch. */
	private activeTabIdForUi: string | undefined = undefined;
	/**
	 * Sessions whose extensions are already bound. Created on first use so a host
	 * that only supplies a subset of this class (tests) still works.
	 */
	private boundSessions?: WeakSet<AgentSession>;
	/** Binds in flight, so a tab is bound once however many paths ask for it. */
	private readonly bindingSessions = new Map<AgentSession, Promise<void>>();
	/** Tabs waiting for a background bind, oldest request first. */
	private readonly pendingTabBinds: AgentTab[] = [];
	/** Set while the bind worker drains `pendingTabBinds`. */
	private bindWorkerRunning = false;
	/**
	 * Tabs a startup restore still has to build, in persisted order. The tab bar lists
	 * them as loading chips before their runtimes exist, and Home lists the whole
	 * layout from the first frame; `phase` is what the in-flight tab is doing.
	 */
	private restoringTabs: Array<{ id: string; title: string; color?: TabColorName; phase?: TabLoadingPhase }> = [];
	/** Tabs whose startup resources block is still to be painted on their next focus. */
	private readonly pendingResourcesBlocks = new Set<string>();
	/** Cached transcript components per tab, reused when the tab is unchanged. */
	private readonly tabTranscript = new Map<string, { signature: string; chat: Component[]; loaded: Component[] }>();
	/** Composer text parked with ctrl+c, per tab id, newest first. */
	private readonly stashedPrompts = new Map<string, string[]>();
	/** Session-only inline widget mode and collapse state, per tab id. */
	private readonly inlineWidgetTabStates = new Map<string, InlineWidgetTabState>();
	/** Per-tab side-panel state; a new tab starts closed and nothing is persisted. */
	private readonly widgetPanelTabStates = new Map<string, WidgetPanelTabState>();
	private inlineWidgets!: InlineWidgetsComponent;
	/** MixCode settings (`mixcode_settings.json`), with defaults applied. */
	private mixcodeSettings: MixCodeSettings = {
		ui: {
			inlineWidgets: DEFAULT_INLINE_WIDGETS,
			boxedHiddenThinking: DEFAULT_BOXED_HIDDEN_THINKING,
			icons: { mode: DEFAULT_ICON_MODE },
			showResponseModelNotices: DEFAULT_SHOW_RESPONSE_MODEL_NOTICES,
		},
	};
	/** Set when the settings file could not be read; reported once the UI is up. */
	private mixcodeSettingsError: string | undefined;

	// Header container that holds the built-in or custom header
	private headerContainer: Container;

	// Built-in header (logo + keybinding hints + changelog)
	private builtInHeader: Component | undefined = undefined;

	// Custom header from extension (undefined = use built-in header)
	private customHeader: (Component & { dispose?(): void }) | undefined = undefined;

	private options: InteractiveModeOptions;
	private readonly onRightClickPaste = (): void => {
		void this.handleRightClickPaste();
	};
	private autoTrustOnReloadCwd: string | undefined;
	private themeController: InteractiveThemeController;
	private paletteCommandDraft: PaletteCommandDraft | undefined;

	// Convenience accessors
	private get session(): AgentSession {
		return this.runtimeHost.session;
	}
	private get agent() {
		return this.session.agent;
	}
	private get sessionManager() {
		return this.session.sessionManager;
	}
	private get settingsManager() {
		return this.session.settingsManager;
	}

	constructor(runtimeHost: AgentSessionRuntime, options: InteractiveModeOptions = {}) {
		this.runtimeHost = runtimeHost;
		setCapabilityOverrides(this.settingsManager.getTerminalCapabilityOverrides());
		const tuiMode = options.tuiMode ?? this.settingsManager.getTuiMode();
		this.options = { ...options, tuiMode };
		this.autoTrustOnReloadCwd = options.autoTrustOnReloadCwd;
		// Key the persisted tab layout on the startup workdir, so the same value
		// is used for both writing and restoring regardless of the active tab.
		this.tabsWorkdir = runtimeHost.cwd;
		if (options.createRuntime) {
			this.tabManager = new TabManager({
				initialRuntime: runtimeHost,
				initialTitle: this.session.sessionManager.getSessionName() ?? "Agent-01",
				createRuntime: options.createRuntime,
				agentDir: runtimeHost.services.agentDir,
				onTabsChanged: () => {
					clampHomeSelectedTabIndex(this.homeSelection, this.homeRoster());
					this.ui.requestRender();
				},
				onLayoutChanged: () => this.persistOpenTabs(),
				onTabClosed: (tabId, removedIndex) => {
					adjustHomeSelectionAfterClose(this.homeSelection, this.homeRoster(), removedIndex);
					this.homeMessageCache.delete(tabId);
					clearHomeTabCache(tabId);
					this.followUpStates.delete(tabId);
					this.compactionQueues.delete(tabId);
					this.stashedPrompts.delete(tabId);
				},
				// Ring the bell when a tab the user is not looking at finishes, so a
				// background result is noticeable with the terminal unfocused.
				onBackgroundCompletion: () => this.ui.terminal.write("\x07"),
				configureRuntime: (runtime) => this.bindRuntimeCallbacks(runtime),
			});
		} else {
			this.bindRuntimeCallbacks(this.runtimeHost);
		}
		// Built here, once the TabManager exists; start() runs after the startup restore
		// so the first published baseline is the settled layout.
		if (this.tabManager) {
			this.sharedTabLayout = new SharedTabLayout({
				manager: this.tabManager,
				workdir: this.tabsWorkdir,
				sessionDir: this.runtimeHost.session.sessionManager.getSessionDir(),
				enqueue: (op) => this.enqueueTabSwitch(op),
				// Runs inside the shared layout's queued reconcile, so switch directly.
				refreshActiveTab: async () => {
					const manager = this.tabManager;
					if (manager) await this.switchActiveTab(manager.getActive());
				},
				disposeTabUi: (id) => this.disposeTabUi(id),
				// A peer-opened tab is never visited, so binding it is what clears its loading
				// chip; the restored tabs' worker serializes these binds the same way.
				onTabOpened: (tab) => this.queueTabBind(tab),
				onError: (error) => {
					const msg = error instanceof Error ? error.message : String(error);
					if (!this.sharedLayoutErrorShown.has(msg)) {
						this.sharedLayoutErrorShown.add(msg);
						this.showWarning(`Tab sync: ${msg}`);
					}
				},
			});
		}
		this.activeTabIdForUi = this.tabManager?.getActive().id;
		this.version = VERSION;
		try {
			this.mixcodeSettings = loadMixCodeSettings(mixcodeSettingsFilePath());
		} catch (error) {
			this.mixcodeSettingsError = error instanceof Error ? error.message : String(error);
		}
		this.renderer = createInteractiveTui({
			tuiMode,
			showHardwareCursor: this.settingsManager.getShowHardwareCursor(),
			logDirectory: getAgentDir(),
			terminal: options.terminal,
			onRightClickPaste: this.onRightClickPaste,
			fullscreenCopyOnSelect: this.settingsManager.getFullscreenCopyOnSelect(),
			onCopyResult: (result) => this.notifyCopyResult(result),
			selection: this.mouseSelectionOptions(),
		});
		this.ui = createInteractiveTuiReference(() => this.renderer);
		this.ui.setClearOnShrink(this.settingsManager.getClearOnShrink());
		this.headerContainer = new Container();
		this.loadedResourcesContainer = new Container();
		this.chatContainer = new Container();
		this.documentContainer = new Container();
		this.inlineWidgets = new InlineWidgetsComponent({
			widgets: () => ({ above: this.extensionWidgetsAbove, below: this.extensionWidgetsBelow }),
			// The side panel owns the widgets while it is visible, so the chat-tail block
			// stands down until it closes again; a panel state left open in a mode or width
			// that cannot show it keeps the tail.
			state: () => (this.widgetPanelVisible() ? undefined : this.inlineWidgetState()),
			viewportRows: () => this.inlineViewportRows(),
		});
		this.buildDocumentChildren();
		// The fullscreen transcript is the same document, but the scroll view's child
		// is windowed: only visible message blocks render, the rest contribute an
		// estimated height so the scroll range still spans the whole conversation.
		this.windowedTranscript = new WindowedTranscript({
			blocks: () => this.transcriptBlocks(),
		});
		this.pendingMessagesContainer = new Container();
		this.statusContainer = new Container();
		this.dockWidgets = new DockWidgetBudget({
			widgets: () => ({ above: this.extensionWidgetsAbove, below: this.extensionWidgetsBelow }),
			chromeRows: (width) => this.dockChromeRows(width),
			viewportRows: () => this.renderer.terminal.rows,
			// The dock shows no widget rows in inline mode (the chat tail has them), on
			// MixCode Home, or while the side panel owns them on a wide enough terminal.
			widgetsHidden: () =>
				this.inlineWidgetState()?.enabled === true || this.homeSelection.active || this.widgetPanelVisible(),
		});
		this.widgetPanel = new WidgetPanelComponent({
			widgets: () => ({ above: this.extensionWidgetsAbove, below: this.extensionWidgetsBelow }),
			state: () => this.widgetPanelState(),
			terminalWidth: () => this.ui.terminal.columns,
			viewportHeight: () => this.transcriptScrollView?.viewportHeight ?? 0,
			// A pending extension interaction takes the wheel with the chat.
			interactive: () => !this.extensionUiPending(),
			copySelection: (text) => this.copyWidgetPanelSelection(text),
		});
		this.keybindings = KeybindingsManager.create();
		setKeybindings(this.keybindings);
		const editorPaddingX = this.settingsManager.getEditorPaddingX();
		const autocompleteMaxVisible = this.settingsManager.getAutocompleteMaxVisible();
		this.defaultEditor = new MixcodePromptEditor(this.ui, getEditorTheme(), this.keybindings, {
			paddingX: editorPaddingX,
			autocompleteMaxVisible,
			embedWorkingStatus: true,
		});
		this.defaultEditor.getPlaceholder = () => composerPlaceholder(this.composerContext());
		this.defaultEditor.setCardChrome(() => editorCardChrome(this.composerContext()));
		this.editor = this.defaultEditor;
		this.editorContainer = new Container();
		this.editorContainer.addChild(this.editor as Component);
		this.footerDataProvider = new FooterDataProvider(this.sessionManager.getCwd());
		this.footer = new MixcodeDockFooter(
			this.session,
			this.footerDataProvider,
			() => this.dockMetaData(),
			(action) => this.openMetaPicker(action),
		);
		this.footer.setAutoCompactEnabled(this.session.autoCompactionEnabled);
		this.footerContainer = new Container();
		this.footerContainer.addChild(this.footer);

		// Load hide thinking block setting
		this.hideThinkingBlock = this.settingsManager.getHideThinkingBlock();
		this.outputPad = this.settingsManager.getOutputPad();

		// Register themes from resource loader and initialize
		setRegisteredThemes(this.session.resourceLoader.getThemes().themes);
		this.themeController = new InteractiveThemeController(this.ui, {
			getSettingsManager: () => this.settingsManager,
			showError: (message) => this.showError(message),
			onChanged: () => this.updateEditorBorderColor(),
			initialThemeSetting: options.initialThemeSetting,
		});
	}

	private getAutocompleteSourceTag(sourceInfo?: SourceInfo): string | undefined {
		if (!sourceInfo) {
			return undefined;
		}

		const scopePrefix = sourceInfo.scope === "user" ? "u" : sourceInfo.scope === "project" ? "p" : "t";
		const source = sourceInfo.source.trim();

		if (source === "auto" || source === "local" || source === "cli") {
			return scopePrefix;
		}

		if (source.startsWith("npm:")) {
			return `${scopePrefix}:${source}`;
		}

		const gitSource = parseGitUrl(source);
		if (gitSource) {
			const ref = gitSource.ref ? `@${gitSource.ref}` : "";
			return `${scopePrefix}:git:${gitSource.host}/${gitSource.path}${ref}`;
		}

		return scopePrefix;
	}

	private prefixAutocompleteDescription(description: string | undefined, sourceInfo?: SourceInfo): string | undefined {
		const sourceTag = this.getAutocompleteSourceTag(sourceInfo);
		if (!sourceTag) {
			return description;
		}
		return description ? `[${sourceTag}] ${description}` : `[${sourceTag}]`;
	}

	private getBuiltInCommandConflictDiagnostics(extensionRunner: ExtensionRunner): ResourceDiagnostic[] {
		const builtinNames = new Set(BUILTIN_SLASH_COMMANDS.map((command) => command.name));
		return extensionRunner
			.getRegisteredCommands()
			.filter((command) => builtinNames.has(command.name))
			.map((command) => ({
				type: "warning" as const,
				message:
					command.invocationName === command.name
						? `Extension command '/${command.name}' conflicts with built-in interactive command. Skipping in autocomplete.`
						: `Extension command '/${command.name}' conflicts with built-in interactive command. Available as '/${command.invocationName}'.`,
				path: command.sourceInfo.path,
			}));
	}

	/**
	 * The command-list dependencies of this instance.
	 */
	private static commandSource(mode: InteractiveMode): CommandSource {
		return {
			session: mode.session,
			settingsManager: mode.settingsManager,
			skillCommands: mode.skillCommands,
			describe: (description, sourceInfo) => mode.prefixAutocompleteDescription(description, sourceInfo),
			loginProviders: () => mode.getLoginProviderOptions(),
			tabArguments: () => mode.getTabArgumentOptions(),
			workspaceNames: () => mode.getWorkspaceNames(),
			widgetKeys: () => mode.getWidgetKeys(),
		};
	}

	private createBaseAutocompleteProvider(): AutocompleteProvider {
		return new CombinedAutocompleteProvider(
			collectSlashCommands(InteractiveMode.commandSource(this)),
			this.sessionManager.getCwd(),
			this.fdPath,
		);
	}

	private setupAutocompleteProvider(): void {
		let provider = this.createBaseAutocompleteProvider();
		const triggerCharacters: string[] = [];
		for (const wrapProvider of this.autocompleteProviderWrappers) {
			provider = wrapProvider(provider);
			triggerCharacters.push(...(provider.triggerCharacters ?? []));
		}
		if (triggerCharacters.length > 0) {
			provider.triggerCharacters = [...new Set(triggerCharacters)];
		}

		this.autocompleteProvider = provider;
		this.defaultEditor.setAutocompleteProvider(provider);
		if (this.editor !== this.defaultEditor) {
			this.editor.setAutocompleteProvider?.(provider);
		}
	}

	private showStartupNoticesIfNeeded(): void {
		if (this.startupNoticesShown) {
			return;
		}
		this.startupNoticesShown = true;

		if (!this.changelogMarkdown) {
			return;
		}

		if (this.chatContainer.children.length > 0) {
			this.chatContainer.addChild(new Spacer(1));
		}
		this.chatContainer.addChild(new DynamicBorder());
		if (this.settingsManager.getCollapseChangelog()) {
			const versionMatch = this.changelogMarkdown.match(/##\s+\[?(\d+\.\d+\.\d+)\]?/);
			const latestVersion = versionMatch ? versionMatch[1] : this.version;
			const condensedText = `Updated to v${latestVersion}. Use ${theme.bold("/changelog")} to view full changelog.`;
			this.chatContainer.addChild(new Text(condensedText, 1, 0));
		} else {
			this.chatContainer.addChild(new Text(theme.bold(theme.fg("accent", "What's New")), 1, 0));
			this.chatContainer.addChild(new Spacer(1));
			this.chatContainer.addChild(
				new Markdown(this.changelogMarkdown.trim(), 1, 0, this.getMarkdownThemeWithSettings()),
			);
			this.chatContainer.addChild(new Spacer(1));
		}
		this.chatContainer.addChild(new DynamicBorder());
	}

	/**
	 * Surfaces a fullscreen drag may select text inside: the transcript, the prompt card and the notice
	 * panel. The closures read the live components, so they survive a renderer swap.
	 */
	private mouseSelectionOptions(): TuiSelectionOptions {
		return createMouseSelectionOptions({
			chat: () => (this.homeSelection.active ? undefined : this.transcriptScrollView),
			input: () => this.editorContainer,
			notice: () => this.consoleNotice?.component,
			modalOpen: () => this.ui.hasCapturingOverlay(),
			cueRow: (row) =>
				this.windowedTranscript
					.componentPathAtRow(row)
					.some((entry) => hasPointerCueAt(entry.component, entry.row)),
		});
	}

	private mountInteractiveTui(tui: TuiMainScreen | TuiAltScreen, components: readonly Component[]): void {
		for (const component of components) tui.addChild(component);
		if (TuiLayouts.isViewportTUI(tui)) {
			if (!this.fullscreenLayoutRoot) throw new Error("Fullscreen layout is not initialized");
			tui.setLayoutRoot(this.fullscreenLayoutRoot);
		}
	}

	private stopInteractiveTui(fullscreenExitOutput: FullscreenExitOutput): void {
		if (this.renderer.mode === "fullscreen" && fullscreenExitOutput === "transcript") {
			while (this.renderer.hasOverlayEntries) this.renderer.hideOverlay();
			this.switchTuiMode("regular", false, false);
			this.renderer.renderNow();
		}
		this.ui.stop({ preserveScreen: this.renderer.mode === "fullscreen" });
	}

	private switchTuiMode(mode: TuiMode, restoreProgress = true, startRenderer = true): boolean {
		const previousUi = this.renderer;
		if (mode === previousUi.mode) return true;
		if (previousUi.hasOverlayEntries) return false;

		const components = [...previousUi.children];
		const focus = previousUi.getFocusedComponent();
		const terminal = previousUi.terminal;
		const showHardwareCursor = previousUi.getShowHardwareCursor();
		const clearOnShrink = previousUi.getClearOnShrink();
		const onDebug = previousUi.onDebug;
		if (previousUi instanceof TuiMainScreen) {
			this.mainScreenRenderState = previousUi.captureRenderState();
		}

		previousUi.stop({ preserveScreen: true });
		previousUi.setFocus(null);
		previousUi.clear();
		if (TuiLayouts.isViewportTUI(previousUi)) previousUi.setLayoutRoot(undefined);

		const nextUi = createInteractiveTui({
			tuiMode: mode,
			showHardwareCursor,
			logDirectory: getAgentDir(),
			terminal,
			onRightClickPaste: this.onRightClickPaste,
			fullscreenCopyOnSelect: this.settingsManager.getFullscreenCopyOnSelect(),
			onCopyResult: (result) => this.notifyCopyResult(result),
			selection: this.mouseSelectionOptions(),
		});
		nextUi.setClearOnShrink(clearOnShrink);
		nextUi.onDebug = onDebug;
		if (nextUi instanceof TuiMainScreen && this.mainScreenRenderState) {
			nextUi.restoreRenderState(this.mainScreenRenderState);
		}
		this.renderer = nextUi;
		this.options.tuiMode = mode;
		this.mountInteractiveTui(nextUi, components);
		nextUi.invalidate();
		nextUi.setFocus(focus);
		// Leaving fullscreen unmounts the transcript viewport the modal surface drives.
		this.leaveVimModeIfUnavailable();
		if (!startRenderer) return true;
		nextUi.start();
		this.themeController.rebindTui();
		this.rebindExtensionTerminalInputListeners();
		this.registerExtensionDialogShortcutListener();
		if (
			restoreProgress &&
			this.settingsManager.getShowTerminalProgress() &&
			(this.session.isStreaming || this.session.isCompacting)
		) {
			terminal.setProgress(true);
		}
		return true;
	}

	async init(): Promise<void> {
		if (this.isInitialized) return;

		this.registerSignalHandlers();

		// Load changelog (only show new entries, skip for resumed sessions)
		this.changelogMarkdown = this.getChangelogForDisplay();

		if (this.session.scopedModels.length > 0 && (this.options.verbose || !this.settingsManager.getQuietStartup())) {
			const modelList = this.session.scopedModels
				.map((sm) => {
					const thinkingStr = sm.thinkingLevel ? `:${sm.thinkingLevel}` : "";
					return `${sm.model.id}${thinkingStr}`;
				})
				.join(", ");
			const cycleKeys = this.keybindings.getKeys("app.model.cycleForward");
			const cycleHint =
				cycleKeys.length > 0
					? theme.fg("muted", ` (${formatKeyText(cycleKeys.join("/"), { capitalize: true })} to cycle)`)
					: "";
			console.log(theme.fg("dim", `Model scope: ${modelList}${cycleHint}`));
		}

		// Keep one component tree and remount it when changing renderers.
		// Initialize with the default spacer.
		this.requestWidgetRender();
		const viewport = createChatViewport({
			document: this.windowedTranscript,
			pendingMessages: this.pendingMessagesContainer,
			status: this.statusContainer,
			widgetsAbove: this.dockWidgets.above,
			editor: this.editorContainer,
			widgetsBelow: this.dockWidgets.below,
			footer: this.footerContainer,
			// Vim mode is a reading surface: its rows go to the transcript instead.
			widgetsVisible: () => this.dockWidgetsVisible(),
			// The side panel splits the transcript rows while it is visible; the
			// composer dock below keeps the full width either way.
			panel: { component: this.widgetPanel, visible: (width) => this.widgetPanel.isOpen(width) },
			scrollbar: this.settingsManager.getFullscreenScrollbar(),
			scrollbarTrackStyle: (text) => theme.fg("scrollbarTrack", text),
			scrollbarThumbStyle: (text) => theme.fg("scrollbarThumb", text),
		});
		this.transcriptScrollView = viewport.transcript;
		this.homeView = new HomeView({
			getModel: () => this.getHomeViewModel(),
			// The scroll view's viewport is the row budget; before the first layout
			// a conservative estimate keeps the page from ever overflowing it.
			getHeight: () => this.transcriptScrollView?.viewportHeight || this.homeHeightFallback(),
			onAction: (action) => void this.runHomeAction(action),
		});
		this.tabBarContainer = new Container();
		this.tabBarContainer.addChild(
			new TabBar(
				() => this.getTabBarModel(),
				(id) => {
					// A chip click is chrome, and chrome is dropped while another surface owns the
					// keyboard: a floating overlay or a selector in the editor slot. Acting behind either
					// would switch tabs under a surface the user is working in.
					if (this.ui.hasCapturingOverlay() || this.activeSelectorToken !== undefined) return;
					// Re-clicking the chip of the tab already focused opens Tab Jump instead of
					// re-activating it: the chip is then the second way into the switcher.
					if (id === (this.homeSelection.active ? HOME_TAB_ID : this.tabManager?.getActive().id)) {
						this.showTabJump();
						return;
					}
					void this.activateTabById(id);
				},
			),
		);
		this.fullscreenLayoutRoot = new TuiLayouts.VStack([
			{ component: this.tabBarContainer, basis: "auto", grow: 0, shrink: 1, minSize: 0 },
			{ component: viewport.root, basis: 0, grow: 1, shrink: 1, minSize: 1 },
		]);
		this.mountInteractiveTui(this.renderer, [
			this.tabBarContainer,
			this.documentContainer,
			this.pendingMessagesContainer,
			this.statusContainer,
			this.dockWidgets.above,
			this.editorContainer,
			this.dockWidgets.below,
			this.footerContainer,
		]);
		// Accept text while startup completes, but only enable interrupt, exit, and submission feedback.
		this.defaultEditor.onAction("app.clear", () => this.handleCtrlC());
		this.defaultEditor.onCtrlD = () => this.handleCtrlD();
		this.defaultEditor.onSubmit = (text) => this.handleStartupSubmit(text);
		this.ui.setFocus(this.editor);

		// Start the UI before initializing extensions so session_start handlers can use interactive dialogs
		this.ui.start();
		// The TUI can paint console lines from here on: anything an extension logged while
		// it loaded flushes into the notice panel, and later lines go there instead of onto
		// the raw tty.
		wireConsoleSink((line) => this.showConsoleNotice(line));
		this.isInitialized = true;
		// The tab bar only exists alongside a tab manager; without one there is no
		// chip to shimmer, so no repaint loop is started. Home carries no wave, and
		// nothing wears the wave while it is the rendered surface.
		if (this.tabManager) {
			this.stopTabShimmerRedraw = bindActiveTabShimmerRedraw(
				() => this.ui.requestRender(),
				() => (this.homeSelection.active ? undefined : this.tabManager?.activeTab()?.activatedAt),
			);
			// A working indicator drawn outside the editor changes with nothing but the
			// clock, so it brings its own repaint loop.
			this.stopWorkingIndicatorRedraw = bindWorkingIndicatorRedraw(
				() => this.ui.requestRender(),
				() => this.workingIndicatorAnimating(),
			);
			// A loading chip spins off the wall clock, so it needs a repaint while any
			// tab is still coming up: the persisted chips before their runtimes exist,
			// then each restored tab until it is bound.
			this.stopTabLoadingRedraw = bindTabLoadingRedraw(
				() => this.ui.requestRender(),
				() => this.restoringTabs.length > 0 || (this.tabManager?.list().some((tab) => tab.loading) ?? false),
			);
		}
		if (this.mixcodeSettingsError) {
			this.showWarning(this.mixcodeSettingsError);
			this.mixcodeSettingsError = undefined;
		}

		await this.themeController.applyFromSettings();

		// Add header with keybindings from config (unless silenced)
		if (this.options.verbose || !this.settingsManager.getQuietStartup()) {
			const logo = theme.bold(theme.fg("accent", APP_NAME)) + theme.fg("dim", ` v${this.version}`);

			// Build startup instructions using keybinding hint helpers
			const hint = (keybinding: AppKeybinding, description: string) => keyHint(keybinding, description);

			const expandedInstructions = [
				hint("app.interrupt", "to interrupt"),
				hint("app.clear", "to clear"),
				rawKeyHint(`${keyText("app.clear")} twice`, "to exit"),
				hint("app.exit", "to exit (empty)"),
				hint("app.palette", "for the command palette"),
				hint("app.quit", "to quit"),
				hint("app.suspend", "to suspend"),
				keyHint("tui.editor.deleteToLineEnd", "to delete to end"),
				hint("app.thinking.cycle", "to cycle thinking level"),
				rawKeyHint(keyText("app.model.cycleBackward"), "to cycle models back"),
				hint("app.model.select", "to select model"),
				hint("app.tools.expand", "to expand tools"),
				// The thinking-block toggle is not listed: `app.tab.jump` holds its `ctrl+t`
				// default, and a compact hint row must not name a chord that does nothing here.
				// `/hotkeys` still reports it, marked as taken.
				hint("app.tab.jump", "to jump between tabs"),
				hint("app.editor.external", "for external editor"),
				rawKeyHint("/", "for commands"),
				rawKeyHint("!", "to run bash"),
				rawKeyHint("!!", "to run bash (no context)"),
				hint("app.message.followUp", "to queue follow-up"),
				hint("app.message.dequeue", "to edit all queued messages"),
				hint("app.clipboard.pasteImage", "to paste image (with text fallback)"),
				rawKeyHint("drop files", "to attach"),
			].join("\n");
			const compactInstructions = [
				hint("app.interrupt", "interrupt"),
				rawKeyHint(`${keyText("app.clear")}/${keyText("app.exit")}`, "clear/exit"),
				rawKeyHint("/", "commands"),
				rawKeyHint("!", "bash"),
				hint("app.tools.expand", "more"),
			].join(theme.fg("muted", " · "));
			const compactOnboarding = theme.fg(
				"dim",
				`Press ${keyText("app.tools.expand")} to show full startup help and loaded resources.`,
			);
			const onboarding = theme.fg(
				"dim",
				`Pi can explain its own features and look up its docs. Ask it how to use or extend Pi.`,
			);
			this.builtInHeader = new ExpandableText(
				() => `${logo}\n${compactInstructions}\n${compactOnboarding}\n\n${onboarding}`,
				() => `${logo}\n${expandedInstructions}\n\n${onboarding}`,
				this.getStartupExpansionState(),
				1,
				0,
			);

			// Setup UI layout
			this.headerContainer.addChild(new Spacer(1));
			this.headerContainer.addChild(this.builtInHeader);
			this.headerContainer.addChild(new Spacer(1));
		} else {
			// Minimal header when silenced
			this.builtInHeader = new Text("", 0, 0);
			this.headerContainer.addChild(this.builtInHeader);
		}
		this.ui.requestRender();

		// Ensure fd and rg are available after mounting the TUI (downloads if missing, adds to PATH via getBinDir)
		// so slow downloads do not make startup appear frozen.
		// Both are needed: fd for autocomplete, rg for grep tool and bash commands.
		const [fdPath] = await Promise.all([
			ensureTool("fd", (status) => this.showManagedToolStatus(status)),
			ensureTool("rg", (status) => this.showManagedToolStatus(status)),
		]);
		this.fdPath = fdPath;

		// Enable the remaining input handlers only after managed-tool setup completes.
		this.setupKeyHandlers();
		this.setupEditorSubmitHandler();
		this.ui.requestRender();

		// Initialize extensions first so resources are shown before messages
		await this.rebindCurrentSession();

		// Render initial messages AFTER showing loaded resources
		this.renderInitialMessages();

		// Set up theme file watcher
		onThemeChange(() => {
			this.ui.invalidate();
			this.updateEditorBorderColor();
			this.ui.requestRender();
		});

		// Set up git branch watcher (uses provider instead of footer)
		this.footerDataProvider.onBranchChange(() => {
			this.ui.requestRender();
		});

		// Initialize available provider count for footer display
		await this.updateAvailableProviderCount();

		// Reopen the previous run's tabs when this is a fresh session at startup.
		await this.restoreOpenTabsOnStartup();

		// SharedTabLayout.start() seeds the union snapshot and begins peer polling.
		// It runs once the startup restore has settled, so the first published baseline
		// is the restored layout, not the transient startup tab, and the first poll cannot
		// race the loader into opening a tab it is about to open itself. publish() is a
		// no-op before start(), so persistOpenTabs() calls during the restore are ignored.
		this.sharedTabLayout?.start();

		// Startup keeps the fork's restored tab focus; Home is reached with `left`, the tab
		// cycle, or the home chip.

		// Flush the completed startup state before loading the remaining syntax grammars.
		this.ui.renderNow();
		void loadAllHighlightLanguages().then(() => {
			if (!this.isInitialized) return;
			this.flushTranscriptRenderCaches();
			this.ui.requestRender();
		});
	}

	/**
	 * Update terminal title with session name and cwd.
	 */
	private updateTerminalTitle(): void {
		const cwdBasename = path.basename(this.sessionManager.getCwd());
		const sessionName = this.sessionManager.getSessionName();
		if (sessionName) {
			this.ui.terminal.setTitle(`${APP_TITLE} - ${sessionName} - ${cwdBasename}`);
		} else {
			this.ui.terminal.setTitle(`${APP_TITLE} - ${cwdBasename}`);
		}
	}

	/**
	 * Run the interactive mode. This is the main entry point.
	 * Initializes the UI, shows warnings, processes initial messages, and starts the interactive loop.
	 */
	async run(): Promise<void> {
		await this.init();

		if (!process.env.PI_OFFLINE) {
			const controller = new AbortController();
			const timeout = setTimeout(() => controller.abort(), 15_000);
			void refreshModelCatalogs(this.session.modelRuntime, controller.signal)
				.then(() => this.updateAvailableProviderCount())
				.catch(() => {})
				.finally(() => clearTimeout(timeout));
		}

		// Start package update check asynchronously; Home renders the result above the roster.
		this.checkForPackageUpdates()
			.then((updates) => {
				this.packageUpdates = updates;
				if (updates.length > 0) {
					this.ui.requestRender();
				}
			})
			.finally(() => {
				// On Windows, npm can overwrite the shared console title while checking
				// extension package versions. Restore Pi's title after the startup check.
				if (process.platform === "win32" && this.isInitialized) {
					this.updateTerminalTitle();
				}
			});

		// Check tmux keyboard setup asynchronously
		this.checkTmuxKeyboardSetup().then((warning) => {
			if (warning) {
				this.showWarning(warning);
			}
		});

		// Show startup warnings
		const {
			migratedProviders,
			startupDiagnostics,
			modelFallbackMessage,
			initialMessage,
			initialImages,
			initialMessages,
		} = this.options;

		for (const diagnostic of startupDiagnostics ?? []) {
			if (diagnostic.type === "error") {
				this.showError(diagnostic.message);
			} else if (diagnostic.type === "warning") {
				this.showWarning(diagnostic.message);
			} else {
				this.showStatus(diagnostic.message);
			}
		}

		if (migratedProviders && migratedProviders.length > 0) {
			this.showWarning(`Migrated credentials to auth.json: ${migratedProviders.join(", ")}`);
		}

		const modelsJsonError = this.session.modelRuntime.getError();
		if (modelsJsonError) {
			this.showError(`models.json error: ${modelsJsonError}`);
		}

		if (modelFallbackMessage) {
			this.showWarning(modelFallbackMessage);
		}

		const crash = takeUnnotifiedCrash();
		if (crash) {
			const when = new Date(crash.timestamp).toLocaleString();
			this.showWarning(
				`${APP_NAME} crashed on ${when} (${crash.message}). Run /bug to report it; the crash details are attached automatically.`,
			);
		}

		void this.maybeWarnAboutAnthropicSubscriptionAuth();

		if (this.options.initialBatch) {
			const batch = this.options.initialBatch;
			await runBatchScript(this.batchCommandHost(), batch.script, batch.args);
		}

		// Process initial messages
		if (initialMessage) {
			try {
				await runInTabConsole(this.tabManager?.getActive(), () =>
					this.session.prompt(initialMessage, { images: initialImages }),
				);
			} catch (error: unknown) {
				const errorMessage = error instanceof Error ? error.message : "Unknown error occurred";
				this.showError(errorMessage);
			}
		}

		if (initialMessages) {
			for (const message of initialMessages) {
				try {
					await runInTabConsole(this.tabManager?.getActive(), () => this.session.prompt(message));
				} catch (error: unknown) {
					const errorMessage = error instanceof Error ? error.message : "Unknown error occurred";
					this.showError(errorMessage);
				}
			}
		}

		// Main interactive loop
		while (true) {
			const userInput = await this.getUserInput();
			try {
				await runInTabConsole(this.tabManager?.getActive(), () => this.session.prompt(userInput));
			} catch (error: unknown) {
				const errorMessage = error instanceof Error ? error.message : "Unknown error occurred";
				this.showError(errorMessage);
			}
		}
	}

	private async checkForPackageUpdates(): Promise<string[]> {
		if (process.env.PI_OFFLINE) {
			return [];
		}

		try {
			const packageManager = new DefaultPackageManager({
				cwd: this.sessionManager.getCwd(),
				agentDir: getAgentDir(),
				settingsManager: this.settingsManager,
			});
			const updates = await packageManager.checkForAvailableUpdates();
			return updates.map((update) => update.displayName);
		} catch {
			return [];
		}
	}

	private async checkTmuxKeyboardSetup(): Promise<string | undefined> {
		if (!process.env.TMUX) return undefined;

		const runTmuxShow = (option: string): Promise<string | undefined> => {
			return new Promise((resolve) => {
				const proc = spawn("tmux", ["show", "-gv", option], {
					stdio: ["ignore", "pipe", "ignore"],
				});
				let stdout = "";
				const timer = setTimeout(() => {
					proc.kill();
					resolve(undefined);
				}, 2000);

				proc.stdout?.on("data", (data) => {
					stdout += data.toString();
				});
				proc.on("error", () => {
					clearTimeout(timer);
					resolve(undefined);
				});
				proc.on("close", (code) => {
					clearTimeout(timer);
					resolve(code === 0 ? stdout.trim() : undefined);
				});
			});
		};

		const [extendedKeys, extendedKeysFormat] = await Promise.all([
			runTmuxShow("extended-keys"),
			runTmuxShow("extended-keys-format"),
		]);

		// If we couldn't query tmux (timeout, sandbox, etc.), don't warn
		if (extendedKeys === undefined) return undefined;

		if (extendedKeys !== "on" && extendedKeys !== "always") {
			return "tmux extended-keys is off. Modified Enter keys may not work. Add `set -g extended-keys on` to ~/.tmux.conf and restart tmux.";
		}

		if (extendedKeysFormat === "xterm") {
			return "tmux extended-keys-format is xterm. Pi works best with csi-u. Add `set -g extended-keys-format csi-u` to ~/.tmux.conf and restart tmux.";
		}

		return undefined;
	}

	/**
	 * Get changelog entries to display on startup.
	 * Only shows new entries since last seen version, skips for resumed sessions.
	 */
	private getChangelogForDisplay(): string | undefined {
		// Skip changelog for resumed/continued sessions (already have messages)
		if (this.session.state.messages.length > 0) {
			return undefined;
		}

		const lastVersion = this.settingsManager.getLastChangelogVersion();
		const changelogPath = getChangelogPath();
		const entries = parseChangelog(changelogPath);

		if (!lastVersion) {
			// Fresh install - record the version, send telemetry, don't show changelog
			this.settingsManager.setLastChangelogVersion(VERSION);
			this.reportInstallTelemetry(VERSION);
			return undefined;
		}

		const newEntries = getNewEntries(entries, lastVersion);
		if (newEntries.length > 0) {
			this.settingsManager.setLastChangelogVersion(VERSION);
			this.reportInstallTelemetry(VERSION);
			return newEntries.map((e) => normalizeChangelogLinks(e.content, e)).join("\n\n");
		}

		return undefined;
	}

	private reportInstallTelemetry(version: string): void {
		if (process.env.PI_OFFLINE) {
			return;
		}

		if (!isInstallTelemetryEnabled(this.settingsManager)) {
			return;
		}

		void fetch(`https://pi.dev/api/report-install?version=${encodeURIComponent(version)}`, {
			headers: {
				"User-Agent": getPiUserAgent(version),
			},
			signal: AbortSignal.timeout(5000),
		})
			.then(() => undefined)
			.catch(() => undefined);
	}

	private getMarkdownThemeWithSettings(): MarkdownTheme {
		return {
			...getMarkdownTheme(),
			codeBlockIndent: this.settingsManager.getCodeBlockIndent(),
		};
	}

	// =========================================================================
	// Extension System
	// =========================================================================

	private formatDisplayPath(p: string): string {
		const home = os.homedir();
		let result = p;

		// Replace home directory with ~
		if (result.startsWith(home)) {
			result = `~${result.slice(home.length)}`;
		}

		return result;
	}

	private formatExtensionDisplayPath(path: string): string {
		let result = this.formatDisplayPath(path);
		result = result.replace(/\/index\.ts$/, "").replace(/\/index\.js$/, "");
		return result;
	}

	private formatContextPath(p: string): string {
		const cwd = path.resolve(this.sessionManager.getCwd());
		const absolutePath = path.isAbsolute(p) ? path.resolve(p) : path.resolve(cwd, p);
		const relativePath = getCwdRelativePath(absolutePath, cwd);
		if (relativePath !== undefined) {
			return relativePath;
		}

		return this.formatDisplayPath(absolutePath);
	}

	private getStartupExpansionState(): boolean {
		return this.options.verbose || this.toolOutputExpanded;
	}

	/**
	 * Get a short path relative to the package root for display.
	 */
	private getShortPath(fullPath: string, sourceInfo?: SourceInfo): string {
		const normalizedFullPath = fullPath.replace(/\\/g, "/");
		const baseDir = sourceInfo?.baseDir;
		if (baseDir && this.isPackageSource(sourceInfo)) {
			const normalizedBaseDir = baseDir.replace(/\\/g, "/");
			const npmRootMatch = normalizedBaseDir.match(/^(.*\/node_modules)\/(@?[^/]+(?:\/[^/]+)?)$/);
			// If fullPath is under the same node_modules root as baseDir, preserve that relative topology.
			if (npmRootMatch?.[1] && normalizedFullPath.startsWith(`${npmRootMatch[1]}/`)) {
				return path.posix.relative(normalizedBaseDir, normalizedFullPath);
			}

			const relativePath = path.relative(path.resolve(baseDir), path.resolve(fullPath));
			if (
				relativePath &&
				relativePath !== "." &&
				!relativePath.startsWith("..") &&
				!relativePath.startsWith(`..${path.sep}`) &&
				!path.isAbsolute(relativePath)
			) {
				return relativePath.replace(/\\/g, "/");
			}
		}

		const source = sourceInfo?.source ?? "";
		const npmMatch = normalizedFullPath.match(/node_modules\/(@?[^/]+(?:\/[^/]+)?)\/(.*)/);
		if (npmMatch && source.startsWith("npm:")) {
			return npmMatch[2];
		}

		const gitMatch = normalizedFullPath.match(/git\/[^/]+\/[^/]+\/(.*)/);
		if (gitMatch && source.startsWith("git:")) {
			return gitMatch[1];
		}

		return this.formatDisplayPath(fullPath);
	}

	private getCompactPathLabel(resourcePath: string, sourceInfo?: SourceInfo): string {
		const shortPath = this.getShortPath(resourcePath, sourceInfo);
		const normalizedPath = shortPath.replace(/\\/g, "/");
		const segments = normalizedPath.split("/").filter((segment) => segment.length > 0 && segment !== "~");
		if (segments.length > 0) {
			return segments[segments.length - 1]!;
		}
		return shortPath;
	}

	private getCompactPackageSourceLabel(sourceInfo?: SourceInfo): string {
		const source = sourceInfo?.source ?? "";
		if (source.startsWith("npm:")) {
			return source.slice("npm:".length) || source;
		}

		const gitSource = parseGitUrl(source);
		if (gitSource) {
			return gitSource.path || source;
		}

		return source;
	}

	private getCompactExtensionLabel(resourcePath: string, sourceInfo?: SourceInfo): string {
		if (!this.isPackageSource(sourceInfo)) {
			return this.getCompactPathLabel(resourcePath, sourceInfo);
		}

		const sourceLabel = this.getCompactPackageSourceLabel(sourceInfo);
		if (!sourceLabel) {
			return this.getCompactPathLabel(resourcePath, sourceInfo);
		}

		const shortPath = this.getShortPath(resourcePath, sourceInfo).replace(/\\/g, "/");
		const packagePath = shortPath.startsWith("extensions/") ? shortPath.slice("extensions/".length) : shortPath;
		const parsedPath = path.posix.parse(packagePath);

		if (parsedPath.name === "index") {
			return !parsedPath.dir || parsedPath.dir === "." ? sourceLabel : `${sourceLabel}:${parsedPath.dir}`;
		}

		return `${sourceLabel}:${packagePath}`;
	}

	private getCompactDisplayPathSegments(resourcePath: string): string[] {
		return this.formatDisplayPath(resourcePath)
			.replace(/\\/g, "/")
			.split("/")
			.filter((segment) => segment.length > 0 && segment !== "~");
	}

	private getCompactNonPackageExtensionLabel(
		resourcePath: string,
		index: number,
		allPaths: Array<{ path: string; segments: string[] }>,
	): string {
		const segments = allPaths[index]?.segments;
		if (!segments || segments.length === 0) {
			return this.getCompactPathLabel(resourcePath);
		}

		for (let segmentCount = 1; segmentCount <= segments.length; segmentCount += 1) {
			const candidate = segments.slice(-segmentCount).join("/");
			const isUnique = allPaths.every((item, itemIndex) => {
				if (itemIndex === index) {
					return true;
				}
				return item.segments.slice(-segmentCount).join("/") !== candidate;
			});

			if (isUnique) {
				return candidate;
			}
		}

		return segments.join("/");
	}

	private getCompactExtensionLabels(extensions: Array<{ path: string; sourceInfo?: SourceInfo }>): string[] {
		const nonPackageExtensions = extensions
			.map((extension) => {
				const segments = this.getCompactDisplayPathSegments(extension.path);
				const lastSegment = segments[segments.length - 1];
				if (segments.length > 1 && (lastSegment === "index.ts" || lastSegment === "index.js")) {
					segments.pop();
				}
				return {
					path: extension.path,
					sourceInfo: extension.sourceInfo,
					segments,
				};
			})
			.filter((extension) => !this.isPackageSource(extension.sourceInfo));

		return extensions.map((extension) => {
			if (this.isPackageSource(extension.sourceInfo)) {
				return this.getCompactExtensionLabel(extension.path, extension.sourceInfo);
			}

			const nonPackageIndex = nonPackageExtensions.findIndex((item) => item.path === extension.path);
			if (nonPackageIndex === -1) {
				return this.getCompactPathLabel(extension.path, extension.sourceInfo);
			}

			return this.getCompactNonPackageExtensionLabel(extension.path, nonPackageIndex, nonPackageExtensions);
		});
	}

	private getDisplaySourceInfo(sourceInfo?: SourceInfo): {
		label: string;
		scopeLabel?: string;
		color: "accent" | "muted";
	} {
		const source = sourceInfo?.source ?? "local";
		const scope = sourceInfo?.scope ?? "project";
		if (source === "local") {
			if (scope === "user") {
				return { label: "user", color: "muted" };
			}
			if (scope === "project") {
				return { label: "project", color: "muted" };
			}
			if (scope === "temporary") {
				return { label: "path", scopeLabel: "temp", color: "muted" };
			}
			return { label: "path", color: "muted" };
		}

		if (source === "cli") {
			return { label: "path", scopeLabel: scope === "temporary" ? "temp" : undefined, color: "muted" };
		}

		const scopeLabel =
			scope === "user" ? "user" : scope === "project" ? "project" : scope === "temporary" ? "temp" : undefined;
		return { label: source, scopeLabel, color: "accent" };
	}

	private getScopeGroup(sourceInfo?: SourceInfo): "user" | "project" | "path" {
		const source = sourceInfo?.source ?? "local";
		const scope = sourceInfo?.scope ?? "project";
		if (source === "cli" || scope === "temporary") return "path";
		if (scope === "user") return "user";
		if (scope === "project") return "project";
		return "path";
	}

	private isPackageSource(sourceInfo?: SourceInfo): boolean {
		const source = sourceInfo?.source ?? "";
		return source.startsWith("npm:") || source.startsWith("git:");
	}

	private buildScopeGroups(items: Array<{ path: string; sourceInfo?: SourceInfo }>): Array<{
		scope: "user" | "project" | "path";
		paths: Array<{ path: string; sourceInfo?: SourceInfo }>;
		packages: Map<string, Array<{ path: string; sourceInfo?: SourceInfo }>>;
	}> {
		const groups: Record<
			"user" | "project" | "path",
			{
				scope: "user" | "project" | "path";
				paths: Array<{ path: string; sourceInfo?: SourceInfo }>;
				packages: Map<string, Array<{ path: string; sourceInfo?: SourceInfo }>>;
			}
		> = {
			user: { scope: "user", paths: [], packages: new Map() },
			project: { scope: "project", paths: [], packages: new Map() },
			path: { scope: "path", paths: [], packages: new Map() },
		};

		for (const item of items) {
			const groupKey = this.getScopeGroup(item.sourceInfo);
			const group = groups[groupKey];
			const source = item.sourceInfo?.source ?? "local";

			if (this.isPackageSource(item.sourceInfo)) {
				const list = group.packages.get(source) ?? [];
				list.push(item);
				group.packages.set(source, list);
			} else {
				group.paths.push(item);
			}
		}

		return [groups.project, groups.user, groups.path].filter(
			(group) => group.paths.length > 0 || group.packages.size > 0,
		);
	}

	private formatScopeGroups(
		groups: Array<{
			scope: "user" | "project" | "path";
			paths: Array<{ path: string; sourceInfo?: SourceInfo }>;
			packages: Map<string, Array<{ path: string; sourceInfo?: SourceInfo }>>;
		}>,
		options: {
			formatPath: (item: { path: string; sourceInfo?: SourceInfo }) => string;
			formatPackagePath: (item: { path: string; sourceInfo?: SourceInfo }, source: string) => string;
		},
	): string {
		const lines: string[] = [];

		for (const group of groups) {
			lines.push(`  ${theme.fg("accent", group.scope)}`);

			const sortedPaths = [...group.paths].sort((a, b) => a.path.localeCompare(b.path));
			for (const item of sortedPaths) {
				lines.push(theme.fg("dim", `    ${options.formatPath(item)}`));
			}

			const sortedPackages = Array.from(group.packages.entries()).sort(([a], [b]) => a.localeCompare(b));
			for (const [source, items] of sortedPackages) {
				lines.push(`    ${theme.fg("mdLink", source)}`);
				const sortedPackagePaths = [...items].sort((a, b) => a.path.localeCompare(b.path));
				for (const item of sortedPackagePaths) {
					lines.push(theme.fg("dim", `      ${options.formatPackagePath(item, source)}`));
				}
			}
		}

		return lines.join("\n");
	}

	private findSourceInfoForPath(p: string, sourceInfos: Map<string, SourceInfo>): SourceInfo | undefined {
		const exact = sourceInfos.get(p);
		if (exact) return exact;

		let current = p;
		while (current.includes("/")) {
			current = current.substring(0, current.lastIndexOf("/"));
			const parent = sourceInfos.get(current);
			if (parent) return parent;
		}

		return undefined;
	}

	private formatPathWithSource(p: string, sourceInfo?: SourceInfo): string {
		if (sourceInfo) {
			const shortPath = this.getShortPath(p, sourceInfo);
			const { label, scopeLabel } = this.getDisplaySourceInfo(sourceInfo);
			const labelText = scopeLabel ? `${label} (${scopeLabel})` : label;
			return `${labelText} ${shortPath}`;
		}
		return this.formatDisplayPath(p);
	}

	private formatDiagnostics(diagnostics: readonly ResourceDiagnostic[], sourceInfos: Map<string, SourceInfo>): string {
		const lines: string[] = [];

		// Group collision diagnostics by name
		const collisions = new Map<string, ResourceDiagnostic[]>();
		const otherDiagnostics: ResourceDiagnostic[] = [];

		for (const d of diagnostics) {
			if (d.type === "collision" && d.collision) {
				const list = collisions.get(d.collision.name) ?? [];
				list.push(d);
				collisions.set(d.collision.name, list);
			} else {
				otherDiagnostics.push(d);
			}
		}

		// Format collision diagnostics grouped by name
		for (const [name, collisionList] of collisions) {
			const first = collisionList[0]?.collision;
			if (!first) continue;
			lines.push(theme.fg("warning", `  "${name}" collision:`));
			lines.push(
				theme.fg(
					"dim",
					`    ${theme.fg("success", "✓")} ${this.formatPathWithSource(first.winnerPath, this.findSourceInfoForPath(first.winnerPath, sourceInfos))}`,
				),
			);
			for (const d of collisionList) {
				if (d.collision) {
					lines.push(
						theme.fg(
							"dim",
							`    ${theme.fg("warning", "✗")} ${this.formatPathWithSource(d.collision.loserPath, this.findSourceInfoForPath(d.collision.loserPath, sourceInfos))} (skipped)`,
						),
					);
				}
			}
		}

		for (const d of otherDiagnostics) {
			if (d.path) {
				const formattedPath = this.formatPathWithSource(d.path, this.findSourceInfoForPath(d.path, sourceInfos));
				lines.push(theme.fg(d.type === "error" ? "error" : "warning", `  ${formattedPath}`));
				lines.push(theme.fg(d.type === "error" ? "error" : "warning", `    ${d.message}`));
			} else {
				lines.push(theme.fg(d.type === "error" ? "error" : "warning", `  ${d.message}`));
			}
		}

		return lines.join("\n");
	}

	private showLoadedResources(options?: {
		extensions?: Array<{ path: string; sourceInfo?: SourceInfo }>;
		force?: boolean;
		showDiagnosticsWhenQuiet?: boolean;
	}): void {
		// Resource rendering is idempotent; chat clears no longer clear this separate container.
		this.loadedResourcesContainer.clear();

		const showListing = options?.force || this.options.verbose || !this.settingsManager.getQuietStartup();
		const showDiagnostics = showListing || options?.showDiagnosticsWhenQuiet === true;
		if (!showListing && !showDiagnostics) {
			return;
		}

		const sectionHeader = (name: string, color: ThemeColor = "mdHeading") => theme.fg(color, `[${name}]`);
		const formatCompactList = (items: string[], options?: { sort?: boolean }): string => {
			const labels = items.map((item) => item.trim()).filter((item) => item.length > 0);
			if (options?.sort !== false) {
				labels.sort((a, b) => a.localeCompare(b));
			}
			return theme.fg("dim", `  ${labels.join(", ")}`);
		};
		const addLoadedSection = (
			name: string,
			collapsedBody: string,
			expandedBody = collapsedBody,
			color: ThemeColor = "mdHeading",
		): void => {
			const section = new ExpandableText(
				() => `${sectionHeader(name, color)}\n${collapsedBody}`,
				() => `${sectionHeader(name, color)}\n${expandedBody}`,
				this.getStartupExpansionState(),
				0,
				0,
			);
			this.loadedResourcesContainer.addChild(section);
			this.loadedResourcesContainer.addChild(new Spacer(1));
		};

		const skillsResult = this.session.resourceLoader.getSkills();
		const promptsResult = this.session.resourceLoader.getPrompts();
		const themesResult = this.session.resourceLoader.getThemes();
		const extensions =
			options?.extensions ??
			this.session.resourceLoader
				.getExtensions()
				.extensions.filter((extension) => !extension.hidden)
				.map((extension) => ({
					path: extension.path,
					sourceInfo: extension.sourceInfo,
				}));
		const sourceInfos = new Map<string, SourceInfo>();
		for (const extension of extensions) {
			if (extension.sourceInfo) {
				sourceInfos.set(extension.path, extension.sourceInfo);
			}
		}
		for (const skill of skillsResult.skills) {
			if (skill.sourceInfo) {
				sourceInfos.set(skill.filePath, skill.sourceInfo);
			}
		}
		for (const prompt of promptsResult.prompts) {
			if (prompt.sourceInfo) {
				sourceInfos.set(prompt.filePath, prompt.sourceInfo);
			}
		}
		for (const loadedTheme of themesResult.themes) {
			if (loadedTheme.sourcePath && loadedTheme.sourceInfo) {
				sourceInfos.set(loadedTheme.sourcePath, loadedTheme.sourceInfo);
			}
		}

		if (showListing) {
			const systemPromptSource = this.session.resourceLoader.getSystemPromptSource();
			const contextFiles = [
				...(systemPromptSource ? [systemPromptSource] : []),
				...this.session.resourceLoader.getAppendSystemPromptSources(),
				...this.session.resourceLoader.getAgentsFiles().agentsFiles,
			];
			if (contextFiles.length > 0) {
				this.loadedResourcesContainer.addChild(new Spacer(1));
				const contextList = contextFiles
					.map((f) => theme.fg("dim", `  ${this.formatDisplayPath(f.path)}`))
					.join("\n");
				const contextCompactList = formatCompactList(
					contextFiles.map((contextFile) => this.formatContextPath(contextFile.path)),
					{ sort: false },
				);
				addLoadedSection("Context", contextCompactList, contextList);
			}

			const skills = skillsResult.skills;
			if (skills.length > 0) {
				const groups = this.buildScopeGroups(
					skills.map((skill) => ({ path: skill.filePath, sourceInfo: skill.sourceInfo })),
				);
				const skillList = this.formatScopeGroups(groups, {
					formatPath: (item) => this.formatDisplayPath(item.path),
					formatPackagePath: (item) => this.getShortPath(item.path, item.sourceInfo),
				});
				const skillCompactList = formatCompactList(skills.map((skill) => skill.name));
				addLoadedSection("Skills", skillCompactList, skillList);
			}

			const templates = this.session.promptTemplates;
			if (templates.length > 0) {
				const groups = this.buildScopeGroups(
					templates.map((template) => ({ path: template.filePath, sourceInfo: template.sourceInfo })),
				);
				const templateByPath = new Map(templates.map((t) => [t.filePath, t]));
				const templateList = this.formatScopeGroups(groups, {
					formatPath: (item) => {
						const template = templateByPath.get(item.path);
						return template ? `/${template.name}` : this.formatDisplayPath(item.path);
					},
					formatPackagePath: (item) => {
						const template = templateByPath.get(item.path);
						return template ? `/${template.name}` : this.formatDisplayPath(item.path);
					},
				});
				const promptCompactList = formatCompactList(templates.map((template) => `/${template.name}`));
				addLoadedSection("Prompts", promptCompactList, templateList);
			}

			if (extensions.length > 0) {
				const groups = this.buildScopeGroups(extensions);
				const extList = this.formatScopeGroups(groups, {
					formatPath: (item) => this.formatExtensionDisplayPath(item.path),
					formatPackagePath: (item) =>
						this.formatExtensionDisplayPath(this.getShortPath(item.path, item.sourceInfo)),
				});
				const extensionCompactList = formatCompactList(this.getCompactExtensionLabels(extensions));
				addLoadedSection("Extensions", extensionCompactList, extList, "mdHeading");
			}

			// Show loaded themes (excluding built-in)
			const loadedThemes = themesResult.themes;
			const customThemes = loadedThemes.filter((t) => t.sourcePath);
			if (customThemes.length > 0) {
				const groups = this.buildScopeGroups(
					customThemes.map((loadedTheme) => ({
						path: loadedTheme.sourcePath!,
						sourceInfo: loadedTheme.sourceInfo,
					})),
				);
				const themeList = this.formatScopeGroups(groups, {
					formatPath: (item) => this.formatDisplayPath(item.path),
					formatPackagePath: (item) => this.getShortPath(item.path, item.sourceInfo),
				});
				const themeCompactList = formatCompactList(
					customThemes.map(
						(loadedTheme) =>
							loadedTheme.name ?? this.getCompactPathLabel(loadedTheme.sourcePath!, loadedTheme.sourceInfo),
					),
				);
				addLoadedSection("Themes", themeCompactList, themeList);
			}
		}

		if (showDiagnostics) {
			const skillDiagnostics = skillsResult.diagnostics;
			if (skillDiagnostics.length > 0) {
				const warningLines = this.formatDiagnostics(skillDiagnostics, sourceInfos);
				this.loadedResourcesContainer.addChild(
					new Text(`${theme.fg("warning", "[Skill conflicts]")}\n${warningLines}`, 0, 0),
				);
				this.loadedResourcesContainer.addChild(new Spacer(1));
			}

			const promptDiagnostics = promptsResult.diagnostics;
			if (promptDiagnostics.length > 0) {
				const warningLines = this.formatDiagnostics(promptDiagnostics, sourceInfos);
				this.loadedResourcesContainer.addChild(
					new Text(`${theme.fg("warning", "[Prompt conflicts]")}\n${warningLines}`, 0, 0),
				);
				this.loadedResourcesContainer.addChild(new Spacer(1));
			}

			const extensionDiagnostics: ResourceDiagnostic[] = [];
			const extensionErrors = this.session.resourceLoader.getExtensions().errors;
			if (extensionErrors.length > 0) {
				for (const error of extensionErrors) {
					extensionDiagnostics.push({ type: "error", message: error.error, path: error.path });
				}
			}

			const commandDiagnostics = this.session.extensionRunner.getCommandDiagnostics();
			extensionDiagnostics.push(...commandDiagnostics);
			extensionDiagnostics.push(...this.getBuiltInCommandConflictDiagnostics(this.session.extensionRunner));

			const shortcutDiagnostics = this.session.extensionRunner.getShortcutDiagnostics();
			extensionDiagnostics.push(...shortcutDiagnostics);

			if (extensionDiagnostics.length > 0) {
				const warningLines = this.formatDiagnostics(extensionDiagnostics, sourceInfos);
				this.loadedResourcesContainer.addChild(
					new Text(`${theme.fg("warning", "[Extension issues]")}\n${warningLines}`, 0, 0),
				);
				this.loadedResourcesContainer.addChild(new Spacer(1));
			}

			const themeDiagnostics = themesResult.diagnostics;
			if (themeDiagnostics.length > 0) {
				const warningLines = this.formatDiagnostics(themeDiagnostics, sourceInfos);
				this.loadedResourcesContainer.addChild(
					new Text(`${theme.fg("warning", "[Theme conflicts]")}\n${warningLines}`, 0, 0),
				);
				this.loadedResourcesContainer.addChild(new Spacer(1));
			}
		}
	}

	/**
	 * Initialize the extension system with TUI-based UI context.
	 *
	 * `runtime` is the tab being bound. With `backgroundTabId` the tab is not the
	 * focused one: the chrome its extensions install is recorded for that tab (see
	 * `createTabScopedExtensionUIContext`), and the surfaces that belong to the
	 * focused tab are left alone: the live autocomplete provider, the editor
	 * shortcuts, and the loaded-resources block.
	 */
	private async bindCurrentSessionExtensions(
		options: { runtime?: AgentSessionRuntime; backgroundTabId?: string } = {},
	): Promise<void> {
		const runtime = options.runtime ?? this.runtimeHost;
		const session = runtime.session;
		const backgroundTabId = options.backgroundTabId;
		const uiContext = backgroundTabId
			? this.createTabScopedExtensionUIContext(backgroundTabId)
			: this.createExtensionUIContext(() => this.tabIdForRuntime(runtime));
		await session.bindExtensions({
			uiContext,
			mode: "tui",
			abortHandler: () => {
				this.restoreQueuedMessagesToEditor({ abort: true });
			},
			commandContextActions: {
				waitForIdle: () => session.waitForIdle(),
				newSession: async (sessionOptions) => {
					this.clearStatusIndicator();
					try {
						return await runtime.newSession(sessionOptions);
					} catch (error: unknown) {
						return this.handleFatalRuntimeError("Failed to create session", error);
					}
				},
				fork: async (entryId, forkOptions) => {
					try {
						const result = await runtime.fork(entryId, forkOptions);
						if (!result.cancelled) {
							this.editor.setText(result.selectedText ?? "");
							this.showStatus("Forked to new session");
						}
						return { cancelled: result.cancelled };
					} catch (error: unknown) {
						return this.handleFatalRuntimeError("Failed to fork session", error);
					}
				},
				navigateTree: async (targetId, options) => {
					const result = await this.session.navigateTree(targetId, {
						summarize: options?.summarize,
						customInstructions: options?.customInstructions,
						replaceInstructions: options?.replaceInstructions,
						label: options?.label,
					});
					if (result.cancelled) {
						return { cancelled: true };
					}

					this.chatContainer.clear();
					this.renderInitialMessages();
					if (result.editorText && !this.editor.getText().trim()) {
						this.editor.setText(result.editorText);
					}
					this.showStatus("Navigated to selected point");
					void this.flushCompactionQueue({ willRetry: false });
					return { cancelled: false };
				},
				switchSession: async (sessionPath, options) => {
					return this.handleResumeSession(sessionPath, options);
				},
				reload: async () => {
					await this.handleReloadCommand();
				},
			},
			shutdownHandler: () => {
				this.shutdownRequested = true;
				if (session.isIdle) {
					void this.shutdown();
				}
			},
			onError: (error) => {
				this.showExtensionError(error.extensionPath, error.error, error.stack);
			},
		});
		if (backgroundTabId) return;

		setRegisteredThemes(session.resourceLoader.getThemes().themes);
		this.setupAutocompleteProvider();
		this.setupExtensionShortcuts(session.extensionRunner);
		this.showLoadedResources({ force: false, showDiagnosticsWhenQuiet: true });
		this.showStartupNoticesIfNeeded();
	}

	private applyFullscreenScrollbarSetting(): void {
		// Home fits the viewport exactly and never scrolls, so it shows no scrollbar whatever
		// the setting says; the setting is back in force once a transcript is rendered again.
		const mode = this.homeSelection.active ? "hidden" : this.settingsManager.getFullscreenScrollbar();
		this.transcriptScrollView?.setScrollbar(mode);
	}

	/**
	 * Extension UI context for a tab whose chrome is not mounted yet. The chrome an
	 * extension installs (widgets, footer and header, statuses, autocomplete
	 * wrappers, editor component, working message, thinking label) is recorded on the
	 * tab and mounted when the tab takes focus. A surface the tab already owns on
	 * screen is written live instead, so a background bind does not defer it: a notice
	 * follows the transcript, and a status replaces the one the footer shows. Any other
	 * tab records it for its next mount. A dialog or an editor takeover is that tab's
	 * own surface too: it parks on the tab and shows when the tab takes focus.
	 */
	private createTabScopedExtensionUIContext(tabId: string): ExtensionUIContext {
		const live = this.createExtensionUIContext(tabId);
		return {
			...live,
			get theme() {
				return theme;
			},
			notify: (message, type) => {
				// A tab that owns the mounted transcript paints the notice at once, like the
				// startup session. Any other tab has nowhere to put it until its next focus.
				if (!this.homeSelection.active && this.activeTabIdForUi === tabId) {
					this.showExtensionNotify(message, type);
					return;
				}
				this.tabExtensionUi(tabId).notices.push({ message, type });
			},
			setWorkingMessage: (message) => {
				this.tabExtensionUi(tabId).workingMessage = message;
			},
			setWorkingVisible: (visible) => {
				this.tabExtensionUi(tabId).workingVisible = visible;
			},
			setWorkingIndicator: (options) => {
				this.tabExtensionUi(tabId).workingIndicatorOptions = options;
			},
			setHiddenThinkingLabel: (label) => {
				this.tabExtensionUi(tabId).hiddenThinkingLabel = label;
			},
			setToolsExpanded: (expanded) => {
				this.tabExtensionUi(tabId).toolsExpanded = expanded;
			},
			setStatus: (key: string, text: string | undefined) => {
				const ui = this.tabExtensionUi(tabId);
				if (text === undefined) ui.statuses.delete(key);
				else ui.statuses.set(key, text);
				// The footer keeps its own copy of the statuses and re-reads the tab's record
				// only on mount, so write the mounted tab's footer as well.
				if (!this.homeSelection.active && this.activeTabIdForUi === tabId) live.setStatus(key, text);
			},
			setWidget: (
				key: string,
				content: string[] | ((tui: TUI, thm: Theme) => Component & { dispose?(): void }) | undefined,
				widgetOptions?: ExtensionWidgetOptions,
			) => {
				const ui = this.tabExtensionUi(tabId);
				for (const map of [ui.widgetsAbove, ui.widgetsBelow]) {
					const existing = map.get(key);
					existing?.dispose?.();
					map.delete(key);
				}
				if (content === undefined) return;
				const component = Array.isArray(content) ? this.buildExtensionWidget(content) : content(this.ui, theme);
				const target = widgetOptions?.placement === "belowEditor" ? ui.widgetsBelow : ui.widgetsAbove;
				target.set(key, component);
			},
			setFooter: (factory) => {
				this.tabExtensionUi(tabId).footerFactory = factory;
			},
			setHeader: (factory) => {
				this.tabExtensionUi(tabId).headerFactory = factory;
			},
			setTitle: () => {
				// The terminal title follows the focused tab; a background tab's own title
				// is applied when it takes focus.
			},
			addAutocompleteProvider: (factory) => {
				this.tabExtensionUi(tabId).autocompleteWrappers.push(factory);
			},
			getEditorComponent: () => this.tabExtensionUi(tabId).editorFactory,
			setEditorComponent: (factory) => {
				this.tabExtensionUi(tabId).editorFactory = factory;
			},
			getToolsExpanded: () => this.tabExtensionUi(tabId).toolsExpanded,
			// A dialog parks the bind, so the chip names this phase while it is open.
			select: (title, options, opts) =>
				this.withLoadingPhase(tabId, () => this.showExtensionSelector(title, options, opts, tabId)),
			confirm: (title, message, opts) =>
				this.withLoadingPhase(tabId, () => this.showExtensionConfirm(title, message, opts, tabId)),
			input: (title, placeholder, opts) =>
				this.withLoadingPhase(tabId, () => this.showExtensionInput(title, placeholder, opts, tabId)),
			custom: (factory, options) =>
				this.withLoadingPhase(tabId, () => this.showExtensionCustom(factory, options, tabId)),
			editor: (title, prefill) =>
				this.withLoadingPhase(tabId, () => this.showExtensionEditor(title, prefill, tabId)),
		};
	}

	/**
	 * Mark a loading tab as parked on an extension dialog while `run` is pending,
	 * then hand it back to `resources`. A dialog opened outside a loading tab is
	 * left alone, so the phase never leaks onto a ready tab.
	 */
	private withLoadingPhase<T>(tabId: string, run: () => Promise<T>): Promise<T> {
		const tab = this.tabManager?.get(tabId);
		if (!tab?.loading) return run();
		const restore = () => {
			if (tab.loading) tab.loadingPhase = "resources";
			this.ui.requestRender();
		};
		tab.loadingPhase = "waiting for input";
		this.ui.requestRender();
		try {
			return run().finally(restore);
		} catch (error) {
			restore();
			throw error;
		}
	}

	/** The extension-UI record of a tab, created on first use. */
	private tabExtensionUi(tabId: string): TabExtensionUi {
		let ui = this.tabUi.get(tabId);
		if (!ui) {
			ui = {
				widgetsAbove: new Map(),
				widgetsBelow: new Map(),
				footerFactory: undefined,
				headerFactory: undefined,
				statuses: new Map(),
				autocompleteWrappers: [],
				editorFactory: undefined,
				workingMessage: undefined,
				workingVisible: true,
				workingIndicatorOptions: undefined,
				hiddenThinkingLabel: undefined,
				toolsExpanded: false,
				notices: [],
			};
			this.tabUi.set(tabId, ui);
		}
		return ui;
	}

	/** Queue every restored tab for the background bind pass. */
	private queueRestoredTabBinds(): void {
		const manager = this.tabManager;
		if (!manager) return;
		for (const tab of manager.list()) this.queueTabBind(tab);
	}

	private applyRuntimeSettings(): void {
		setCapabilityOverrides(this.settingsManager.getTerminalCapabilityOverrides());
		configureHttpDispatcher(this.settingsManager.getHttpIdleTimeoutMs());
		this.applyFullscreenScrollbarSetting();
		if (this.renderer instanceof TuiAltScreen) {
			this.renderer.setCopyOnSelect(this.settingsManager.getFullscreenCopyOnSelect());
		}
		this.footer.setSession(this.session);
		this.footer.setAutoCompactEnabled(this.session.autoCompactionEnabled);
		this.footerDataProvider.setCwd(this.sessionManager.getCwd());
		this.hideThinkingBlock = this.settingsManager.getHideThinkingBlock();
		this.outputPad = this.settingsManager.getOutputPad();
		this.ui.setShowHardwareCursor(this.settingsManager.getShowHardwareCursor());
		const clearOnShrink = this.settingsManager.getClearOnShrink();
		this.ui.setClearOnShrink(clearOnShrink);
		if (!clearOnShrink && !this.activeStatusIndicator) {
			this.statusContainer.clear();
		}
		const editorPaddingX = this.settingsManager.getEditorPaddingX();
		const autocompleteMaxVisible = this.settingsManager.getAutocompleteMaxVisible();
		this.defaultEditor.setPaddingX(editorPaddingX);
		this.defaultEditor.setAutocompleteMaxVisible(autocompleteMaxVisible);
		if (this.editor !== this.defaultEditor) {
			this.editor.setPaddingX?.(editorPaddingX);
			this.editor.setAutocompleteMaxVisible?.(autocompleteMaxVisible);
		}
	}

	private async rebindCurrentSession(options: { renderBeforeBind?: boolean } = {}): Promise<void> {
		const session = this.session;

		this.unsubscribe?.();
		this.unsubscribe = undefined;
		this.applyRuntimeSettings();

		if (options.renderBeforeBind) {
			this.renderCurrentSessionState();
			this.subscribeToAgent();
		}

		await this.bindCurrentSessionExtensions();
		const boundSession = this.session;
		if (boundSession) {
			this.boundSessions ??= new WeakSet<AgentSession>();
			this.boundSessions.add(boundSession);
			this.markTabReady(boundSession);
		}
		if (this.activeTabIdForUi) this.tabUi.delete(this.activeTabIdForUi);

		if (this.session !== session) {
			return;
		}

		if (!options.renderBeforeBind) {
			this.subscribeToAgent();
		}

		await this.updateAvailableProviderCount();
		this.updateEditorBorderColor();
		this.updateTerminalTitle();
	}

	private bindRuntimeCallbacks(runtime: AgentSessionRuntime): void {
		bindRuntimeCallbacksImpl(
			// The reset resolves its tab when it runs, by which time the tab is registered.
			this.runtimeCallbackHost(() => this.resetExtensionUI(this.tabIdForRuntime(runtime))),
			runtime,
		);
	}

	/**
	 * Host callbacks shared by every runtime.
	 *
	 * `onResetExtensionUI` lets a runtime pin the reset to the tab it belongs to; without
	 * it a session replacement drops every tab's pending dialogs.
	 */
	private runtimeCallbackHost(onResetExtensionUI?: () => void): RuntimeCallbackHost {
		// Read the manager through a getter: the initial runtime is bound while the
		// TabManager constructor is still running, before `this.tabManager` exists.
		const host = this;
		return {
			get tabManager() {
				return host.tabManager;
			},
			rebindCurrentSession: (opts) => this.rebindCurrentSession(opts),
			applyThemeFromSettings: () => this.themeController.applyFromSettings(),
			persistOpenTabs: () => this.persistOpenTabs(),
			resetExtensionUI: onResetExtensionUI ?? (() => this.resetExtensionUI()),
		};
	}

	/** Host bindings the tab command modules call back into. */
	private tabLifecycleHost(): TabLifecycleHost & {
		runtimeHost: { newSession(options?: unknown): Promise<{ cancelled: boolean }> };
	} {
		return {
			tabManager: this.tabManager,
			sharedTabLayout: this.sharedTabLayout,
			saveComposerDraft: () => this.saveComposerDraft(),
			enqueueTabSwitch: (run) => this.enqueueTabSwitch(run),
			switchActiveTab: (tab) => this.switchActiveTab(tab),
			disposeTabUi: (id) => this.disposeTabUi(id),
			subscribeToAgent: () => this.subscribeToAgent(),
			showError: (msg) => this.showError(msg),
			showWarning: (msg) => this.showWarning(msg),
			showStatus: (msg) => this.showStatus(msg),
			runtimeHost: this.runtimeHost,
		};
	}

	private resumeTabHost(): ResumeTabHost {
		return {
			...this.tabLifecycleHost(),
			activateTab: (tab) => this.activateTab(tab),
			promptMissingSessionCwd: (error) => this.promptForMissingSessionCwd(error),
			projectTrustContext: (cwd) => this.createProjectTrustContext(cwd),
		};
	}

	private sessionActionHost(): SessionActionHost {
		return {
			...this.tabLifecycleHost(),
			session: this.session,
			showExtensionConfirm: (title, msg) => this.showExtensionConfirm(title, msg),
		};
	}

	private workspaceHost(): WorkspaceHost {
		return {
			tabManager: this.tabManager,
			sharedTabLayout: this.sharedTabLayout,
			tabsWorkdir: this.tabsWorkdir,
			session: this.session,
			enqueueTabSwitch: (run) => this.enqueueTabSwitch(run),
			switchActiveTab: (tab) => this.switchActiveTab(tab),
			disposeTabUi: (id) => this.disposeTabUi(id),
			queueRestoredTabBinds: () => this.queueRestoredTabBinds(),
			showExtensionConfirm: (title, msg) => this.showExtensionConfirm(title, msg),
			showError: (msg) => this.showError(msg),
			showWarning: (msg) => this.showWarning(msg),
			showStatus: (msg) => this.showStatus(msg),
		};
	}

	/**
	 * Add a user message to the transcript. A body too large to paint as one block is
	 * split: the transcript renders a windowed block whole, so one enormous block would
	 * cost its full render on every visit.
	 */
	private addUserMessage(text: string, timestamp: number | undefined): void {
		for (const part of splitOversizedUserMessage(text)) {
			this.chatContainer.addChild(
				new UserMessageComponent(
					part.text,
					this.getMarkdownThemeWithSettings(),
					this.outputPad,
					this.getMarkdownTransformers(),
					timestamp,
					part.marks,
				),
			);
		}
	}

	private getTabBarModel(): TabBarModel {
		const manager = this.tabManager;
		if (!manager) return { tabs: [], activeId: "" };
		const zenAgent = this.zenHidesTabBar() ? manager.activeTab() : undefined;
		const activeId = this.homeSelection.active ? HOME_TAB_ID : manager.getActive().id;
		const tabs =
			this.restoringTabs.length > 0
				? this.restoringTabBarItems(activeId)
				: manager.list().map((tab) => this.tabBarItem(tab, activeId));
		const agentChrome = this.tabRuleChrome();
		// The zen dots follow the chips, a waiting `?` included.
		const waitingTabIds = new Set(this.tabInteractions.keys());
		return {
			tabs,
			activeId,
			home: { id: HOME_TAB_ID, label: "MixCode Home" },
			rulePainter: theme.getThinkingBorderColor(this.session.thinkingLevel || "off"),
			// The bar may wrap, but it must not push the transcript out of the
			// viewport; the surplus collapses into the overflow counts.
			maxRows: Math.max(1, Math.floor(this.ui.terminal.rows * TAB_BAR_MAX_ROWS_SHARE)),
			// Home is a different surface and brings the whole bar back, so zen only
			// applies to the agent whose chrome it hides.
			...(zenAgent ? { zen: { statusMarkers: zenStatusMarkers(manager.list(), zenAgent.id, waitingTabIds) } } : {}),
			...(agentChrome ? { agentChrome } : {}),
		};
	}

	/**
	 * Labels the tab-bar rule carries while an extension's editor skin is in
	 * front: the agent name and, only for an overridden context limit, the exact
	 * reading. The default card paints its own top edge, so this is empty there,
	 * and on Home, which composes for a tab it is not attached to.
	 */
	private tabRuleChrome(): TabRuleChrome | undefined {
		if (this.editorComponentFactory === undefined || this.homeSelection.active) return undefined;
		const chrome = editorCardChrome(this.composerContext());
		return {
			title: chrome.title,
			// The card always shows the reading; the rule shows it only when it adds
			// the override mark, because the dock meta row already has the meter.
			contextText: this.hasContextLimitOverride() ? chrome.contextText : undefined,
			vimMode: chrome.vimMode,
			zenMode: chrome.zenMode,
		};
	}

	/** One chip for a tab the manager holds. */
	private tabBarItem(tab: AgentTab, activeId: string): TabBarItem {
		return {
			id: tab.id,
			title: tab.title,
			// A tab that is still coming up shows the spinner rather than the status its
			// session happens to hold.
			status: tab.loading ? "loading" : tab.status,
			unread: tab.unread,
			waiting: this.tabWaitingForInput(tab.id),
			// The active surface may be Home, so the agent tab the manager holds focused
			// keeps its rank while Home is shown.
			recentRank: tab.id === activeId ? -1 : (this.tabManager?.recentRank(tab.id) ?? -1),
			color: tab.color,
			// Drives the active chip's title shimmer from the instant this tab took focus.
			activatedAt: tab.activatedAt,
		};
	}

	/**
	 * Chips for a startup restore: the whole persisted layout, in order, with a
	 * loading chip for every tab whose runtime does not exist yet.
	 */
	private restoringTabBarItems(activeId: string): TabBarItem[] {
		const manager = this.tabManager;
		const byId = new Map((manager?.list() ?? []).map((tab) => [tab.id, tab]));
		return this.restoringTabs.map((entry) => {
			const tab = byId.get(entry.id);
			if (tab) return this.tabBarItem(tab, activeId);
			return {
				id: entry.id,
				title: entry.title,
				status: "loading",
				unread: false,
				recentRank: -1,
				color: entry.color,
			};
		});
	}

	/** Cycle through the tab order `[Home, ...agents]`, wrapping in both directions. */
	private cycleTab(delta: number): void {
		const manager = this.tabManager;
		if (!manager) return;
		const currentId = this.homeSelection.active ? HOME_TAB_ID : manager.getActive().id;
		const nextId = nextTabId(currentId, this.homeRoster(), delta);
		if (nextId === currentId) return;
		if (nextId === HOME_TAB_ID) {
			void this.activateHome();
			return;
		}
		void this.activateTabById(nextId);
	}

	/**
	 * True while a surface outside the editor shows a working indicator that has to
	 * keep moving: Home lists every tab, and zen shows a dot for each agent the bar
	 * no longer shows. The focused tab's own indicator is a loader.
	 */
	private workingIndicatorAnimating(): boolean {
		const manager = this.tabManager;
		if (!manager) return false;
		const tabs = manager.list();
		if (this.homeSelection.active) return tabs.some((tab) => isWorkingStatus(tab.status));
		if (!this.zenHidesTabBar()) return false;
		const activeId = manager.getActive().id;
		return tabs.some((tab) => tab.id !== activeId && isWorkingStatus(tab.status));
	}

	/**
	 * `Tab` / `Shift+Tab`. With zen on the bar is hidden, so the surface that would
	 * show where focus went is gone and the key is swallowed; switching stays
	 * deliberate. Consumed either way, so the editor never inserts a tab character.
	 */
	private handleTabCycle(delta: number): boolean {
		if (!this.zenHidesTabBar()) this.cycleTab(delta);
		return true;
	}

	/**
	 * Answer the app's chrome shortcuts while an extension dialog owns the keyboard. A dialog
	 * an extension opens as a capturing overlay takes focus from the composer, so every action
	 * bound with `defaultEditor.onAction` goes dead until it closes. Tab is answered here even
	 * though a dialog may want it: Tab switches agent tabs on every surface in this fork, and a
	 * dialog keeps its arrow keys for its own navigation.
	 */
	private handleExtensionDialogShortcut(data: string): { consume: boolean } | undefined {
		if (!this.hasFocusedExtensionOverlay()) return undefined;
		if (this.keybindings.matches(data, "app.tab.next")) this.handleTabCycle(1);
		else if (this.keybindings.matches(data, "app.tab.previous")) this.handleTabCycle(-1);
		else if (this.keybindings.matches(data, "app.tab.jump")) this.handleTabJumpShortcut();
		else if (this.keybindings.matches(data, "app.tab.new")) void this.handleNewTab();
		else if (this.keybindings.matches(data, "app.tab.close")) void this.handleCloseTab();
		else if (this.keybindings.matches(data, "app.palette")) this.handlePaletteShortcut();
		else if (this.keybindings.matches(data, "app.quit")) this.showQuitConfirm();
		else return undefined;
		return { consume: true };
	}

	/** Whether an extension dialog opened as an overlay currently owns the keyboard. */
	private hasFocusedExtensionOverlay(): boolean {
		for (const interactions of this.tabInteractions.values()) {
			for (const interaction of interactions) {
				if (interaction.overlay?.handle.isFocused()) return true;
			}
		}
		return false;
	}

	/**
	 * True while the focused agent's zen mode owns the tab bar. Home shows the bar
	 * again, so it navigates normally there.
	 */
	private zenHidesTabBar(): boolean {
		const manager = this.tabManager;
		if (!manager || this.homeSelection.active) return false;
		return manager.activeTab()?.zenMode === true;
	}

	/**
	 * The Home roster and tab cycle in persisted order. While a startup restore is
	 * running, a persisted tab without a runtime yet is a placeholder row, so Home
	 * shows the whole layout from the first frame; the transient startup tab is left
	 * out. Outside a restore this is just the tab-manager order.
	 */
	private homeRoster(): HomeRosterEntry[] {
		const manager = this.tabManager;
		if (!manager) return [];
		if (this.restoringTabs.length === 0) return manager.list().map((tab) => this.homeRosterEntry(tab));
		const byId = new Map(manager.list().map((tab) => [tab.id, tab]));
		return this.restoringTabs.map((entry) => {
			const tab = byId.get(entry.id);
			return tab
				? this.homeRosterEntry(tab, entry.phase)
				: {
						id: entry.id,
						status: "loading",
						unread: false,
						loadingPhase: entry.phase,
						title: entry.title,
						color: entry.color,
					};
		});
	}

	/** One live roster row, reading the loading view state rather than the raw status. */
	private homeRosterEntry(tab: AgentTab, phase?: TabLoadingPhase): HomeRosterEntry {
		return {
			id: tab.id,
			status: tab.loading ? "loading" : tab.status,
			unread: tab.unread,
			tab,
			loadingPhase: tab.loading ? (tab.loadingPhase ?? phase) : undefined,
		};
	}

	/** Focus an existing agent tab, restoring its draft and transcript. */
	private async activateTab(tab: AgentTab): Promise<void> {
		const manager = this.tabManager;
		if (!manager) return;
		const leavingHome = this.homeSelection.active;
		this.leaveHome();
		const current = manager.getActive();
		// Compare against the tab whose UI is mounted, not the manager's focus: a
		// startup restore moves the focus without switching the UI, so the two can
		// disagree and skipping the switch would leave the previous transcript up.
		if (tab.id === this.activeTabIdForUi) {
			// Home cleared the composer when it took the slot, so the draft it parked comes
			// back here; a full switch would restore it the same way.
			if (leavingHome) this.setEditorText(tab.draftInput);
			// The bound tab is already the one to focus, so nothing is rebuilt and the
			// render path that seeds the composer history does not run; seed it here.
			this.syncEditorHistory();
			// Its surfaces are back on screen, so a dialog parked for it returns too.
			this.focusTabInteractions(tab.id);
			this.ui.requestRender();
			return;
		}
		// Home's composer is ephemeral: never store its text as a tab draft. The
		// manager's focus can already be `tab` while another tab's UI is mounted,
		// so only save when the tab being left is a different one.
		if (!leavingHome && current.id !== tab.id) manager.setDraft(current.id, this.editorText());
		const active = manager.activate(tab.id);
		await this.enqueueTabSwitch(() => this.switchActiveTab(active));
	}

	/**
	 * Show MixCode Home: the transcript makes way for the Agent View, the
	 * composer is cleared, and the roster selects the agent that was focused.
	 */
	private async activateHome(): Promise<void> {
		const manager = this.tabManager;
		if (!manager || this.homeSelection.active || this.homeActivationQueued) return;
		// Guard synchronously: the state flips inside the queued callback, so a second
		// call arriving before it runs would otherwise save an already-cleared composer
		// over the tab's draft.
		this.homeActivationQueued = true;
		// Queued like any other surface change, so a pending tab switch cannot land
		// after Home and have its own `leaveHome` undo this activation.
		await this.enqueueTabSwitch(async () => {
			this.homeActivationQueued = false;
			manager.setDraft(manager.getActive().id, this.editorText());
			syncHomeSelectionToTab(this.homeSelection, this.homeRoster(), manager.getActive().id);
			// Entering Home from an agent the filter hides must still select a visible row.
			clampHomeSelectedTabIndex(this.homeSelection, this.homeRoster());
			// Home covers every tab, so a parked dialog is not shown here either; the chip and
			// the roster card report the wait until the user goes back to the tab.
			// Mounting is keyed to the attached tab, which is not always the manager's focus.
			if (this.activeTabIdForUi) this.parkTabInteractions(this.activeTabIdForUi);
			this.homeSelection.active = true;
			this.applyFullscreenScrollbarSetting();
			// Vim is a modal surface over an agent transcript; Home is a different
			// surface, so the composer must not stay locked behind it.
			this.leaveVimMode();
			this.setEditorText("");
			this.updateEditorBorderColor();
			this.parkFooterForHome();
			this.hideStatusForHome();
			this.requestWidgetRender();
			this.documentContainer.clear();
			if (this.homeView) this.documentContainer.addChild(this.homeView);
			// The transcript's blocks are a different set now; drop the windowed height table.
			this.windowedTranscript?.resetMeasurements();
			this.transcriptScrollView?.scrollToStart();
			this.updateTerminalTitle();
			this.ui.requestRender();
		});
	}

	/** Put the bound tab's transcript back and drop Home's ephemeral composer text. */
	private leaveHome(): void {
		if (!this.homeSelection.active) return;
		this.homeSelection.active = false;
		this.applyFullscreenScrollbarSetting();
		this.homeView?.resetCapture();
		this.setEditorText("");
		this.updateEditorBorderColor();
		this.restoreFooterAfterHome();
		this.requestWidgetRender();
		this.restoreStatusAfterHome();
		this.buildDocumentChildren();
		// Back to the agent transcript: the height table describes Home now, but the
		// blocks themselves are unchanged, so their rendered lines are kept.
		this.windowedTranscript?.resetMeasurements();
	}

	/**
	 * Rebuild the transcript in paint order. Every surface that puts the transcript
	 * back goes through here, so the inline widget block cannot be dropped from one
	 * of them; Home clears the container and mounts its own view instead.
	 */
	private buildDocumentChildren(): void {
		this.documentContainer.clear();
		this.documentContainer.addChild(this.headerContainer);
		this.documentContainer.addChild(this.loadedResourcesContainer);
		this.documentContainer.addChild(this.chatContainer);
		// The inline block is the document's last child.
		this.documentContainer.addChild(this.inlineWidgets);
	}

	/**
	 * Messages the windowed transcript renders, in paint order. The chat's own
	 * children are the windowed units, so a block is one message rather than the
	 * whole conversation: matching a message (vim mode's user-message jump) and
	 * measuring one block stay cheap however long the chat is. A surface that
	 * swaps the whole document (MixCode Home) still shows up as its own block.
	 *
	 * The flattened list is cached against the two child arrays. One frame reads it
	 * several times, and rebuilding it each time would make frame cost grow with the
	 * conversation. `Container.addChild` grows the same array and `clear` replaces
	 * it, so the array reference plus its length notices every change the app makes.
	 */
	private transcriptBlocks(): Component[] {
		const documentChildren = this.documentContainer.children;
		const chatChildren = this.chatContainer.children;
		const cache = this.transcriptBlocksCache;
		if (
			cache &&
			cache.documentChildren === documentChildren &&
			cache.chatChildren === chatChildren &&
			cache.documentLength === documentChildren.length &&
			cache.chatLength === chatChildren.length
		) {
			return cache.blocks;
		}
		const blocks = documentChildren.flatMap((child) => (child === this.chatContainer ? [...chatChildren] : [child]));
		this.transcriptBlocksCache = {
			documentChildren,
			chatChildren,
			documentLength: documentChildren.length,
			chatLength: chatChildren.length,
			blocks,
		};
		return blocks;
	}

	/** Home shows no footer: cwd, usage, and extension statuses are per-agent chrome. */
	private parkFooterForHome(replace = false): void {
		if (this.homeParkedFooter && !replace) return;
		this.homeParkedFooter = [...this.footerContainer.children];
		this.footerContainer.clear();
	}

	/**
	 * Home paints no working chrome. The indicator stays tracked and the area's
	 * other rows are parked, so the way back restores the same height.
	 */
	private hideStatusForHome(): void {
		if (this.homeParkedStatus) return;
		this.homeParkedStatus = [...this.statusContainer.children];
		this.statusContainer.clear();
		this.setEditorWorkingStatusIndicator(undefined);
	}

	/** Show the tracked indicator again, or put the parked rows back. */
	private restoreStatusAfterHome(): void {
		const parked = this.homeParkedStatus ?? [];
		this.homeParkedStatus = undefined;
		this.statusContainer.clear();
		const indicator = this.activeStatusIndicator;
		if (!indicator) {
			for (const child of parked) this.statusContainer.addChild(child);
			return;
		}
		if (this.setEditorWorkingStatusIndicator(indicator)) {
			this.activeWorkingIndicatorEmbedded = true;
			return;
		}
		this.activeWorkingIndicatorEmbedded = false;
		this.statusContainer.addChild(indicator);
	}

	/** Put the footer back, whichever children were there (built-in or extension). */
	private restoreFooterAfterHome(): void {
		const parked = this.homeParkedFooter;
		if (!parked) return;
		this.homeParkedFooter = undefined;
		// A tab switch restores its own footer through attachTabUi; only an empty
		// container is this call's to refill.
		if (this.footerContainer.children.length > 0) return;
		for (const child of parked) this.footerContainer.addChild(child);
	}

	/**
	 * Everything the composer chrome reads, gathered from the live tab set. The
	 * rendering lives in `composer-state.ts`; this resolves the inputs.
	 *
	 * `readUsage` stays a callback because `contextUsage()` rebuilds the session
	 * projection on a cache miss, and the placeholder never reads it.
	 */
	private composerContext(): ComposerContext {
		const state = this.session.state;
		return {
			homeSelection: this.homeSelection,
			tabs: this.tabManager?.list(),
			activeTabTitle: this.tabManager?.activeTab()?.title,
			vimActive: this.vimTabState().active,
			zenMode: this.zenHidesTabBar(),
			shellMode: this.isBashMode,
			uiMode: this.ui.mode,
			// Home composes for a tab it is not attached to, so it shows no context reading.
			readUsage: () => (this.homeSelection.active ? undefined : this.contextUsage()),
			fallbackContextWindow: state.model?.contextWindow ?? 0,
			contextLimitOverridden: this.hasContextLimitOverride(),
		};
	}

	/**
	 * True while the tab in front runs with a live `/context-limit` override. Read
	 * from the override's own model, so a session model swapped behind it (a
	 * reload, an extension) reports no override even before the reconcile runs.
	 */
	private hasContextLimitOverride(): boolean {
		const tab = this.tabManager?.activeTab();
		return tab !== undefined && isContextLimitActive(tab, tab.runtime.session);
	}

	/**
	 * Open the picker behind a click on the dock meta row. A capturing overlay
	 * owns the screen, so the click is dropped there: the selector would open
	 * behind it and take focus only once the overlay is gone. A non-capturing
	 * notice owns nothing, so the chrome stays live under it. Home parks the
	 * whole footer, so a click can only arrive from a live agent tab.
	 */
	private openMetaPicker(action: MetaAction): void {
		if (this.ui.hasCapturingOverlay()) return;
		if (action === "models") {
			this.showModelSelector();
			return;
		}
		if (action === "workdir") {
			this.openWorkdirPicker();
			return;
		}
		this.showThinkingSelector();
	}

	/** Session data for the dock meta row under the input card. */
	private dockMetaData(): InputMetaData {
		const state = this.session.state;
		const model = state.model;
		const usage = this.contextUsage();
		const thinking = state.thinkingLevel || "off";
		return {
			workdir: this.displayWorkdir(this.sessionManager.getCwd()),
			model: this.displayOverride("model") ?? (model ? `${model.provider}/${model.id}` : "-"),
			thinking: this.displayOverride("thinking") ?? thinking.charAt(0).toUpperCase() + thinking.slice(1),
			gitBranch: this.footerDataProvider.getGitBranch() ?? undefined,
			contextTokens: usage?.tokens,
			contextWindow: usage?.contextWindow ?? model?.contextWindow ?? 0,
			extensionStatuses: this.footerDataProvider.getExtensionStatuses(),
			statusesHidden: this.vimTabState().active,
			iconMode: this.mixcodeSettings.ui.icons.mode,
		};
	}

	/**
	 * Context reading for the card edge and the dock meta row, kept until the
	 * session's messages change. `getContextUsage()` rebuilds the session
	 * projection, and both readers run on every TUI frame.
	 */
	private contextUsage(): ContextUsage | undefined {
		const session = this.session;
		const source = session.messages;
		const model = session.state.model;
		const cached = this.contextUsageCache;
		if (
			cached &&
			cached.session === session &&
			cached.source === source &&
			cached.length === source.length &&
			cached.model === model
		) {
			return cached.value;
		}
		const value = session.getContextUsage();
		this.contextUsageCache = { session, source, length: source.length, model, value };
		return value;
	}

	/** Editor text, whichever editor component the current tab installed. */
	private editorText(): string {
		return this.editor.getText();
	}

	/** Set the text on both the default editor and any tab-installed replacement. */
	private setEditorText(text: string): void {
		this.defaultEditor.setText(text);
		if (this.editor !== this.defaultEditor) this.editor.setText(text);
	}

	/** Park the composer's text as the draft of the tab on screen; Home's composer owns no draft. */
	private saveComposerDraft(): void {
		const manager = this.tabManager;
		if (!manager || this.homeSelection.active) return;
		manager.setDraft(manager.getActive().id, this.editorText());
	}

	/**
	 * Serialize tab transitions so rapid switching cannot interleave and leave
	 * the editor showing another tab's draft.
	 */
	private enqueueTabSwitch(run: () => Promise<void>): Promise<void> {
		const next = this.tabSwitchQueue.then(run, run).catch((error: unknown) => {
			this.showError(`Tab switch failed: ${error instanceof Error ? error.message : String(error)}`);
		});
		this.tabSwitchQueue = next;
		return next;
	}

	private async activateTabById(id: string): Promise<void> {
		if (id === HOME_TAB_ID) {
			await this.activateHome();
			return;
		}
		const tab = this.tabManager?.get(id);
		if (tab) await this.activateTab(tab);
	}

	// -----------------------------------------------------------------------
	// MixCode Home surface
	// -----------------------------------------------------------------------

	/**
	 * Environment override that pins one displayed field, or undefined when unset.
	 * The three `MPI_DISPLAY_*` variables are read only here.
	 */
	private displayOverride(field: "model" | "thinking" | "workdir"): string | undefined {
		const raw = {
			model: process.env.MPI_DISPLAY_MODEL,
			thinking: process.env.MPI_DISPLAY_THINKING,
			workdir: process.env.MPI_DISPLAY_WORKDIR,
		}[field];
		return raw?.trim() || undefined;
	}

	private displayWorkdir(fallback: string): string {
		return this.displayOverride("workdir") ?? fallback;
	}

	private getHomeViewModel(): HomeViewModel {
		const roster = this.homeRoster();
		return {
			version: this.version,
			workdir: this.displayWorkdir(this.tabsWorkdir),
			workingCount: roster.filter((entry) => isWorkingStatus(entry.status)).length,
			waitingCount: roster.filter((entry) => entry.tab !== undefined && this.tabWaitingForInput(entry.tab.id))
				.length,
			agents: roster.map((entry) => {
				// A persisted tab whose runtime does not exist yet has no transcript to
				// preview; its card carries the loading phase instead.
				if (!entry.tab) return { card: this.homePlaceholderCard(entry), messages: [] };
				const snapshot = this.homeSnapshotFor(entry.tab);
				return { card: this.homeCardFor(entry.tab, snapshot), messages: snapshot.messages };
			}),
			packageUpdates: this.packageUpdates,
			selectedIndex: this.homeSelection.selectedIndex,
			nonIdleOnly: this.homeSelection.nonIdleOnly,
			// A dialog that opens over the page must drop any captured button press.
			overlayOpen: this.ui.hasOverlay(),
		};
	}

	/** Card for a persisted tab still being restored: no model, tokens, or transcript yet. */
	private homePlaceholderCard(entry: HomeRosterEntry): HomeCard {
		return {
			id: entry.id,
			title: entry.title ?? entry.id,
			status: "loading",
			unread: false,
			color: entry.color,
			loadingPhase: entry.loadingPhase,
			tokens: null,
			contextWindow: 0,
		};
	}

	private homeCardFor(tab: AgentTab, snapshot: HomeSnapshot): HomeCard {
		const session = tab.runtime.session;
		const override = this.displayOverride("model");
		const modelId = session.model?.id;
		return {
			id: tab.id,
			title: tab.title,
			status: tab.loading ? "loading" : tab.status,
			unread: tab.unread,
			waiting: this.tabWaitingForInput(tab.id),
			color: tab.color,
			loadingPhase: tab.loading ? tab.loadingPhase : undefined,
			workingStartedAt: tab.workingStartedAt,
			lastWorkedAt: tab.lastWorkedAt,
			workdir: this.displayWorkdir(tab.runtime.cwd),
			model: override || (modelId ? (modelId.split("/").pop() ?? modelId) : undefined),
			tokens: snapshot.tokens,
			contextWindow: snapshot.contextWindow,
		};
	}

	/**
	 * Transcript tail plus context usage for a card, computed once per transcript
	 * change. Both are per-frame reads otherwise: `getContextUsage()` rebuilds the
	 * session projection and `mapHomeMessages` extracts text from every message,
	 * and the Home page renders on every TUI frame.
	 */
	private homeSnapshotFor(tab: AgentTab): HomeSnapshot {
		const session = tab.runtime.session;
		const source = session.messages;
		const newest = source[source.length - 1];
		const newestText = newest ? (homePreviewOf(newest)?.text ?? "") : "";
		const cached = this.homeMessageCache.get(tab.id);
		if (
			cached &&
			cached.source === source &&
			cached.length === source.length &&
			cached.newest === newest &&
			cached.newestText === newestText
		) {
			return cached;
		}
		const usage = session.getContextUsage();
		const snapshot: HomeSnapshot = {
			source,
			length: source.length,
			newest,
			newestText,
			messages: mapHomeMessages(source),
			tokens: usage?.tokens ?? null,
			contextWindow: usage?.contextWindow ?? session.model?.contextWindow ?? 0,
		};
		this.homeMessageCache.set(tab.id, snapshot);
		return snapshot;
	}

	/**
	 * Row budget used before the transcript viewport has been measured (the
	 * regular main-screen renderer never measures it). The tab bar's own height
	 * comes out of the budget, so a wrapping bar cannot push the page past the
	 * viewport; an overflowing page would scroll the Home chip off the top.
	 */
	private homeHeightFallback(): number {
		const width = this.ui.terminal.columns;
		const barRows = this.tabBarContainer?.render(width).length ?? 0;
		// Under-estimate on purpose: the editor (at least 3 rows), footer, status
		// line, and widgets take the rest.
		return Math.max(4, this.ui.terminal.rows - barRows - 6);
	}

	/** Run a heading button's command on the tab the roster has selected. */
	private async runHomeAction(action: HomeAction): Promise<void> {
		const manager = this.tabManager;
		if (!manager || !this.homeSelection.active) return;
		// Dim the buttons and ignore further presses until the command finishes.
		this.homeView?.setActionPending(true);
		this.ui.requestRender();
		try {
			// Slash commands run against the bound session, so the selected tab is
			// attached first, the same routing the composer's commands use.
			const selected = homeSelectedTab(this.homeSelection, this.homeRoster());
			if (selected?.tab && manager.getActive().id !== selected.id) await this.activateTab(selected.tab);
			await this.defaultEditor.onSubmit?.(`/${action}`);
		} finally {
			this.homeView?.setActionPending(false);
			this.homeView?.resetCapture();
			this.ui.requestRender();
		}
	}

	/** `up`/`down` on Home. Declines the key anywhere else so the editor keeps it. */
	private handleHomeSelect(delta: number): boolean {
		const manager = this.tabManager;
		if (!manager || !this.homeSelection.active || this.ui.hasOverlay()) return false;
		if (isShowingAutocomplete(this.editor)) return false;
		const roster = this.homeRoster();
		if (roster.length === 0) return false;
		// A multi-line composer needs the arrows for its caret, as on an agent tab.
		if (this.editorText().includes("\n")) return false;
		moveHomeSelection(this.homeSelection, roster, delta);
		this.ui.requestRender();
		return true;
	}

	private handleHomeToggleNonIdle(): boolean {
		const manager = this.tabManager;
		if (!manager || !this.homeSelection.active || this.ui.hasOverlay()) return false;
		if (isShowingAutocomplete(this.editor)) return false;
		const roster = this.homeRoster();
		if (roster.length === 0) return false;
		toggleHomeNonIdleOnly(this.homeSelection, roster);
		this.ui.requestRender();
		return true;
	}

	/** `right` on Home: attach to the selected agent. An empty composer is required. */
	private handleHomeAttach(): boolean {
		const manager = this.tabManager;
		if (!manager || !this.homeSelection.active || this.ui.hasOverlay()) return false;
		if (isShowingAutocomplete(this.editor)) return false;
		if (this.editorText().length > 0) return false;
		const roster = this.homeRoster();
		if (this.homeSelectionIsHidden(roster)) return true;
		const selected = homeSelectedTab(this.homeSelection, roster);
		if (!selected) return false;
		// A persisted tab still loading has no runtime to attach to yet.
		if (selected.tab) void this.activateTab(selected.tab);
		return true;
	}

	/** `!shell` runs through the shared bash handling, which acts on the active session. */
	private static isHomeCommandInput(text: string): boolean {
		return text.startsWith("/") || text.startsWith("!");
	}

	/**
	 * `enter` on Home. Plain text goes to the selected tab's session while Home
	 * keeps focus; a `/command` or `!shell` acts on the bound session, so it
	 * attaches first and then submits through the normal dispatcher.
	 *
	 * `data` is the raw key: the `enter` binding also matches a bare newline
	 * (`ctrl+j`), which must keep inserting a newline in the composer.
	 */
	private handleHomeSend(data: string): boolean {
		const manager = this.tabManager;
		if (!manager || !this.homeSelection.active || this.ui.hasOverlay()) return false;
		if (isShowingAutocomplete(this.editor)) return false;
		if (data === "\n") return false;
		const roster = this.homeRoster();
		if (roster.length === 0) return false;
		const text = (this.editor.getExpandedText?.() ?? this.editorText()).trim();
		if (!text) return true;
		if (this.homeSelectionIsHidden(roster)) return true;
		const selected = homeSelectedTab(this.homeSelection, roster);
		if (!selected) return false;
		// A persisted tab still loading has no session to receive the message yet.
		const tab = selected.tab;
		if (!tab) return true;
		this.setEditorText("");
		this.editor.addToHistory?.(text);
		if (InteractiveMode.isHomeCommandInput(text)) {
			void (async () => {
				await this.activateTab(tab);
				this.setEditorText(text);
				await this.defaultEditor.onSubmit?.(text);
			})();
			return true;
		}
		const session = tab.runtime.session;
		// A streaming agent takes the message as steering. A compacting one errors instead:
		// the composer's queue belongs to the bound session, not to an arbitrary roster tab.
		const options = session.isStreaming ? { streamingBehavior: "steer" as const } : undefined;
		runInTabConsole(tab, () => session.prompt(text, options)).then(
			() => this.ui.requestRender(),
			(error: unknown) => {
				// Put the message back so the user can retry after fixing the cause.
				this.setEditorText(text);
				this.showError(`Send failed: ${error instanceof Error ? error.message : String(error)}`);
				this.ui.requestRender();
			},
		);
		return true;
	}

	/** `left` from an agent tab with an empty composer returns to Home. */
	private handleHomeReturn(): boolean {
		const manager = this.tabManager;
		if (!manager || this.homeSelection.active || this.ui.hasOverlay()) return false;
		if (isShowingAutocomplete(this.editor)) return false;
		if (this.editorText().length > 0) return false;
		void this.activateHome();
		return true;
	}

	/** True when the non-idle filter hides the selected row, so Home cannot act on it. */
	private homeSelectionIsHidden(tabs: readonly HomeRosterTab[]): boolean {
		if (!this.homeSelection.nonIdleOnly) return false;
		return !visibleRosterIndices(this.homeSelection.nonIdleOnly, tabs).includes(this.homeSelection.selectedIndex);
	}

	/**
	 * Swap the rendered session to `tab`.
	 *
	 * The outgoing tab's extension UI and transcript are set aside for reuse, the
	 * incoming tab's are restored (or rebuilt when its session changed), and the
	 * frame is requested before extensions are bound. Binding emits
	 * `session_start`, so it runs only for a session that has not been bound yet.
	 */
	private async switchActiveTab(tab: AgentTab): Promise<void> {
		this.leaveHome();
		if (this.activeTabIdForUi && this.activeTabIdForUi !== tab.id) {
			this.captureTranscript(this.activeTabIdForUi);
			this.detachTabUi(this.activeTabIdForUi);
		}
		this.unsubscribe?.();
		this.unsubscribe = undefined;
		this.runtimeHost = tab.runtime;
		// The outgoing tab's UI is detached above, so the mounted UI is this tab's from
		// here on. `attachTabUi` decides the widget placement from it.
		this.activeTabIdForUi = tab.id;
		// A rebuilt transcript is built with this tab's own thinking label; the plain
		// field write keeps that off the per-block setter, which re-measures them all.
		this.hiddenThinkingLabel = this.tabUi.get(tab.id)?.hiddenThinkingLabel;
		// A settings write in another tab, or outside the app, leaves this tab's manager on
		// what it was built with; re-read it before the switch applies those values.
		await this.settingsManager.reload();
		applySessionCopiedSettings(this.session);
		this.applyRuntimeSettings();
		if (!this.restoreTranscript(tab.id)) this.renderCurrentSessionState();
		// A warmed restored tab shows its parked transcript without re-rendering, so
		// the render path that seeds the composer history is bypassed; seed it here.
		this.syncEditorHistory();
		// The windowed table stays: the reused transcript is the same component
		// instances, and each block caches its own render against its content, so a
		// quiet switch repaints without re-rendering the conversation. A rebuilt
		// transcript has all-new components, which start with no measurements.
		this.subscribeToAgent();
		this.attachTabUi(tab.id);
		// A tab bound in the background still owes its own resources block and theme
		// registry; the block belongs to the transcript, so both wait for this focus.
		if (this.pendingResourcesBlocks.delete(tab.id)) {
			setRegisteredThemes(tab.runtime.session.resourceLoader.getThemes().themes);
			this.showLoadedResources({ force: false, showDiagnosticsWhenQuiet: true });
		}
		// The shared status line belongs to the previously active session; sync it
		// to the newly active tab instead of leaving a stale "Working" indicator.
		if (this.session.isStreaming || this.session.isCompacting) this.showWorkingStatusIndicator();
		else this.clearStatusIndicator();
		this.setEditorText(tab.draftInput);
		this.updateAvailableProviderCount();
		this.updateEditorBorderColor();
		this.updateTerminalTitle();
		// The incoming tab owns its own transient message, if it still has one.
		this.syncToast();
		this.hideUserMessagePreview();
		// A dialog parked on this tab while another one was in front comes back with it.
		this.focusTabInteractions(tab.id);
		this.ui.requestRender();
		this.ensureSessionBound(tab);
	}

	/**
	 * Signature of a session's transcript: entry count, last entry id, and whether
	 * it is streaming. Rebuilding a long transcript is expensive, so a tab whose
	 * signature is unchanged reuses the components built for it last time.
	 */
	private transcriptSignature(): string {
		const branch = this.sessionManager.getBranch();
		const last = branch[branch.length - 1]?.id ?? "";
		return `${branch.length}:${last}:${this.session.isStreaming ? "s" : ""}`;
	}

	/**
	 * Build a tab's transcript without showing it, then park it for reuse.
	 *
	 * A restored tab has a bound runtime but no UI, so its first visit would otherwise
	 * build every block and render the window cold. Building here pays that at startup,
	 * beside the bind that already walks its resources, and the parked components carry
	 * their own rendered lines, so the first switch repaints them instead of rebuilding.
	 */
	private warmTabTranscript(tab: AgentTab): void {
		// The warm pass renders into the shared chat container and then clears it. While a tab is on
		// screen that container holds that tab's live transcript, so warming is limited to Home,
		// where the container is parked; a tab's focus path builds its transcript on demand instead.
		if (!this.homeSelection.active) return;
		const previousHost = this.runtimeHost;
		const previousTabId = this.activeTabIdForUi;
		const previousLabel = this.hiddenThinkingLabel;
		try {
			this.runtimeHost = tab.runtime;
			this.activeTabIdForUi = tab.id;
			this.hiddenThinkingLabel = this.tabUi.get(tab.id)?.hiddenThinkingLabel;
			// Leave the shared footer and the editor history alone: this build is not a visit.
			this.renderSessionEntries(this.sessionManager.buildContextEntries(), { updateFooter: false });
			// Render the parked blocks: each keeps its own rendered lines, so the first
			// visit repaints rows it already has instead of rendering the window cold.
			// The windowed container is not used here because it reads its block list
			// from the mounted document, which still shows Home while this runs.
			const warmWidth = Math.max(1, this.ui.terminal.columns);
			for (const block of this.chatContainer.children) block.render(warmWidth);
			this.captureTranscript(tab.id);
		} catch {
			// A tab that cannot build is left cold; the focus path rebuilds it on demand.
		} finally {
			this.runtimeHost = previousHost;
			this.activeTabIdForUi = previousTabId;
			this.hiddenThinkingLabel = previousLabel;
		}
	}

	/** Move the outgoing tab's transcript components aside for reuse; do not dispose them. */
	private captureTranscript(tabId: string): void {
		this.tabTranscript.set(tabId, {
			signature: this.transcriptSignature(),
			chat: [...this.chatContainer.children],
			loaded: [...this.loadedResourcesContainer.children],
		});
		this.chatContainer.clear();
		this.loadedResourcesContainer.clear();
	}

	/** Re-attach a cached transcript when it is still current. Returns false to rebuild. */
	private restoreTranscript(tabId: string): boolean {
		const cached = this.tabTranscript.get(tabId);
		if (!cached || cached.signature !== this.transcriptSignature()) return false;
		this.chatContainer.clear();
		for (const child of cached.chat) this.chatContainer.addChild(child);
		this.loadedResourcesContainer.clear();
		for (const child of cached.loaded) this.loadedResourcesContainer.addChild(child);
		this.pendingMessagesContainer.clear();
		this.pendingTools.clear();
		this.streamingComponent = undefined;
		this.streamingMessage = undefined;
		this.resyncQueuedMessageMirrors();
		this.updatePendingMessagesDisplay();
		return true;
	}

	private ensureSessionBound(tab: AgentTab): void {
		const session = tab.runtime.session;
		if (this.boundSessions?.has(session)) {
			// Shortcuts are per-session but cheap to (re)apply on each switch.
			this.setupExtensionShortcuts(session.extensionRunner);
			this.markTabReady(session);
			return;
		}
		// The tab is shown now; its extensions bind in the background and their chrome
		// is mounted when they land, so a first visit never waits for them.
		this.queueTabBind(tab);
	}

	/** A submit needs the focused tab bound: `session_start` installs what it dispatches. */
	private async ensureSessionBoundForSubmit(): Promise<void> {
		const tab = this.tabManager?.activeTab();
		if (!tab) return;
		if (this.boundSessions?.has(tab.runtime.session)) return;
		await this.bindTabExtensions(tab);
	}

	/** Queue a tab's extensions to be bound in the background. */
	private queueTabBind(tab: AgentTab): void {
		const session = tab.runtime.session;
		if (this.boundSessions?.has(session) || this.bindingSessions.has(session)) return;
		if (!this.pendingTabBinds.includes(tab)) this.pendingTabBinds.push(tab);
		if (this.bindWorkerRunning) return;
		this.bindWorkerRunning = true;
		void this.runTabBindWorker();
	}

	/**
	 * Bind queued tabs, one at a time. The worker is a queue rather than a pool because a bind
	 * is filesystem-bound and runs on the main thread: a wider fan-out does not finish earlier,
	 * it only makes every walk slower.
	 *
	 * The queue drains as soon as a tab is queued. The walk a bind runs is synchronous, so it
	 * freezes the UI wherever it happens; a switch that has to wait for it is far more visible
	 * than a busy first seconds after launch.
	 */
	private async runTabBindWorker(): Promise<void> {
		for (;;) {
			const tab = this.pendingTabBinds.shift();
			if (!tab) break;
			// A tab closed while it waited has no runtime left to bind.
			if (!this.tabManager?.get(tab.id)) continue;
			await this.bindTabExtensions(tab);
		}
		this.bindWorkerRunning = false;
		// A tab queued while the worker was draining still needs its bind.
		if (this.pendingTabBinds.length > 0) this.queueTabBind(this.pendingTabBinds[0]!);
	}

	/**
	 * Bind a tab's extensions once, in the background.
	 *
	 * `session_start` handlers do their filesystem work on the main thread, and a
	 * walk of the skill directories takes seconds on a network filesystem, so the bind
	 * is started only after the frame the caller asked for is on screen. The bind is
	 * started at most once per session and never rejects: a tab whose bind fails
	 * stays unbound, and the next focus tries again.
	 */
	private async bindTabExtensions(tab: AgentTab): Promise<void> {
		const session = tab.runtime.session;
		if (this.boundSessions?.has(session)) return;
		const inFlight = this.bindingSessions.get(session);
		if (inFlight) return inFlight;
		const bind = new Promise<void>((resolve) => {
			// A queued render is scheduled on `nextTick`; a timer registered from one
			// runs after it, so the switch's frame paints before this blocks the loop.
			process.nextTick(() => setTimeout(resolve, 0));
		})
			.then(() => this.bindCurrentSessionExtensions({ runtime: tab.runtime, backgroundTabId: tab.id }))
			.then(
				() => {
					this.bindingSessions.delete(session);
					this.boundSessions ??= new WeakSet<AgentSession>();
					this.boundSessions.add(session);
					this.mountBoundTabChrome(tab);
					this.markTabReady(session);
				},
				() => {
					this.bindingSessions.delete(session);
					// A tab whose bind failed is not left spinning: show the failure, and let
					// the next focus try the bind again.
					if (this.tabManager?.get(tab.id)) {
						tab.loading = false;
						tab.loadingPhase = undefined;
						tab.status = "error";
						this.ui.requestRender();
					}
				},
			);
		this.bindingSessions.set(session, bind);
		return bind;
	}

	/** A tab is loading until its runtime is bound; clear it once the session is ready. */
	private markTabReady(session: AgentSession): void {
		const tab = this.tabManager?.list().find((item) => item.runtime.session === session);
		if (tab) this.tabManager?.markLoaded(tab.id);
	}

	/**
	 * Show the chrome a background bind recorded. It is mounted now when the tab is the
	 * focused one, and otherwise by the next switch, which also paints the tab's
	 * startup resources block into that tab's own transcript.
	 */
	private mountBoundTabChrome(tab: AgentTab): void {
		if (this.activeTabIdForUi !== tab.id) {
			this.pendingResourcesBlocks.add(tab.id);
			return;
		}
		this.attachTabUi(tab.id);
		setRegisteredThemes(tab.runtime.session.resourceLoader.getThemes().themes);
		this.setupExtensionShortcuts(tab.runtime.session.extensionRunner);
		this.applyRuntimeSettings();
		this.showLoadedResources({ force: false, showDiagnosticsWhenQuiet: true });
		// `attachTabUi` mounts this tab's editor skin, which takes the slot a dialog of
		// this tab may be holding; the dialog goes back on top of it.
		this.focusTabInteractions(tab.id);
		this.requestWidgetRender();
		this.ui.requestRender();
	}

	/** Move the active tab's extension UI aside (widgets are kept alive, not disposed). */
	private detachTabUi(tabId: string): void {
		const leavingHeader = this.customHeader;
		this.tabUi.set(tabId, {
			widgetsAbove: this.extensionWidgetsAbove,
			widgetsBelow: this.extensionWidgetsBelow,
			footerFactory: this.customFooterFactory,
			headerFactory: this.customHeaderFactory,
			statuses: new Map(this.footerDataProvider.getExtensionStatuses()),
			autocompleteWrappers: this.autocompleteProviderWrappers,
			editorFactory: this.editorComponentFactory,
			workingMessage: this.workingMessage,
			workingVisible: this.workingVisible,
			workingIndicatorOptions: this.workingIndicatorOptions,
			hiddenThinkingLabel: this.hiddenThinkingLabel,
			toolsExpanded: this.toolOutputExpanded,
			// A notice queued by a background bind is not shown yet; keep it.
			notices: this.tabUi.get(tabId)?.notices ?? [],
		});
		// Footer/header are rebuilt from their factories on re-attach, so dispose
		// the outgoing instances instead of orphaning them.
		this.customFooter?.dispose?.();
		this.customHeader?.dispose?.();
		// Reset live UI to a clean slate for the incoming tab.
		this.extensionWidgetsAbove = new Map();
		this.extensionWidgetsBelow = new Map();
		this.customFooter = undefined;
		this.customFooterFactory = undefined;
		this.customHeader = undefined;
		this.customHeaderFactory = undefined;
		this.autocompleteProviderWrappers = [];
		this.editorComponentFactory = undefined;
		this.workingMessage = undefined;
		this.workingVisible = true;
		this.workingIndicatorOptions = undefined;
		this.hiddenThinkingLabel = undefined;
		this.toolOutputExpanded = false;
		this.footerDataProvider.clearExtensionStatuses();
		// The tab's pending dialogs park with it: the extension still waits for its answer, the
		// dialog comes back with the tab, and the chip reports the wait meanwhile. An overlay of
		// this tab stays in the stack, where its focus gate keeps it off the screen.
		this.parkTabInteractions(tabId);
		this.detachExtensionTerminalInputListeners(tabId);
		this.defaultEditor.onExtensionShortcut = undefined;
		this.restoreBuiltInChrome(leavingHeader);
	}

	/** Mount a tab's saved extension UI into the live fields. */
	private attachTabUi(tabId: string): void {
		const ui = this.tabUi.get(tabId);
		this.extensionWidgetsAbove = ui?.widgetsAbove ?? new Map();
		this.extensionWidgetsBelow = ui?.widgetsBelow ?? new Map();
		this.customFooter = undefined;
		this.customFooterFactory = undefined;
		this.customHeader = undefined;
		this.customHeaderFactory = undefined;
		this.autocompleteProviderWrappers = ui?.autocompleteWrappers ?? [];
		this.applyTabWorkingState(ui);
		this.footerDataProvider.clearExtensionStatuses();
		for (const [key, value] of ui?.statuses ?? []) this.footerDataProvider.setExtensionStatus(key, value);
		this.setExtensionFooter(ui?.footerFactory);
		this.setExtensionHeader(ui?.headerFactory);
		this.setCustomEditorComponent(ui?.editorFactory);
		this.setupAutocompleteProvider();
		this.requestWidgetRender();
		this.footer.invalidate();
		// Notices an extension raised while this tab was not the focused one belong to
		// its transcript, which is mounted by now.
		if (ui && ui.notices.length > 0) {
			const notices = ui.notices;
			ui.notices = [];
			for (const notice of notices) this.showExtensionNotify(notice.message, notice.type);
		}
		this.attachExtensionTerminalInputListeners(tabId);
	}

	/** Apply the streaming and thinking state a tab owned while it was not focused. */
	private applyTabWorkingState(ui: TabExtensionUi | undefined): void {
		// Plain field writes only: the transcript's own blocks carry the label they were
		// built with, and re-applying it through the setter would re-measure every one
		// of them on each switch.
		this.workingMessage = ui?.workingMessage;
		this.workingVisible = ui?.workingVisible ?? true;
		this.workingIndicatorOptions = ui?.workingIndicatorOptions;
		this.hiddenThinkingLabel = ui?.hiddenThinkingLabel;
		this.toolOutputExpanded = ui?.toolsExpanded ?? false;
	}

	/** Remove any custom footer/header and show the built-ins (without disposing the tab's copies). */
	private restoreBuiltInChrome(leavingHeader: (Component & { dispose?(): void }) | undefined): void {
		this.footerContainer.clear();
		this.footerContainer.addChild(this.footer);
		if (this.builtInHeader && leavingHeader) {
			const index = this.headerContainer.children.indexOf(leavingHeader);
			if (index >= 0) {
				if (isExpandable(this.builtInHeader)) this.builtInHeader.setExpanded(this.toolOutputExpanded);
				this.headerContainer.children[index] = this.builtInHeader;
			}
		}
		this.requestWidgetRender();
	}

	/** Dispose and forget a closed tab's extension UI and its pending dialogs. */
	private disposeTabUi(tabId: string): void {
		this.tabTranscript.delete(tabId);
		this.inlineWidgetTabStates.delete(tabId);
		this.widgetPanelTabStates.delete(tabId);
		this.pendingResourcesBlocks.delete(tabId);
		this.forgetTabInteractions(tabId);
		const ui = this.tabUi.get(tabId);
		if (!ui) return;
		this.tabUi.delete(tabId);
		for (const widget of ui.widgetsAbove.values()) widget.dispose?.();
		for (const widget of ui.widgetsBelow.values()) widget.dispose?.();
	}

	/**
	 * `/workdir [path]`: with a path, move the active tab there; without one, open the
	 * picker and let it choose. The picker opens on the tab's current workdir.
	 */
	private async handleWorkdirCommand(target: string): Promise<void> {
		if (!target) {
			this.openWorkdirPicker();
			return;
		}
		await this.applyWorkdir(target);
	}

	/**
	 * Open the workdir picker over the dock. The picker answers the keyboard only;
	 * the workdir badge in the meta row opens this same overlay.
	 */
	private openWorkdirPicker(): void {
		// A capturing overlay owns the screen, so a click must not stack a second picker under it.
		if (this.ui.hasCapturingOverlay()) return;
		let handle: OverlayHandle | undefined;
		const picker = new WorkdirPickerComponent({
			startDir: this.sessionManager.getCwd(),
			terminalRows: () => this.ui.terminal.rows,
			onChoose: (dir) => {
				handle?.hide();
				void this.applyWorkdir(dir);
			},
			onCancel: () => handle?.hide(),
		});
		handle = this.ui.showOverlay(picker, {
			anchor: "center",
			width: `${WORKDIR_PICKER_WIDTH_PERCENT}%`,
			maxHeight: `${WORKDIR_PICKER_HEIGHT_PERCENT}%`,
			margin: 1,
		});
	}

	/**
	 * Move the active tab onto `target`. The picker resolves its own paths, so `target` is a path
	 * as typed: relative to the tab's workdir, or absolute.
	 */
	private async applyWorkdir(target: string): Promise<void> {
		// A move tears the session down and rebuilds it, so the same two preconditions
		// `/reload` refuses on apply here: nothing may be mid-turn.
		if (this.session.isStreaming) {
			this.showError("Cannot change workdir while the agent is streaming");
			return;
		}
		if (this.session.isCompacting) {
			this.showError("Cannot change workdir while compaction is running");
			return;
		}

		const current = this.sessionManager.getCwd();
		const resolved = resolvePath(target, current);
		if (resolved === resolvePath(current)) {
			this.notifyToast("info", "workdir unchanged");
			return;
		}
		let isDir = false;
		try {
			isDir = fs.statSync(resolved).isDirectory();
		} catch {
			isDir = false;
		}
		if (!isDir) {
			this.showError(`workdir not found or not a directory: ${resolved}`);
			return;
		}

		await this.reopenActiveSession(resolved);
	}

	/**
	 * Reopen the active tab's session at `resolved`: its cwd-bound services are rebuilt there and
	 * the session header records the new directory, so a later resume starts in the same place. The
	 * transcript is kept. A failure is reported and leaves the tab where it was.
	 */
	private async reopenActiveSession(resolved: string): Promise<void> {
		const sessionFile = this.sessionManager.getSessionFile();
		try {
			// The new directory may hold its own project resources, so it gets the same trust
			// decision a resume into another cwd does.
			const trustContext = { projectTrustContextFactory: (cwd: string) => this.createProjectTrustContext(cwd) };
			if (sessionFile) {
				await this.runtimeHost.switchSession(sessionFile, { cwdOverride: resolved, ...trustContext });
				await persistSessionCwd(sessionFile, resolved);
				return;
			}
			// A session started without a file (`--no-session`) has nothing to reopen: write what
			// it holds into the new directory and continue there.
			const movedFile = await writeSessionFile({
				cwd: resolved,
				agentDir: this.runtimeHost.services.agentDir,
				header: this.sessionManager.getHeader(),
				entries: this.sessionManager.getBranch(),
			});
			await this.runtimeHost.switchSession(movedFile, { cwdOverride: resolved, ...trustContext });
		} catch (error) {
			this.showError(`Failed to change workdir: ${error instanceof Error ? error.message : String(error)}`);
		}
	}

	private async handleNewTab(title?: string, focus = true): Promise<void> {
		await handleNewTabImpl(this.tabLifecycleHost(), title, focus);
	}

	private async handleCloseTab(): Promise<void> {
		this.unsubscribe?.();
		this.unsubscribe = undefined;
		await handleCloseTabImpl(this.tabLifecycleHost());
	}

	/** Publish the current tab layout through SharedTabLayout (no-op before start()). */
	private persistOpenTabs(): void {
		if (!this.tabsRestoreAttempted) return;
		this.sharedTabLayout?.publish();
	}

	private async restoreOpenTabsOnStartup(): Promise<void> {
		const manager = this.tabManager;
		if (!manager) {
			this.tabsRestoreAttempted = true;
			return;
		}
		try {
			const session = this.session;
			if (!session.sessionManager.isPersisted()) return;
			// A fresh session may still hold a startup `custom` entry, so look for
			// actual conversation turns to distinguish it from a resumed session.
			const hasConversation = session.sessionManager
				.buildSessionContext()
				.messages.some(
					(message) => message.role === "user" || message.role === "assistant" || message.role === "toolResult",
				);
			if (hasConversation) return;

			// Shared state: open_tabs.json holds the ordered session ids, and
			// mixcode_state.json holds titles, colors, and workdirs.
			const stored = readOpenTabs(this.tabsWorkdir);
			if (stored.kind !== "ok" || stored.snapshot.sessionIds.length === 0) return;
			const snapshot = stored.snapshot;
			const meta = readTabMeta(this.tabsWorkdir);
			const currentId = session.sessionManager.getSessionId();
			const sessionDir = session.sessionManager.getSessionDir();
			// The recorded startup session is already open as this instance's first tab.
			const entries = snapshot.sessionIds.filter((id) => id !== currentId);
			if (entries.length === 0) return;

			// List the whole persisted layout as loading chips and move to Home before the
			// first tab is built, so the frame the user sees does not wait for the restore:
			// the tabs are built one at a time behind it, each chip spinning until its tab
			// is ready.
			this.restoringTabs = entries.map((id, index) => {
				const tabMeta = meta.get(id);
				return { id, title: tabMeta?.title ?? defaultAgentTitle(index + 1), color: tabMeta?.color };
			});
			await this.activateHome();
			// Awaited: the loader is what settles the layout, and peer sync must not
			// start before it, or the poll opens a second tab for every session the
			// loader has not reached yet. Home is already on screen, so the first
			// frame does not wait for this.
			await this.loadRestoredTabs({
				entries,
				meta,
				sessionDir,
				currentId,
				persistedIds: snapshot.sessionIds,
				activeSessionId: snapshot.activeSessionId,
			});
		} catch (error) {
			this.restoringTabs = [];
			this.showWarning(`Could not restore tabs: ${error instanceof Error ? error.message : String(error)}`);
		} finally {
			// Persisting stays off while a loader is still building the layout, so a change
			// the user makes meanwhile cannot write a partial one over the recorded set; the
			// loader turns it back on when it is done. Nothing pending means this read is the
			// last word on the previous layout.
			this.tabsRestoreAttempted = this.restoringTabs.length === 0;
		}
	}

	/**
	 * Build the restored tabs one at a time, in the order the layout recorded, and let
	 * each one stop showing the loading spinner once its extensions are bound.
	 */
	private async loadRestoredTabs(options: {
		entries: readonly string[];
		meta: Map<string, MixcodeTabMeta>;
		sessionDir: string;
		currentId: string;
		persistedIds: readonly string[];
		activeSessionId?: string;
	}): Promise<void> {
		const manager = this.tabManager;
		if (!manager) return;
		const { entries, meta, sessionDir, currentId, persistedIds, activeSessionId } = options;
		const initialId = manager.getActive().id;
		const errors: string[] = [];
		const restoredTabs: RestoredTab[] = [];
		// Recorded ids whose session opened under a different id; each one is written to
		// the shared set once, before peer polling starts.
		const renamedSessionIds = new Set<string>();
		try {
			for (const sessionId of entries) {
				const restoring = this.restoringTabs.find((item) => item.id === sessionId);
				try {
					const tabMeta = meta.get(sessionId);
					const title = tabMeta?.title;
					const workdir = tabMeta?.workdir ?? this.tabsWorkdir;
					// A tab recorded under another workdir keeps its session in that workdir's
					// default session dir, the same fallback the peer reconcile uses.
					const sessionPath =
						resolveSessionPath(sessionDir, sessionId) ??
						resolveSessionPath(getDefaultSessionDir(workdir), sessionId);
					// While the session is read, the placeholder chip names this phase.
					if (restoring) restoring.phase = "session";
					// The tab id is the persisted session id, so the chip already waiting for this
					// entry becomes the tab's own chip. A missing session file is rebuilt under
					// that same id, so the shared set keeps one id per tab rather than gaining a
					// second one the next start would restore as another tab.
					const tab = sessionPath
						? await manager.openSessionTab(sessionPath, { title, workdir, id: sessionId })
						: await manager.createTab({ title, workdir, id: sessionId, sessionId });
					if (tabMeta?.color) manager.setColor(tab.id, tabMeta.color);
					restoredTabs.push({
						id: tab.id,
						title,
						titleLocked: tabMeta?.titleLocked,
						unread: tabMeta?.unread ?? false,
					});
					// Bind before building the next tab: a session build at a time keeps the
					// memory peak at one, and the bind's walk blocks the loop either way.
					tab.loadingPhase = "resources";
					if (restoring) restoring.phase = "resources";
					// A bind that parks in an extension dialog waits on a human, so the queue moves
					// on and lets the tabs behind it load; the parked bind still finishes on its own,
					// so its bookkeeping runs whenever it lands.
					const bind = this.bindTabExtensions(tab);
					// The bind can replace the session, and a file whose header id differs from its
					// name reveals the real id only here. A rename is written on sight rather than in a
					// batch at the end, because a parked bind lands after this loop has finished and
					// the shared membership must hold the real ids before peer polling starts.
					const recordRename = (): void => {
						const actualId = tab.runtime.session.sessionManager.getSessionId();
						if (actualId === sessionId) return;
						if (renamedSessionIds.has(sessionId)) return;
						renamedSessionIds.add(sessionId);
						try {
							replaceOpenTabSessionIds(this.tabsWorkdir, [{ from: sessionId, to: actualId }]);
						} catch (error) {
							this.showWarning(
								`Could not update restored tab ids: ${error instanceof Error ? error.message : String(error)}`,
							);
						}
					};
					const parked = (await waitForTabBindOrPark(tab, bind)) === "parked";
					// A handler can replace the session before a later handler parks the bind, so
					// the rename is recorded now as well, not only when the parked bind lands.
					recordRename();
					if (parked) {
						void bind.then(() => {
							recordRename();
							this.warmTabTranscript(tab);
						});
					} else {
						// Build the transcript here too, so the tab's first visit repaints parked
						// blocks instead of building and cold-rendering them on the focus path.
						this.warmTabTranscript(tab);
					}
				} catch (error) {
					// Skip unreadable sessions and keep whatever restored so far.
					errors.push(error instanceof Error ? error.message : String(error));
				}
			}
			// A layout that already records the startup session keeps that session's tab;
			// closing it would leave the id in the shared set with no tab behind it.
			const startupInLayout = persistedIds.includes(currentId);
			if (startupInLayout) {
				const startupMeta = meta.get(currentId);
				if (startupMeta?.title)
					manager.restoreTitle(initialId, startupMeta.title, { titleLocked: startupMeta.titleLocked });
				manager.setColor(initialId, startupMeta?.color);
				restoredTabs.push({
					id: initialId,
					title: startupMeta?.title,
					titleLocked: startupMeta?.titleLocked,
					unread: startupMeta?.unread ?? false,
				});
			}
			if (restoredTabs.length === 0) {
				if (errors.length > 0) this.showWarning(`Could not restore tabs: ${errors[0]}`);
				return;
			}
			// A startup session outside the layout is the transient tab the restore replaces.
			if (!startupInLayout && manager.size > 1) await manager.closeTab(initialId);
			this.applyRestoredTabTitles(manager, restoredTabs);
			// Home stays the surface: the persisted tab becomes the manager's focus and
			// the selected roster row, not the open transcript.
			const active = restoredTabs.find((item) => item.id === activeSessionId)?.id;
			const target = active ?? manager.list()[0]?.id ?? manager.getActive().id;
			manager.activate(target);
			syncHomeSelectionToTab(this.homeSelection, this.homeRoster(), target);
			for (const item of restoredTabs) manager.setUnread(item.id, item.unread);
			// Publish the layout now: sessions created during the restore have new
			// ids, and the next start must read those instead of the old ones.
			this.tabsRestoreAttempted = true;
			this.persistOpenTabs();
			this.showStatus(`Restored ${restoredTabs.length} tab(s).`);
		} catch (error) {
			// Best-effort restore: fall back to the single fresh tab.
			this.showWarning(`Could not restore tabs: ${error instanceof Error ? error.message : String(error)}`);
		} finally {
			// The layout is readable again once the loader settles, and the persisted
			// chips give way to the real ones.
			this.restoringTabs = [];
			this.tabsRestoreAttempted = true;
			this.ui.requestRender();
		}
	}

	/**
	 * Re-apply the persisted titles, then renumber the remaining default-named tabs
	 * in order, so the transient startup tab does not push them to the next free
	 * number.
	 */
	private applyRestoredTabTitles(manager: TabManager, restoredTabs: readonly RestoredTab[]): void {
		const explicitTitles = new Map(restoredTabs.map((item) => [item.id, item.title]));
		const lockedTitles = new Map(restoredTabs.map((item) => [item.id, item.titleLocked]));
		const used = new Set<string>();
		for (const tab of manager.list()) {
			const explicit = explicitTitles.get(tab.id);
			if (explicit) used.add(explicit);
			else if (!tab.autoTitle) used.add(tab.title);
		}
		for (const tab of manager.list()) {
			const explicit = explicitTitles.get(tab.id);
			if (explicit) {
				manager.restoreTitle(tab.id, explicit, { titleLocked: lockedTitles.get(tab.id) });
				continue;
			}
			// Only generated names renumber; a title the user typed as `Agent-03`
			// keeps its text.
			if (tab.autoTitle) {
				const next = nextAvailableAgentTitle(used);
				used.add(next);
				manager.restoreTitle(tab.id, next, { autoTitle: true });
			}
		}
	}

	/** `/close-session [yes]` closes the active tab (session file is kept). */
	private async handleCloseSession(args: string): Promise<void> {
		await handleCloseSessionImpl(this.sessionActionHost(), args);
	}

	private async handleDeleteSession(args: string): Promise<void> {
		await handleDeleteSessionImpl(this.sessionActionHost(), args);
	}

	private async handleCloseAllSessions(): Promise<void> {
		await handleCloseAllSessionsImpl(this.sessionActionHost());
	}

	private async handleDeleteAllSessions(): Promise<void> {
		await handleDeleteAllSessionsImpl(this.sessionActionHost());
	}

	private renameActiveTab(title: string): void {
		const manager = this.tabManager;
		if (!manager) return;
		try {
			manager.rename(manager.getActive().id, title);
			// Keep the session name in step so the title survives restore and is
			// what `/name`, auto-rename, and the terminal title report.
			if (this.sessionManager.getSessionName() !== title) this.session.setSessionName(title);
		} catch (error) {
			this.showError(error instanceof Error ? error.message : String(error));
		}
	}

	/** Print the open tabs as status lines (`/tabs`). */
	private showTabList(): void {
		const manager = this.tabManager;
		if (!manager) {
			this.showStatus("Multi-tab is unavailable in this session.");
			return;
		}
		const activeId = manager.getActive().id;
		const lines = manager.list().map((tab, index) => {
			const marker = tab.id === activeId ? "*" : " ";
			return `${marker} ${index + 1}. ${tab.title} [${tab.status}${tab.unread ? ", unread" : ""}]`;
		});
		this.showStatus(`Tabs:\n${lines.join("\n")}`);
	}

	/** `/tab <index|title>` focuses an open tab. */
	private async handleTabCommand(arg: string): Promise<void> {
		const manager = this.tabManager;
		if (!manager) return;
		if (!arg) {
			this.showTabList();
			return;
		}
		const index = Number.parseInt(arg, 10);
		if (!Number.isNaN(index) && String(index) === arg) {
			const tab = manager.list()[index - 1];
			if (!tab) {
				this.showError(`No tab at index ${index}`);
				return;
			}
			await this.activateTab(tab);
			return;
		}
		const tab = manager.list().find((item) => item.title === arg);
		if (!tab) {
			this.showError(`Unknown tab: ${arg}`);
			return;
		}
		await this.activateTab(tab);
	}

	/** Open tabs as `/tab` argument completions; empty when multi-tab is unavailable. */
	private getTabArgumentOptions(): TabArgumentOption[] {
		const manager = this.tabManager;
		if (!manager) return [];
		const activeId = manager.getActive().id;
		return manager.list().map((tab, index) => ({
			index: index + 1,
			title: tab.title,
			description: tab.id === activeId ? `${tab.status} · active` : tab.status,
		}));
	}

	/** Saved workspace names for the `/...-workspace` argument completions. */
	private getWorkspaceNames(): string[] {
		try {
			return readWorkspaces(this.tabsWorkdir).map((workspace) => workspace.name);
		} catch {
			// A corrupt workspaces file must not break the editor; the command reports it.
			return [];
		}
	}

	/** `/color [name|clear]` sets or clears the active tab's chip color. */
	private colorActiveTab(arg: string): void {
		const manager = this.tabManager;
		if (!manager) {
			this.showWarning("Multi-tab is unavailable in this session.");
			return;
		}
		const value = arg.trim().toLowerCase();
		try {
			if (value === "" || value === "clear") {
				manager.setColor(manager.getActive().id, undefined);
				this.showStatus("Cleared tab color.");
				return;
			}
			if (!isTabColorName(value)) {
				this.showError(`Unknown color: ${arg} (valid: ${TAB_COLOR_NAMES.join(", ")}, clear)`);
				return;
			}
			manager.setColor(manager.getActive().id, value);
			this.showStatus(`Tab color: ${value}`);
		} catch (error) {
			this.showError(error instanceof Error ? error.message : String(error));
		}
	}

	/** `/mark-done` flags the active tab as finished without running anything. */
	private markActiveTabDone(): void {
		const manager = this.tabManager;
		if (!manager) {
			this.showWarning("Multi-tab is unavailable in this session.");
			return;
		}
		try {
			manager.markDone(manager.getActive().id);
			this.showStatus("Tab marked done.");
			setTimeout(() => emitMarkDone(), MARK_DONE_SIGNAL_DELAY_MS).unref?.();
		} catch (error) {
			this.showError(error instanceof Error ? error.message : String(error));
		}
	}

	/** `/group-colored-tabs`, keeping the Home selection on the same agent. */
	private groupTabsByColor(): void {
		const manager = this.tabManager;
		if (!manager) return;
		const selectedId = manager.list()[this.homeSelection.selectedIndex]?.id;
		manager.groupByColor();
		// The reorder re-clamps the selection against the new order, so follow the id
		// captured before it rather than an index that may already have moved.
		selectHomeTabById(this.homeSelection, manager.list(), selectedId);
	}

	private saveWorkspaceCommand(name: string): void {
		saveWorkspaceCommandImpl(this.workspaceHost(), name);
	}

	private async restoreWorkspaceCommand(name: string): Promise<void> {
		await restoreWorkspaceCommandImpl(this.workspaceHost(), name);
	}

	private deleteWorkspaceCommand(name: string): void {
		deleteWorkspaceCommandImpl(this.workspaceHost(), name);
	}

	private async handleFatalRuntimeError(prefix: string, error: unknown): Promise<never> {
		const message = error instanceof Error ? error.message : String(error);
		this.showError(`${prefix}: ${message}`);
		const extensionHint = this.getCrashExtensionHint(error);
		if (extensionHint) {
			this.chatContainer.addChild(new Text(theme.fg("warning", extensionHint), this.outputPad, 0));
		}
		if (this.recordCrash("fatal_error", error)) {
			this.chatContainer.addChild(new Text(theme.fg("muted", this.crashReportInstructions()), this.outputPad, 0));
		}
		stopThemeWatcher();
		this.stop("transcript");
		process.exit(1);
	}

	private getCrashExtensionHint(error: unknown): string | undefined {
		try {
			return formatCrashExtensionHint(
				findExtensionStackMatches(
					error instanceof Error ? error.stack : undefined,
					this.session.resourceLoader.getExtensions().extensions,
				),
			);
		} catch {
			return undefined;
		}
	}

	/** Persist a crash so the next start can point the user at `/bug`. Returns false when nothing was written. */
	private recordCrash(kind: "uncaught_exception" | "fatal_error", error: unknown): boolean {
		try {
			return (
				recordCrash({
					kind,
					error,
					sessionFile: this.session.sessionFile,
					cwd: this.session.sessionManager.getCwd(),
				}) !== undefined
			);
		} catch {
			return false;
		}
	}

	private crashReportInstructions(): string {
		const resume = this.session.sessionFile ? `run \`${APP_NAME} -r\` to resume the session, then` : "start pi and";
		return `To report this crash: ${resume} run /bug. The crash details are attached automatically.`;
	}

	private suggestBugReport(): void {
		if (this.bugReportHintShown) return;
		this.bugReportHintShown = true;
		this.chatContainer.addChild(
			new Text(
				theme.fg("muted", `If this looks like a ${APP_NAME} bug, /bug sends a report to the developers.`),
				this.outputPad,
				0,
			),
		);
		this.ui.requestRender();
	}

	private maybeSuggestBugReport(message: AssistantMessage): void {
		if (message.stopReason !== "error" || isRetryableAssistantError(message)) return;
		if (/\b(?:abort(?:ed)?|cancel(?:l?ed)?)\b/i.test(message.errorMessage ?? "")) return;
		this.suggestBugReport();
	}

	private renderCurrentSessionState(): void {
		this.loadedResourcesContainer.clear();
		this.chatContainer.clear();
		this.pendingMessagesContainer.clear();
		this.streamingComponent = undefined;
		this.streamingMessage = undefined;
		this.pendingTools.clear();
		this.renderInitialMessages();
		this.resyncQueuedMessageMirrors();
		// Clearing a transcript also clears the queue boxes above the composer.
		this.updatePendingMessagesDisplay();
	}

	/**
	 * Seed the composer's `up`/`down` prompt history from the bound session's user
	 * messages.
	 *
	 * The composer is shared by every tab, so an activation replaces the history
	 * instead of appending to it: a revisited tab would otherwise repeat its own
	 * messages, and two tabs would interleave. A warmed restored tab shows its
	 * parked transcript without re-rendering, so this runs on its own as well as
	 * from the render path.
	 */
	private syncEditorHistory(): void {
		const texts: string[] = [];
		for (const entry of this.sessionManager.buildContextEntries()) {
			for (const message of sessionEntryToContextMessages(entry)) {
				if (message.role !== "user") continue;
				const text = this.getUserMessageText(message);
				if (text) texts.push(text);
			}
		}
		// Parked (ctrl+c) drafts are newer than anything the session recorded; keep
		// them at the newest end so a revisit still recalls them. Keep only the newest
		// copy of each prompt, so an entry equal to a newer one is dropped rather than
		// repeated further down the list.
		const tabId = this.activeTabIdForUi;
		const stashed = tabId ? (this.stashedPrompts.get(tabId) ?? []) : [];
		const oldestFirst = [...texts, ...[...stashed].reverse()];
		const seen = new Set<string>();
		const newestFirst: string[] = [];
		for (let index = oldestFirst.length - 1; index >= 0; index--) {
			const item = oldestFirst[index];
			if (seen.has(item)) continue;
			seen.add(item);
			newestFirst.push(item);
		}
		this.editor.setHistory?.(newestFirst.reverse());
	}

	/**
	 * Extension-registered definition, falling back to the built-in one. The renderer components take
	 * whatever this returns, so they never reach into the tool registry themselves.
	 */
	private getRegisteredToolDefinition(toolName: string) {
		return withBuiltInRenderers(toolName, this.session.getToolDefinition(toolName));
	}

	private getMarkdownTransformers(): MarkdownTransformer[] {
		return [this.mermaidMarkdownTransformer, ...this.session.extensionRunner.getMarkdownTransformers()];
	}

	/**
	 * Set up keyboard shortcuts registered by extensions.
	 */
	private setupExtensionShortcuts(extensionRunner: ExtensionRunner): void {
		const shortcuts = extensionRunner.getShortcuts(this.keybindings.getEffectiveConfig());
		if (shortcuts.size === 0) return;

		// Create a context for shortcut handlers
		const createContext = (): ExtensionContext => ({
			ui: this.createExtensionUIContext(),
			mode: "tui",
			hasUI: true,
			cwd: this.sessionManager.getCwd(),
			sessionManager: this.sessionManager,
			modelRegistry: extensionRunner.getModelRegistry(),
			model: this.session.model,
			scopedModels: this.session.scopedModels,
			thinkingLevel: this.session.thinkingLevel,
			isIdle: () => this.session.isIdle,
			isProjectTrusted: () => this.settingsManager.isProjectTrusted(),
			signal: this.session.agent.signal,
			abort: () => {
				this.restoreQueuedMessagesToEditor({ abort: true });
			},
			hasPendingMessages: () => this.session.pendingMessageCount > 0,
			shutdown: () => {
				this.shutdownRequested = true;
			},
			getContextUsage: () => this.session.getContextUsage(),
			compact: (options) => {
				void (async () => {
					try {
						const result = await runInTabConsole(this.tabManager?.getActive(), () =>
							this.session.compact(options?.customInstructions),
						);
						options?.onComplete?.(result);
					} catch (error) {
						const err = error instanceof Error ? error : new Error(String(error));
						options?.onError?.(err);
					}
				})();
			},
			getSystemPrompt: () => this.session.systemPrompt,
		});

		// Set up the extension shortcut handler on the default editor
		this.defaultEditor.onExtensionShortcut = (data: string) => {
			for (const [shortcutStr, shortcut] of shortcuts) {
				// Cast to KeyId - extension shortcuts use the same format
				if (matchesKey(data, shortcutStr as KeyId)) {
					// Run handler async, don't block input
					Promise.resolve(shortcut.handler(createContext())).catch((err) => {
						this.showError(`Shortcut handler error: ${err instanceof Error ? err.message : String(err)}`);
					});
					return true;
				}
			}
			return false;
		};
	}

	/**
	 * Set extension status text in the footer.
	 */
	private setExtensionStatus(key: string, text: string | undefined): void {
		this.footerDataProvider.setExtensionStatus(key, text);
		this.ui.requestRender();
	}

	private setEditorWorkingStatusIndicator(indicator: StatusIndicator | undefined): boolean {
		this.defaultEditor.setWorkingStatusIndicator(undefined);
		if (!isWorkingStatusEditor(this.editor)) return false;
		this.editor.setWorkingStatusIndicator(indicator);
		return true;
	}

	private showStatusIndicator(indicator: StatusIndicator): void {
		this.activeStatusIndicator?.dispose();
		this.activeStatusIndicator = indicator;
		this.activeWorkingIndicatorEmbedded = false;
		this.statusContainer.clear();
		this.setEditorWorkingStatusIndicator(undefined);
		// Home paints no working chrome; the indicator waits for the way back.
		if (this.homeSelection.active) return;
		if (this.setEditorWorkingStatusIndicator(indicator)) {
			this.activeWorkingIndicatorEmbedded = true;
			return;
		}
		this.statusContainer.addChild(indicator);
	}

	private clearStatusIndicator(kind?: StatusIndicator["kind"]): void {
		if (kind && this.activeStatusIndicator?.kind !== kind) {
			return;
		}
		const clearedIndicator = this.activeStatusIndicator;
		const clearedIndicatorWasEmbedded = this.activeWorkingIndicatorEmbedded;
		clearedIndicator?.dispose();
		this.activeStatusIndicator = undefined;
		this.activeWorkingIndicatorEmbedded = false;
		this.statusContainer.clear();
		this.setEditorWorkingStatusIndicator(undefined);
		if (
			clearedIndicator &&
			!clearedIndicatorWasEmbedded &&
			!this.homeSelection.active &&
			this.options.tuiMode === "regular" &&
			this.ui.getClearOnShrink()
		) {
			this.statusContainer.addChild(this.idleStatus);
		}
	}

	private showWorkingStatusIndicator(): void {
		const colorFn = isWorkingStatusEditor(this.editor)
			? (text: string) =>
					(this.editor.borderColor ?? theme.getThinkingBorderColor(this.session.thinkingLevel || "off"))(text)
			: undefined;
		this.showStatusIndicator(
			new WorkingStatusIndicator(
				this.ui,
				this.workingMessage ?? this.defaultWorkingMessage,
				this.workingIndicatorOptions,
				colorFn,
			),
		);
	}

	private setWorkingVisible(visible: boolean): void {
		this.workingVisible = visible;
		if (!visible) {
			this.clearStatusIndicator("working");
			this.ui.requestRender();
			return;
		}
		if (this.session.isStreaming && this.activeStatusIndicator?.kind !== "working") {
			this.showWorkingStatusIndicator();
		}
		this.ui.requestRender();
	}

	private setWorkingIndicator(options?: WorkingIndicatorOptions): void {
		this.workingIndicatorOptions = options;
		if (this.activeStatusIndicator?.kind === "working") {
			this.activeStatusIndicator.setIndicator(options);
		}
		this.ui.requestRender();
	}

	private setHiddenThinkingLabel(label?: string): void {
		// Do nothing when the value is unchanged: callers such as resetExtensionUI fire
		// on every tab switch, and calling through would rebuild every AssistantMessage
		// block's content and wipe its render memo even though nothing changed.
		if (this.hiddenThinkingLabel === label) return;
		this.hiddenThinkingLabel = label;
		for (const child of this.chatContainer.children) {
			if (child instanceof AssistantMessageComponent) {
				child.setHiddenThinkingLabel(this.hiddenThinkingLabel);
			}
		}
		if (this.streamingComponent) {
			this.streamingComponent.setHiddenThinkingLabel(this.hiddenThinkingLabel);
		}
		this.windowedTranscript?.resetMeasurements();
		this.ui.requestRender();
	}

	/**
	 * Wrap a string-array widget in the container the dock paints. Shared by the
	 * focused tab's setter and the record kept for a background tab.
	 */
	private buildExtensionWidget(lines: string[]): Component & { dispose?(): void } {
		const container = new Container();
		for (const line of lines.slice(0, InteractiveMode.MAX_WIDGET_LINES)) {
			container.addChild(new Text(line, 1, 0));
		}
		if (lines.length > InteractiveMode.MAX_WIDGET_LINES) {
			container.addChild(new Text(theme.fg("muted", "... (widget truncated)"), 1, 0));
		}
		return container;
	}

	/**
	 * Set an extension widget (string array or custom component).
	 */
	private setExtensionWidget(
		key: string,
		content: string[] | ((tui: TUI, thm: Theme) => Component & { dispose?(): void }) | undefined,
		options?: ExtensionWidgetOptions,
	): void {
		const placement = options?.placement ?? "aboveEditor";
		const removeExisting = (map: Map<string, Component & { dispose?(): void }>) => {
			const existing = map.get(key);
			if (existing?.dispose) existing.dispose();
			map.delete(key);
		};

		removeExisting(this.extensionWidgetsAbove);
		removeExisting(this.extensionWidgetsBelow);

		if (content === undefined) {
			this.requestWidgetRender();
			return;
		}

		let component: Component & { dispose?(): void };

		if (Array.isArray(content)) {
			component = this.buildExtensionWidget(content);
		} else {
			// Factory function - create component
			component = content(this.ui, theme);
		}

		const targetMap = placement === "belowEditor" ? this.extensionWidgetsBelow : this.extensionWidgetsAbove;
		targetMap.set(key, component);
		this.requestWidgetRender();
	}

	private clearExtensionWidgets(): void {
		for (const widget of this.extensionWidgetsAbove.values()) {
			widget.dispose?.();
		}
		for (const widget of this.extensionWidgetsBelow.values()) {
			widget.dispose?.();
		}
		this.extensionWidgetsAbove.clear();
		this.extensionWidgetsBelow.clear();
		this.requestWidgetRender();
	}

	private resetExtensionUI(tabId?: string): void {
		// Extensions are going away, so the dialogs they wait on go with them: only an answered
		// dialog resolves, and none of these will be. A session replacement invalidates one tab's
		// extensions, so only that tab's dialogs are dropped; no tab given means every one.
		const doomed =
			tabId === undefined ? [...this.tabInteractions.values()].flat() : [...this.tabInteractionsFor(tabId)];
		for (const interaction of doomed) {
			interaction.overlay?.handle.hide();
			this.unmountTabInteraction(interaction);
			interaction.untrack?.();
			try {
				interaction.component?.dispose?.();
			} catch {
				/* A dialog that fails to dispose is already gone with its extension. */
			}
		}
		if (tabId === undefined) this.tabInteractions.clear();
		this.clearExtensionTerminalInputListeners(tabId);
		this.setExtensionFooter(undefined);
		this.setExtensionHeader(undefined);
		this.clearExtensionWidgets();
		this.footerDataProvider.clearExtensionStatuses();
		this.footer.invalidate();
		this.autocompleteProviderWrappers = [];
		this.setCustomEditorComponent(undefined);
		this.setupAutocompleteProvider();
		this.defaultEditor.onExtensionShortcut = undefined;
		this.updateTerminalTitle();
		this.workingMessage = undefined;
		this.workingVisible = true;
		this.setWorkingIndicator();
		if (this.activeStatusIndicator?.kind === "working") {
			this.activeStatusIndicator.setMessage(
				`${this.defaultWorkingMessage} (${keyText("app.interrupt")} to interrupt)`,
			);
		}
		this.setHiddenThinkingLabel();
	}

	// Maximum total widget lines to prevent viewport overflow
	private static readonly MAX_WIDGET_LINES = 10;

	/**
	 * Ask for a frame after the widget set changed. What the slots render, and
	 * whether they render at all, is the dock budget's decision per frame.
	 */
	private requestWidgetRender(): void {
		this.ui.requestRender();
	}

	/**
	 * Rows the dock's fixed entries occupy at this width, which the widget budget
	 * has to leave alone.
	 */
	private dockChromeRows(width: number): number {
		let rows = 0;
		for (const container of [
			this.tabBarContainer,
			this.pendingMessagesContainer,
			this.statusContainer,
			this.footerContainer,
		]) {
			rows += container?.render(width).length ?? 0;
		}
		return rows;
	}

	/**
	 * Side-panel state of the active tab. Created on first use, so a new tab
	 * starts closed and nothing is persisted. Home owns no panel.
	 */
	private widgetPanelState(): WidgetPanelTabState | undefined {
		if (this.homeSelection.active) return undefined;
		const hasTabManager = this.tabManager !== undefined;
		const tabId = this.activeTabIdForUi ?? (hasTabManager ? undefined : SINGLE_SESSION_TAB_ID);
		if (!tabId) return undefined;
		let state = this.widgetPanelTabStates.get(tabId);
		if (!state) {
			state = createWidgetPanelTabState();
			this.widgetPanelTabStates.set(tabId, state);
		}
		return state;
	}

	/** Whether the side panel splits the chat right now (open tab on a wide terminal). */
	private widgetPanelVisible(): boolean {
		return this.widgetPanel.isOpen(this.ui.terminal.columns);
	}

	/**
	 * Whether an extension interaction owns the composer on the tab on screen. Keys already
	 * route to a mounted dialog through focus; this feeds the side panel, which must leave the
	 * wheel to the chat while a pending interaction is up, matching the input the chat would get.
	 * An overlay is not one of them: it takes the screen, which the overlay guards already cover.
	 */
	private extensionUiPending(): boolean {
		if (this.activeSelectorToken !== undefined) return true;
		return this.tabInteractionsFor(this.shownTabId()).some((interaction) => interaction.mounted);
	}

	/** Copy a finished side-panel selection and report it like any other copy. */
	private copyWidgetPanelSelection(text: string): void {
		void (async () => {
			try {
				await copyToClipboard(text);
				this.notifyToast("success", copyConfirmation(countGraphemes(text)));
			} catch (error) {
				this.notifyToast("error", copyFailure(error instanceof Error ? error.message : String(error)));
			}
		})();
	}

	/**
	 * `app.widgets.panel` on an empty composer. Returns false to decline so the
	 * key keeps flowing (editor caret move, extension shortcuts, Home arrows).
	 */
	private handleWidgetPanelKey(): boolean {
		if (this.homeSelection.active) return false;
		if (this.ui.mode !== "fullscreen") return false;
		if (this.ui.hasOverlay()) return false;
		if (isShowingAutocomplete(this.editor)) return false;
		if (this.editorText().length > 0) return false;
		this.toggleWidgetPanel();
		return true;
	}

	/**
	 * Toggle the side panel for the active tab. Opening needs at least one
	 * above/below-editor widget and a wide-enough terminal; a refused open says
	 * why with a toast. Closing always succeeds and resets the scroll.
	 */
	private toggleWidgetPanel(): void {
		const state = this.widgetPanelState();
		if (!state) return;
		if (state.open) {
			state.open = false;
			state.scrollOffset = 0;
			this.ui.requestRender();
			return;
		}
		const hasWidgets = this.extensionWidgetsAbove.size > 0 || this.extensionWidgetsBelow.size > 0;
		if (!hasWidgets) {
			this.notifyToast("info", "No extension widgets to show.");
			this.ui.requestRender();
			return;
		}
		const columns = this.ui.terminal.columns;
		if (columns > 0 && columns < WIDGET_PANEL_MIN_TERMINAL_WIDTH) {
			this.notifyToast(
				"warning",
				`Terminal too narrow for the widget panel (need ${WIDGET_PANEL_MIN_TERMINAL_WIDTH} cols).`,
			);
			this.ui.requestRender();
			return;
		}
		state.open = true;
		state.scrollOffset = 0;
		this.ui.requestRender();
	}

	/**
	 * Inline mode and collapse state of the active tab. Created on first use from
	 * the global default, so a new tab inherits it and nothing is persisted.
	 */
	private inlineWidgetState(): InlineWidgetTabState | undefined {
		const hasTabManager = this.tabManager !== undefined;
		const tabId = this.activeTabIdForUi ?? (hasTabManager ? undefined : SINGLE_SESSION_TAB_ID);
		if (!tabId) return undefined;
		let state = this.inlineWidgetTabStates.get(tabId);
		if (!state) {
			state = createInlineWidgetTabState(this.mixcodeSettings.ui.inlineWidgets);
			this.inlineWidgetTabStates.set(tabId, state);
		}
		return state;
	}

	/**
	 * Rows the chat surface can show, for the inline row budget. Fullscreen uses
	 * the transcript viewport; regular mode renders the whole document, so the
	 * visible window there is the terminal itself.
	 */
	private inlineViewportRows(): number | undefined {
		if (this.ui.mode !== "fullscreen") return this.renderer.terminal.rows;
		const height = this.transcriptScrollView?.viewportHeight ?? 0;
		return height > 0 ? height : undefined;
	}

	/** Re-render the chat tail and the dock after the active tab's mode changed. */
	private refreshInlineWidgets(): void {
		this.windowedTranscript?.resetMeasurements();
		this.requestWidgetRender();
	}

	/** `/toggle-inline-widgets`: switch the active tab between tail and docked widgets. */
	private handleToggleInlineWidgets(): void {
		const state = this.inlineWidgetState();
		if (!state) return;
		state.enabled = !state.enabled;
		this.refreshInlineWidgets();
	}

	/** `/toggle-zen-mode`: hide or restore the focused agent's tab-bar chrome. */
	private handleToggleZenMode(): void {
		const manager = this.tabManager;
		const tab = manager?.activeTab();
		if (!manager || !tab) {
			this.showWarning("Zen mode needs an agent tab");
			return;
		}
		manager.toggleZenMode(tab.id);
	}

	/** Widget keys registered in the active tab, above-editor widgets first. */
	private getWidgetKeys(): string[] {
		return [...this.extensionWidgetsAbove.keys(), ...this.extensionWidgetsBelow.keys()];
	}

	/**
	 * `/widgets [expand|collapse|toggle] [key]`: set manual collapse state.
	 *
	 * A mixed group expands together and a fully expanded group collapses together.
	 * Automatic collapses count as collapsed while the tail renders them, so
	 * `/widgets` expands a tail the row budget folded instead of collapsing it
	 * again. The bare toggle collapses by handing its widgets back to the budget,
	 * so a second `/widgets` restores the automatic state instead of replacing the
	 * pins with manual collapses the budget can never undo.
	 */
	private handleWidgetsCommand(args: string): void {
		const state = this.inlineWidgetState();
		if (!state) return;
		const input = args.trim();
		const match = /^(expand|collapse|toggle)(?:\s+(.*))?$/.exec(input);
		const action = match?.[1] ?? "toggle";
		// The remainder is an exact widget key, including spaces.
		const key = match ? match[2]?.trim() : input;
		const widgets = key ? this.getWidgetKeys().filter((widgetKey) => widgetKey === key) : this.getWidgetKeys();
		if (widgets.length === 0) {
			this.showError(key ? `Unknown widget: ${key}` : "No widgets in this tab");
			return;
		}
		const autoActive = state.enabled;
		const isCollapsed = (widgetKey: string): boolean =>
			state.collapsed.get(widgetKey) === true || (autoActive && state.autoCollapsed.has(widgetKey));
		const allExpanded = widgets.every((widgetKey) => !isCollapsed(widgetKey));
		const collapse = action === "collapse" || (action === "toggle" && allExpanded);
		const handBack = collapse && !key && autoActive;
		for (const widgetKey of widgets) {
			if (handBack && state.collapsed.has(widgetKey)) state.collapsed.delete(widgetKey);
			else state.collapsed.set(widgetKey, collapse);
			// Manual intent outranks the row budget: drop the key from the automatic
			// set so the next frame honours the explicit choice.
			state.autoCollapsed.delete(widgetKey);
		}
		this.refreshInlineWidgets();
	}

	/**
	 * Apply the global `ui.inlineWidgets` default: write it to MixCode's settings
	 * file and switch every open tab over immediately.
	 */
	private setInlineWidgetsGlobal(enabled: boolean): void {
		this.mixcodeSettings = { ...this.mixcodeSettings, ui: { ...this.mixcodeSettings.ui, inlineWidgets: enabled } };
		try {
			writeInlineWidgetsSetting(mixcodeSettingsFilePath(), enabled);
		} catch (error) {
			this.showWarning(
				`Failed to save mixcode_settings.json: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
		for (const state of this.inlineWidgetTabStates.values()) state.enabled = enabled;
		this.refreshInlineWidgets();
	}

	/**
	 * Apply the global `ui.boxedHiddenThinking` default: write it to MixCode's
	 * settings file and re-render every open assistant message immediately.
	 */
	private setBoxedHiddenThinkingGlobal(enabled: boolean): void {
		this.mixcodeSettings = {
			...this.mixcodeSettings,
			ui: { ...this.mixcodeSettings.ui, boxedHiddenThinking: enabled },
		};
		try {
			writeBoxedHiddenThinkingSetting(mixcodeSettingsFilePath(), enabled);
		} catch (error) {
			this.showWarning(
				`Failed to save mixcode_settings.json: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
		for (const child of this.chatContainer.children) {
			if (child instanceof AssistantMessageComponent) child.setBoxedHiddenThinking(enabled);
		}
		this.windowedTranscript?.resetMeasurements();
		this.ui.requestRender();
	}

	/**
	 * Apply the `ui.icons.mode` setting: write it to MixCode's settings file and
	 * repaint the meta row with the glyphs the new mode picks.
	 */
	private setIconModeGlobal(mode: IconMode): void {
		this.mixcodeSettings = { ...this.mixcodeSettings, ui: { ...this.mixcodeSettings.ui, icons: { mode } } };
		try {
			writeIconModeSetting(mixcodeSettingsFilePath(), mode);
		} catch (error) {
			this.showWarning(
				`Failed to save mixcode_settings.json: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
		this.footer.invalidate();
		this.ui.requestRender();
	}

	/**
	 * Apply the `ui.showResponseModelNotices` setting: write it to MixCode's settings
	 * file and rebuild the transcript, so notices already rendered follow the switch.
	 */
	private setShowResponseModelNoticesGlobal(enabled: boolean): void {
		this.mixcodeSettings = {
			...this.mixcodeSettings,
			ui: { ...this.mixcodeSettings.ui, showResponseModelNotices: enabled },
		};
		try {
			writeShowResponseModelNoticesSetting(mixcodeSettingsFilePath(), enabled);
		} catch (error) {
			this.showWarning(
				`Failed to save mixcode_settings.json: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
		this.rebuildChatFromMessages();
	}

	/**
	 * Set a custom footer component, or restore the built-in footer.
	 */
	private setExtensionFooter(
		factory:
			| ((tui: TUI, thm: Theme, footerData: ReadonlyFooterDataProvider) => Component & { dispose?(): void })
			| undefined,
	): void {
		this.customFooterFactory = factory;
		// Dispose existing custom footer
		if (this.customFooter?.dispose) {
			this.customFooter.dispose();
		}

		this.footerContainer.clear();
		if (factory) {
			// The dock row is gone, so its pointer state goes with it: a cue kept
			// across the swap would light up cells the extension footer now paints.
			this.footer.invalidate();
			// Create and add custom footer, passing the data provider
			this.customFooter = factory(this.ui, theme, this.footerDataProvider);
			this.footerContainer.addChild(this.customFooter);
		} else {
			// Restore built-in footer
			this.customFooter = undefined;
			this.footerContainer.addChild(this.footer);
		}

		// Home shows no footer: park whatever was just installed.
		if (this.homeSelection.active) this.parkFooterForHome(true);

		this.ui.requestRender();
	}

	/**
	 * Set a custom header component, or restore the built-in header.
	 */
	private setExtensionHeader(factory: ((tui: TUI, thm: Theme) => Component & { dispose?(): void }) | undefined): void {
		// Header may not be initialized yet if called during early initialization
		if (!this.builtInHeader) {
			return;
		}

		this.customHeaderFactory = factory;
		// Dispose existing custom header
		if (this.customHeader?.dispose) {
			this.customHeader.dispose();
		}

		// Find the index of the current header in the header container
		const currentHeader = this.customHeader || this.builtInHeader;
		const index = this.headerContainer.children.indexOf(currentHeader);

		if (factory) {
			// Create and add custom header
			this.customHeader = factory(this.ui, theme);
			if (isExpandable(this.customHeader)) {
				this.customHeader.setExpanded(this.toolOutputExpanded);
			}
			if (index !== -1) {
				this.headerContainer.children[index] = this.customHeader;
			} else {
				// If not found (e.g. builtInHeader was never added), add at the top
				this.headerContainer.children.unshift(this.customHeader);
			}
		} else {
			// Restore built-in header
			this.customHeader = undefined;
			if (isExpandable(this.builtInHeader)) {
				this.builtInHeader.setExpanded(this.toolOutputExpanded);
			}
			if (index !== -1) {
				this.headerContainer.children[index] = this.builtInHeader;
			}
		}

		this.ui.requestRender();
	}

	/**
	 * Register a listener an extension asked for through `ctx.ui.onTerminalInput`. One
	 * registered while its tab is off screen waits for `attachTabUi`, so it never answers
	 * keys meant for the tab in front.
	 */
	private addExtensionTerminalInputListener(
		tabId: string | undefined,
		handler: (data: string) => { consume?: boolean; data?: string } | undefined,
	): () => void {
		const subscription: ExtensionTerminalInputSubscription = { tabId, handler };
		this.extensionTerminalInputSubscriptions.add(subscription);
		if (tabId === undefined || this.tabShowsOnScreen(tabId)) {
			subscription.unsubscribe = this.ui.addInputListener(handler);
		}
		return () => {
			subscription.unsubscribe?.();
			this.extensionTerminalInputSubscriptions.delete(subscription);
		};
	}

	/** Register the terminal listeners a tab's extensions asked for while it was off screen. */
	private attachExtensionTerminalInputListeners(tabId: string): void {
		for (const subscription of this.extensionTerminalInputSubscriptions) {
			if (subscription.tabId !== tabId) continue;
			subscription.unsubscribe ??= this.ui.addInputListener(subscription.handler);
		}
	}

	/** Park a tab's terminal listeners; `attachTabUi` puts them back when the tab returns. */
	private detachExtensionTerminalInputListeners(tabId: string): void {
		for (const subscription of this.extensionTerminalInputSubscriptions) {
			if (subscription.tabId !== tabId) continue;
			subscription.unsubscribe?.();
			subscription.unsubscribe = undefined;
		}
	}

	private rebindExtensionTerminalInputListeners(): void {
		for (const subscription of this.extensionTerminalInputSubscriptions) {
			if (!subscription.unsubscribe) continue;
			subscription.unsubscribe();
			subscription.unsubscribe = this.ui.addInputListener(subscription.handler);
		}
	}

	/**
	 * Route the app's chrome shortcuts to the renderer now in use. The reference `this.ui`
	 * forwards every call to the current renderer, so a TUI-mode switch leaves the listener on
	 * the stopped renderer and the new one needs its own; dropping the previous one keeps a
	 * second registration from answering every key twice.
	 */
	private registerExtensionDialogShortcutListener(): void {
		this.extensionDialogShortcutUnsubscribe?.();
		this.extensionDialogShortcutUnsubscribe = this.ui.addInputListener((data) =>
			this.handleExtensionDialogShortcut(data),
		);
	}

	/** Drop the terminal listeners of a replaced tab, or every one when no tab is given. */
	private clearExtensionTerminalInputListeners(tabId?: string): void {
		for (const subscription of [...this.extensionTerminalInputSubscriptions]) {
			if (tabId !== undefined && subscription.tabId !== tabId) continue;
			subscription.unsubscribe?.();
			this.extensionTerminalInputSubscriptions.delete(subscription);
		}
	}

	/**
	 * Create the ExtensionUIContext for extensions.
	 */
	private createProjectTrustContext(cwd: string): ProjectTrustContext {
		const ui = this.createExtensionUIContext();
		return {
			cwd,
			mode: "tui",
			hasUI: true,
			ui: {
				select: ui.select,
				confirm: ui.confirm,
				input: ui.input,
				notify: ui.notify,
			},
		};
	}

	/**
	 * Extension UI context of the live surfaces.
	 *
	 * `ownerTabId` pins the dialogs it opens to one tab. Without it the context
	 * belongs to whatever tab the user is looking at when a dialog is requested,
	 * which is right for a context made on the spot (a shortcut handler) and wrong
	 * for one a session keeps, so a session bind passes its own tab, as a getter:
	 * a bind runs before its tab is registered, and the tab a later dialog belongs
	 * to is only known when the dialog is requested.
	 */
	private createExtensionUIContext(ownerTabId?: string | (() => string | undefined)): ExtensionUIContext {
		const ownerTab = () => (typeof ownerTabId === "function" ? ownerTabId() : ownerTabId);
		const dialogTabId = () => ownerTab() ?? this.shownTabId();
		return {
			select: (title, options, opts) => this.showExtensionSelector(title, options, opts, dialogTabId()),
			confirm: (title, message, opts) => this.showExtensionConfirm(title, message, opts, dialogTabId()),
			input: (title, placeholder, opts) => this.showExtensionInput(title, placeholder, opts, dialogTabId()),
			notify: (message, type) => this.showExtensionNotify(message, type),
			onTerminalInput: (handler) => this.addExtensionTerminalInputListener(dialogTabId(), handler),
			setStatus: (key, text) => this.setExtensionStatus(key, text),
			setWorkingMessage: (message) => {
				this.workingMessage = message;
				if (this.activeStatusIndicator?.kind === "working") {
					this.activeStatusIndicator.setMessage(message ?? this.defaultWorkingMessage);
				}
			},
			setWorkingVisible: (visible) => this.setWorkingVisible(visible),
			setWorkingIndicator: (options) => this.setWorkingIndicator(options),
			setHiddenThinkingLabel: (label) => this.setHiddenThinkingLabel(label),
			setWidget: (key, content, options) => this.setExtensionWidget(key, content, options),
			setFooter: (factory) => this.setExtensionFooter(factory),
			setHeader: (factory) => this.setExtensionHeader(factory),
			setTitle: (title) => this.ui.terminal.setTitle(title),
			custom: (factory, options) => this.showExtensionCustom(factory, options, dialogTabId()),
			pasteToEditor: (text) => this.editor.handleInput(`\x1b[200~${text}\x1b[201~`),
			setEditorText: (text) => this.editor.setText(text),
			getEditorText: () => this.editor.getExpandedText?.() ?? this.editor.getText(),
			editor: (title, prefill) => this.showExtensionEditor(title, prefill, dialogTabId()),
			addAutocompleteProvider: (factory) => {
				this.autocompleteProviderWrappers.push(factory);
				this.setupAutocompleteProvider();
			},
			setEditorComponent: (factory) => this.setCustomEditorComponent(factory),
			getEditorComponent: () => this.editorComponentFactory,
			get theme() {
				return theme;
			},
			getAllThemes: () => getAvailableThemesWithPaths(),
			getTheme: (name) => getThemeByName(name),
			setTheme: (themeOrName) => {
				if (themeOrName instanceof Theme) {
					return this.themeController.setThemeInstance(themeOrName);
				}
				const result = this.themeController.setThemeName(themeOrName);
				if (result.success) {
					if (this.settingsManager.getTheme() !== themeOrName) {
						this.settingsManager.setTheme(themeOrName);
					}
				}
				return result;
			},
			getToolsExpanded: () => this.toolOutputExpanded,
			setToolsExpanded: (expanded) => this.setToolsExpanded(expanded),
		};
	}

	/**
	 * The tab whose surfaces the UI is showing. Home is a surface of its own that
	 * covers every tab, so nothing counts as shown while it is up.
	 */
	private shownTabId(): string | undefined {
		if (this.activeTabIdForUi) return this.activeTabIdForUi;
		if (this.tabManager) return this.tabManager.activeTab()?.id;
		return SINGLE_SESSION_TAB_ID;
	}

	/**
	 * The tab holding `runtime`, resolved on demand: a runtime is bound before its tab is
	 * registered, so a lookup at bind time would find nothing.
	 */
	private tabIdForRuntime(runtime: AgentSessionRuntime): string | undefined {
		return this.tabManager?.list().find((tab) => tab.runtime === runtime)?.id;
	}

	/** True while `tabId` is the tab the UI is showing, rather than Home or another tab. */
	private tabShowsOnScreen(tabId: string): boolean {
		return !this.homeSelection.active && this.shownTabId() === tabId;
	}

	/** True while an extension interaction on the tab waits on a human. */
	private tabWaitingForInput(tabId: string): boolean {
		return (this.tabInteractions.get(tabId)?.length ?? 0) > 0;
	}

	/** The interactions pending on a tab, empty when it has none. */
	private tabInteractionsFor(tabId: string | undefined): readonly TabInteraction[] {
		return tabId === undefined ? [] : (this.tabInteractions.get(tabId) ?? []);
	}

	/**
	 * Register an interaction on its tab. A context without a tab (a host that
	 * supplies none) leaves it unscoped, which mounts it wherever the UI is.
	 */
	private trackTabInteraction(tabId: string | undefined, interaction: TabInteraction): void {
		if (tabId === undefined) return;
		interaction.tabId = tabId;
		const pending = this.tabInteractions.get(tabId);
		if (pending) pending.push(interaction);
		else this.tabInteractions.set(tabId, [interaction]);
		interaction.untrack = () => {
			const list = this.tabInteractions.get(tabId);
			if (!list) return;
			const index = list.indexOf(interaction);
			if (index >= 0) list.splice(index, 1);
			if (list.length === 0) this.tabInteractions.delete(tabId);
			this.syncWaitingInputCount();
			this.ui.requestRender();
		};
		this.syncWaitingInputCount();
	}

	/** Broadcast the process-wide count of extension dialogs waiting on a human. */
	private syncWaitingInputCount(): void {
		let count = 0;
		for (const pending of this.tabInteractions.values()) count += pending.length;
		setWaitingForInputCount(count);
	}

	/**
	 * Register an interaction and mount it when its tab is the one on screen. Any
	 * other tab parks it: the tab bar reports the wait, and the dialog appears the
	 * moment the user switches to it.
	 */
	private openTabInteraction(tabId: string | undefined, interaction: TabInteraction): void {
		this.trackTabInteraction(tabId, interaction);
		if (tabId === undefined || this.tabShowsOnScreen(tabId)) this.mountTabInteraction(tabId, interaction);
		this.ui.requestRender();
	}

	/** Drop an answered interaction: park it, dispose it, stop reporting the wait. */
	private closeTabInteraction(interaction: TabInteraction): void {
		interaction.overlay?.handle.hide();
		this.unmountTabInteraction(interaction);
		interaction.untrack?.();
		try {
			interaction.component?.dispose?.();
		} catch {
			/* A dialog that fails to dispose has already answered. */
		}
		this.remountParkedTabInteraction(interaction.tabId);
		this.ui.requestRender();
	}

	/**
	 * Put the dialog a closing one displaced back on the slot. A tab holds one dialog at a
	 * time, and the one it parked still waits for its own answer.
	 */
	private remountParkedTabInteraction(tabId: string | undefined): void {
		// A parked dialog returns only while its own tab is the one on screen: an extension
		// that closes its dialog from the background must not paint over the tab in front.
		if (tabId === undefined || !this.tabShowsOnScreen(tabId)) return;
		const previous = this.tabInteractionsFor(tabId)
			.filter((interaction) => !interaction.mounted)
			.at(-1);
		if (previous) this.mountTabInteraction(tabId, previous);
	}

	/**
	 * Show a slotted interaction on the editor slot. A dialog of the same tab that is
	 * already on the slot is parked rather than disposed, and `remountParkedTabInteraction`
	 * hands the slot back to it when this one closes.
	 */
	private mountTabInteraction(tabId: string | undefined, interaction: TabInteraction): void {
		if (interaction.kind === "overlay" || interaction.mounted || !interaction.component) return;
		for (const other of this.tabInteractionsFor(tabId)) {
			if (other !== interaction) this.unmountTabInteraction(other);
		}
		// A custom component owns the composer from the moment it takes the slot, so the draft
		// it displaces is read here. Read at request time instead, it would hold the draft of
		// whichever tab was in front when a background tab asked for its dialog.
		if (interaction.kind === "custom") interaction.savedDraft ??= this.editor.getText();
		this.disposeActiveSelector();
		this.editorContainer.clear();
		this.editorContainer.addChild(interaction.component);
		this.ui.setFocus(interaction.component);
		interaction.mounted = true;
		this.ui.requestRender();
	}

	/** Take a dialog off the editor slot, keeping its component and its promise alive. */
	private unmountTabInteraction(interaction: TabInteraction): void {
		if (!interaction.mounted) return;
		interaction.mounted = false;
		this.editorContainer.clear();
		this.editorContainer.addChild(this.editor);
		this.ui.setFocus(this.editor);
		this.ui.requestRender();
	}

	/**
	 * Give a tab the dialogs that waited for it: mount its parked ones, then hand the
	 * keyboard to its newest overlay, which the tab switch took focus from.
	 */
	private focusTabInteractions(tabId: string): void {
		// Home covers every tab, so a dialog waits for its tab to be shown again.
		if (!this.tabShowsOnScreen(tabId)) return;
		const pending = this.tabInteractionsFor(tabId);
		for (const interaction of pending) this.mountTabInteraction(tabId, interaction);
		const overlay = pending.filter((interaction) => interaction.overlay).at(-1);
		if (overlay?.overlay?.capturing) overlay.overlay.handle.focus();
	}

	/** Park a tab's dialogs when it loses focus. Overlays gate on focus instead of unmounting. */
	private parkTabInteractions(tabId: string): void {
		for (const interaction of this.tabInteractionsFor(tabId)) this.unmountTabInteraction(interaction);
	}

	/** Forget a closed tab's interactions, leaving their components to the extension that owns them. */
	private forgetTabInteractions(tabId: string): void {
		for (const interaction of this.tabInteractionsFor(tabId)) {
			// An overlay has no slot to unmount, and only its handle drops the stack entry.
			interaction.overlay?.handle.hide();
			this.unmountTabInteraction(interaction);
		}
		this.tabInteractions.delete(tabId);
		this.syncWaitingInputCount();
	}

	/**
	 * Gate an extension overlay on its tab being the one on screen.
	 *
	 * The overlay keeps its place in the TUI's overlay stack, so the extension stays
	 * in control of it: the handle it was given still hides and shows it, and a
	 * collapse it applied survives the gate. Nothing pops the stack for a tab switch:
	 * a pop takes whatever sits on top, which may belong to another surface.
	 */
	private scopeOverlayToTab(options: OverlayOptions, tabId: string | undefined): OverlayOptions {
		if (tabId === undefined) return options;
		const visible = options.visible;
		return {
			...options,
			visible: (termWidth, termHeight) =>
				this.tabShowsOnScreen(tabId) && (visible ? visible(termWidth, termHeight) : true),
		};
	}

	/**
	 * Show a selector for extensions.
	 */
	private showExtensionSelector(
		title: string,
		options: string[],
		opts?: ExtensionUIDialogOptions & ExtensionSelectorOptions,
		tabId?: string,
	): Promise<string | undefined> {
		const interaction: TabInteraction = { kind: "selector", mounted: false };
		return new Promise((resolve) => {
			if (opts?.signal?.aborted) {
				resolve(undefined);
				return;
			}

			const finish = (option: string | undefined) => {
				opts?.signal?.removeEventListener("abort", onAbort);
				this.closeTabInteraction(interaction);
				resolve(option);
			};
			const onAbort = () => finish(undefined);
			opts?.signal?.addEventListener("abort", onAbort, { once: true });

			interaction.component = new ExtensionSelectorComponent(
				title,
				options,
				(option) => finish(option),
				() => finish(undefined),
				{
					tui: this.ui,
					timeout: opts?.timeout,
					keyShortcuts: opts?.keyShortcuts,
					onToggleToolsExpanded: () => this.toggleToolOutputExpansion(),
				},
			);

			this.openTabInteraction(tabId, interaction);
		});
	}

	/**
	 * Show a confirmation dialog for extensions.
	 */
	private async showExtensionConfirm(
		title: string,
		message: string,
		opts?: ExtensionUIDialogOptions,
		tabId?: string,
	): Promise<boolean> {
		const result = await this.showExtensionSelector(
			`${title}\n${message}`,
			["Yes", "No"],
			{
				...opts,
				keyShortcuts: { y: "Yes", n: "No" },
			},
			tabId,
		);
		return result === "Yes";
	}

	private async promptForMissingSessionCwd(error: MissingSessionCwdError): Promise<string | undefined> {
		const confirmed = await this.showExtensionConfirm(
			"Session cwd not found",
			formatMissingSessionCwdPrompt(error.issue),
		);
		return confirmed ? error.issue.fallbackCwd : undefined;
	}

	/**
	 * Show a text input for extensions.
	 */
	private showExtensionInput(
		title: string,
		placeholder?: string,
		opts?: ExtensionUIDialogOptions,
		tabId?: string,
	): Promise<string | undefined> {
		const interaction: TabInteraction = { kind: "input", mounted: false };
		return new Promise((resolve) => {
			if (opts?.signal?.aborted) {
				resolve(undefined);
				return;
			}

			const finish = (value: string | undefined) => {
				opts?.signal?.removeEventListener("abort", onAbort);
				this.closeTabInteraction(interaction);
				resolve(value);
			};
			const onAbort = () => finish(undefined);
			opts?.signal?.addEventListener("abort", onAbort, { once: true });

			interaction.component = new ExtensionInputComponent(
				title,
				placeholder,
				(value) => finish(value),
				() => finish(undefined),
				{ tui: this.ui, timeout: opts?.timeout },
			);

			this.openTabInteraction(tabId, interaction);
		});
	}

	/**
	 * Show a multi-line editor for extensions (with Ctrl+G support).
	 */
	private showExtensionEditor(title: string, prefill?: string, tabId?: string): Promise<string | undefined> {
		const interaction: TabInteraction = { kind: "editor", mounted: false };
		return new Promise((resolve) => {
			interaction.component = new ExtensionEditorComponent(
				this.ui,
				this.keybindings,
				title,
				prefill,
				(value) => {
					this.closeTabInteraction(interaction);
					resolve(value);
				},
				() => {
					this.closeTabInteraction(interaction);
					resolve(undefined);
				},
				undefined,
				this.settingsManager.getExternalEditorCommand(),
			);

			this.openTabInteraction(tabId, interaction);
		});
	}

	/**
	 * Set a custom editor component from an extension.
	 * Pass undefined to restore the default editor.
	 */
	private setCustomEditorComponent(factory: EditorFactory | undefined): void {
		this.editorComponentFactory = factory;

		// Save text from current editor before switching
		const currentText = this.editor.getText();

		this.disposeActiveSelector();
		this.editorContainer.clear();

		if (factory) {
			// Create the custom editor with tui, theme, and keybindings
			const newEditor = factory(this.ui, getEditorTheme(), this.keybindings);

			// Wire up callbacks from the default editor
			newEditor.onSubmit = this.defaultEditor.onSubmit;
			newEditor.onChange = this.defaultEditor.onChange;

			// Copy text from previous editor
			newEditor.setText(currentText);

			// Copy appearance settings if supported
			if (newEditor.borderColor !== undefined) {
				newEditor.borderColor = this.defaultEditor.borderColor;
			}
			if (newEditor.setPaddingX !== undefined) {
				newEditor.setPaddingX(this.defaultEditor.getPaddingX());
			}
			if (newEditor.setAutocompleteMaxVisible !== undefined) {
				newEditor.setAutocompleteMaxVisible(this.defaultEditor.getAutocompleteMaxVisible());
			}

			// Set autocomplete if supported
			if (newEditor.setAutocompleteProvider && this.autocompleteProvider) {
				newEditor.setAutocompleteProvider(this.autocompleteProvider);
			}

			// If extending CustomEditor, copy app-level handlers
			// Use duck typing since instanceof fails across jiti module boundaries
			const customEditor = newEditor as unknown as Record<string, unknown>;
			if ("actionHandlers" in customEditor && customEditor.actionHandlers instanceof Map) {
				if (!customEditor.onEscape) {
					customEditor.onEscape = () => this.defaultEditor.onEscape?.();
				}
				if (!customEditor.onCtrlD) {
					customEditor.onCtrlD = () => this.defaultEditor.onCtrlD?.();
				}
				if (!customEditor.onPasteImage) {
					customEditor.onPasteImage = () => this.defaultEditor.onPasteImage?.();
				}
				if (!customEditor.onExtensionShortcut) {
					customEditor.onExtensionShortcut = (data: string) => this.defaultEditor.onExtensionShortcut?.(data);
				}
				if (!customEditor.getPlaceholder) {
					customEditor.getPlaceholder = () => this.defaultEditor.getPlaceholder?.();
				}
				if (!customEditor.onVimKey) {
					customEditor.onVimKey = (data: string) => this.defaultEditor.onVimKey?.(data) ?? false;
				}
				if (!customEditor.onVimEnterArmKey) {
					customEditor.onVimEnterArmKey = (data: string) => this.defaultEditor.onVimEnterArmKey?.(data) ?? false;
				}
				if (!customEditor.onWidgetPanelKey) {
					customEditor.onWidgetPanelKey = (data: string) => this.defaultEditor.onWidgetPanelKey?.(data) ?? false;
				}
				// Copy action handlers (clear, suspend, model switching, etc.)
				for (const [action, handler] of this.defaultEditor.actionHandlers) {
					customEditor.actionHandlers.set(action, handler);
				}
			}

			this.editor = newEditor;
		} else {
			// Restore default editor with text from custom editor
			this.defaultEditor.setText(currentText);
			this.editor = this.defaultEditor;
		}

		this.editorContainer.addChild(this.editor as Component);
		// Home paints no working chrome; restoreStatusAfterHome repaints on leave.
		if (this.activeStatusIndicator && !this.homeSelection.active) {
			this.statusContainer.clear();
			this.activeWorkingIndicatorEmbedded = this.setEditorWorkingStatusIndicator(this.activeStatusIndicator);
			if (!this.activeWorkingIndicatorEmbedded) {
				this.statusContainer.addChild(this.activeStatusIndicator);
			}
		}
		this.ui.setFocus(this.editor as Component);
		this.ui.requestRender();
	}

	/**
	 * Show a notification for extensions.
	 */
	private showExtensionNotify(message: string, type?: "info" | "warning" | "error"): void {
		if (type === "error") {
			this.showError(message);
		} else if (type === "warning") {
			this.showWarning(message);
		} else {
			this.showStatus(message);
		}
	}

	/**
	 * Show a custom component with keyboard focus. Overlay mode renders on top of
	 * existing content; either form belongs to `tabId`, so it follows that tab.
	 */
	private async showExtensionCustom<T>(
		factory: (
			tui: TUI,
			theme: Theme,
			keybindings: KeybindingsManager,
			done: (result: T) => void,
		) => (Component & { dispose?(): void }) | Promise<Component & { dispose?(): void }>,
		options?: {
			overlay?: boolean;
			overlayOptions?: OverlayOptions | (() => OverlayOptions);
			onHandle?: (handle: OverlayHandle) => void;
		},
		tabId?: string,
	): Promise<T> {
		const isOverlay = options?.overlay ?? false;
		const interaction: TabInteraction = { kind: isOverlay ? "overlay" : "custom", mounted: false };
		this.trackTabInteraction(tabId, interaction);

		// A custom component owns the composer while it is on the slot, so the draft it displaced
		// goes back when it closes. `mountTabInteraction` reads that draft, so a dialog that waits
		// for a background tab never records another tab's.
		const restoreDraft = () => {
			if (isOverlay || !interaction.mounted || interaction.savedDraft === undefined) return;
			this.editor.setText(interaction.savedDraft);
		};

		return new Promise((resolve, reject) => {
			let component: Component & { dispose?(): void };
			let closed = false;

			const close = (result: T) => {
				if (closed) return;
				closed = true;
				// The draft goes back before the slot: `unmountTabInteraction` is what hands focus
				// back to an overlay this component displaced.
				restoreDraft();
				interaction.overlay?.handle.hide();
				this.unmountTabInteraction(interaction);
				interaction.untrack?.();
				this.remountParkedTabInteraction(interaction.tabId);
				this.ui.requestRender();
				resolve(result);
				try {
					component?.dispose?.();
				} catch {
					/* ignore dispose errors */
				}
			};

			Promise.resolve(factory(this.ui, theme, this.keybindings, close))
				.then((c) => {
					if (closed) return;
					component = c;
					interaction.component = component;
					if (isOverlay) {
						// Resolve overlay options - can be static or dynamic function
						const resolveOptions = (): OverlayOptions | undefined => {
							if (options?.overlayOptions) {
								const opts =
									typeof options.overlayOptions === "function"
										? options.overlayOptions()
										: options.overlayOptions;
								return opts;
							}
							// Fallback: use component's width property if available
							const w = (component as { width?: number }).width;
							return w ? { width: w } : undefined;
						};
						const overlayOptions = this.scopeOverlayToTab(resolveOptions() ?? {}, tabId);
						const handle = this.ui.showOverlay(component, overlayOptions);
						interaction.overlay = { handle, capturing: overlayOptions.nonCapturing !== true };
						// Expose handle to caller for visibility control
						options?.onHandle?.(handle);
						this.ui.requestRender();
					} else {
						if (tabId === undefined || this.tabShowsOnScreen(tabId)) this.mountTabInteraction(tabId, interaction);
						this.ui.requestRender();
					}
				})
				.catch((err) => {
					if (closed) return;
					closed = true;
					restoreDraft();
					this.unmountTabInteraction(interaction);
					interaction.untrack?.();
					reject(err);
				});
		});
	}

	/**
	 * Show an extension error in the UI.
	 */
	private showExtensionError(extensionPath: string, error: string, stack?: string): void {
		const errorMsg = `Extension "${extensionPath}" error: ${error}`;
		const errorText = new Text(theme.fg("error", errorMsg), 1, 0);
		this.chatContainer.addChild(errorText);
		if (stack) {
			// Show stack trace in dim color, indented
			const stackLines = stack
				.split("\n")
				.slice(1) // Skip first line (duplicates error message)
				.map((line) => theme.fg("dim", `  ${line.trim()}`))
				.join("\n");
			if (stackLines) {
				this.chatContainer.addChild(new Text(stackLines, 1, 0));
			}
		}
		this.ui.requestRender();
	}

	// =========================================================================
	// Toast notifications (transient typed messages)
	// =========================================================================

	/** Per-tab toast slot; falls back to a local slot without a tab manager. */
	private toastHost(): ToastHost {
		const activeTab = this.tabManager?.getActive();
		if (activeTab) return activeTab;
		this.fallbackToastHost ??= {};
		return this.fallbackToastHost;
	}

	/** Report a clipboard result the alternate screen handed over instead of flashing its own line. */
	private notifyCopyResult(result: ClipboardResult): void {
		if (result.ok) this.notifyToast("success", copyConfirmation(result.graphemes));
		else this.notifyToast("error", copyFailure(result.detail ?? "clipboard unavailable"));
	}

	/** Record a typed message for the active tab and show it over the transcript. */
	private notifyToast(type: ToastType, message: string): void {
		pushToast(this.toastHost(), { type, message });
		this.syncToast();
	}

	/**
	 * Paint the active tab's live toast with the time it has left, and drop the
	 * card when that tab has none. Runs on every push and every tab switch.
	 */
	private syncToast(): void {
		const toast = activeToast(this.toastHost());
		if (toast === undefined) {
			this.hideToast();
			return;
		}
		this.showToast(toast.type, toast.message, Math.max(0, TOAST_DURATION_MS - (Date.now() - toast.createdAt)));
	}

	/**
	 * Paint a toast card in the top-right corner for `durationMs`, replacing any
	 * card already on screen. A terminal too small for the card gets no card.
	 */
	private showToast(type: ToastType, message: string, durationMs: number): void {
		this.hideToast();
		const boxWidth = toastBoxWidth(type, message, this.ui.terminal.columns);
		if (boxWidth === undefined) return;
		const rows = toastCardRows(type, message, boxWidth);
		// Only the fullscreen layout pins the tab bar above the transcript; the regular
		// renderer scrolls it with the document, so the card stays at the window's top.
		const chromeRows = this.renderer instanceof TuiAltScreen ? this.rowsAboveTranscript() : 0;
		const topOffset = chromeRows + TOAST_MARGIN;
		this.toastOverlay.show(
			this.ui,
			new ToastCardComponent(type, message),
			{
				anchor: "top-right",
				width: boxWidth,
				offsetY: topOffset,
				// Right margin only: a narrow terminal can still hold the narrowest card flush
				// against its left edge.
				margin: { top: 0, right: TOAST_MARGIN, bottom: TOAST_MARGIN, left: 0 },
				nonCapturing: true,
				visible: (termWidth, termHeight) =>
					termWidth >= boxWidth + TOAST_MARGIN && termHeight >= topOffset + rows + TOAST_MARGIN,
			},
			durationMs,
			() => {
				// The card on screen belongs to this host: a tab switch re-ran syncToast,
				// which replaced this timer.
				clearToast(this.toastHost());
				this.hideToast();
			},
		);
	}

	/** Rows the layout spends above the transcript, which the card must clear. */
	private rowsAboveTranscript(): number {
		const tabBar = this.tabBarContainer;
		if (!tabBar) return 0;
		return tabBar.render(this.ui.terminal.columns).length;
	}

	/** Drop the card and its timer; the toast stays with the tab. */
	private hideToast(): void {
		this.toastOverlay.hide();
	}

	/**
	 * Show the vim user-message preview: the chat's user messages around the one the
	 * viewport landed on, painted above the dock for a moment after the jump.
	 */
	private showUserMessagePreview(labels: readonly string[], selectedIndex: number): void {
		this.hideUserMessagePreview();
		const terminalWidth = this.ui.terminal.columns;
		const rowBudget = userMessagePreviewRows(this.transcriptScrollView?.viewportHeight);
		const { lines, highlightedIndex } = userMessagePreviewWindow(labels, selectedIndex, rowBudget);
		const boxRows = lines.length + USER_MESSAGE_PREVIEW_FRAME_ROWS;
		const boxWidth = Math.min(USER_MESSAGE_PREVIEW_WIDTH, terminalWidth - USER_MESSAGE_PREVIEW_RIGHT_MARGIN);
		if (boxWidth < USER_MESSAGE_PREVIEW_MIN_WIDTH) return;
		// The preview sits in the transcript region, directly above the dock: the rows
		// the layout keeps below the transcript are the margin it must clear.
		const bottomGap = this.rowsBelowTranscript() + USER_MESSAGE_PREVIEW_BOTTOM_GAP_ROWS;
		this.userMessagePreviewOverlay.show(
			this.ui,
			new UserMessagePreviewPanel(lines, highlightedIndex),
			{
				anchor: "bottom-right",
				width: boxWidth,
				// The right margin keeps the transcript's scrollbar column visible.
				margin: { top: 0, right: USER_MESSAGE_PREVIEW_RIGHT_MARGIN, bottom: bottomGap, left: 0 },
				nonCapturing: true,
				// A panel that does not fit above the transcript is dropped rather than clamped
				// over the conversation: the overlay layout would otherwise pin it to the top row
				// of the screen and paint it there.
				visible: (width, height) =>
					width >= boxWidth + USER_MESSAGE_PREVIEW_RIGHT_MARGIN &&
					height - bottomGap - boxRows >= this.rowsAboveTranscript(),
			},
			USER_MESSAGE_PREVIEW_TTL_MS,
			() => this.hideUserMessagePreview(),
		);
	}

	/** Take the preview down and drop its timer. */
	private hideUserMessagePreview(): void {
		this.userMessagePreviewOverlay.hide();
	}

	/** Rows the layout keeps below the transcript, which the preview has to clear. */
	private rowsBelowTranscript(): number {
		const width = this.ui.terminal.columns;
		// The dock stacks the pending rows, the status line, the widget slots, the editor
		// and the footer, in that order.
		const containers = [
			this.pendingMessagesContainer,
			this.statusContainer,
			...(this.dockWidgetsVisible() ? [this.dockWidgets.above, this.dockWidgets.below] : []),
			this.editorContainer,
			this.footerContainer,
		];
		return containers.reduce((rows, container) => rows + container.render(width).length, 0);
	}

	/**
	 * Whether the dock draws the extension widget slots. Vim mode is a reading surface,
	 * so its rows go to the transcript; the dock layout and the preview's geometry share
	 * this one rule.
	 */
	private dockWidgetsVisible(): boolean {
		return !this.vimTabState().active;
	}

	// =========================================================================
	// Vim mode (modal transcript navigation)
	// =========================================================================

	/** Per-tab vim state; falls back to a local state without a tab manager. */
	private vimTabState(): VimTabState {
		const activeTab = this.tabManager?.getActive();
		if (activeTab) return activeTab.vim;
		this.fallbackVimState ??= createVimTabState();
		return this.fallbackVimState;
	}

	/**
	 * Transcript navigation for the modal surface. Every method is a no-op without a
	 * viewport, where `available()` reports false and `/vim` refuses to enter.
	 */
	private createVimHost(): VimKeyHost {
		return {
			keybindings: this.keybindings,
			controller: {
				available: () => this.viewportTui() !== undefined,
				// Scrolling goes through the alternate screen's own viewport API; only the
				// direction is inverted, because the modal surface counts towards older
				// output while a scroll view counts towards newer rows.
				scrollLines: (lines) => this.viewportTui()?.scrollBy(-lines),
				scrollToOldest: () => this.viewportTui()?.scrollToTop(),
				scrollToNewest: () => this.viewportTui()?.scrollToBottom(),
				jumpUserMessage: (direction) => {
					const view = this.transcriptScrollView;
					if (!view) return false;
					const blocks = this.windowedTranscript.matchingBlocks(isUserMessageBlock);
					if (blocks.length === 0) return false;
					const labels = blocks.map((block) => userMessagePreviewLabel(block.block.getText()));
					const state = this.vimTabState();
					// No cursor yet means the viewport sits past the newest message, which is where
					// a jump starts and where `right` runs out of messages.
					const current = state.userMessageIndex ?? blocks.length;
					const target =
						direction === 1
							? Math.min(current + 1, blocks.length)
							: Math.max(0, Math.min(current, blocks.length) - 1);
					state.userMessageIndex = target;
					// The panel follows the cursor, whether the viewport moved or ran into an end.
					this.showUserMessagePreview(labels, target);
					// Running into an end leaves the cursor where it was; the caller then paints the
					// newest output, which is where that end already is.
					const row = target === current ? undefined : blocks[target]?.row;
					if (row === undefined) return false;
					view.scrollTo(row);
					return true;
				},
			},
			notify: (message, type = "info") => this.notifyToast(type, message),
		};
	}

	/** The transcript viewport, when the current renderer has one. */
	private viewportTui(): TuiAltScreen | undefined {
		return this.renderer instanceof TuiAltScreen ? this.renderer : undefined;
	}

	/** Repaint the editor frame after the modal surface started or ended. */
	private refreshVimChrome(): void {
		this.updateEditorBorderColor();
		this.viewportTui()?.refreshMouseHover();
		this.ui.requestRender();
	}

	private enterActiveTabVimMode(): void {
		const state = this.vimTabState();
		if (enterVimMode(state, this.createVimHost())) this.refreshVimChrome();
	}

	/**
	 * Vim key dispatch for the editor. A key that leaves the modal surface changes
	 * what the editor should look like, so the frame is refreshed on a transition.
	 */
	private handleVimKeyInput(data: string): boolean {
		const state = this.vimTabState();
		if (!state.active) return false;
		const handled = handleVimKey(state, data, this.createVimHost());
		// The only transition this path can make is leaving the modal surface, and the
		// module leaves it on its own (the exit key), so the teardown runs here too.
		if (!state.active) this.afterVimExit();
		return handled;
	}

	/**
	 * The transcript viewport is unmounted outside fullscreen mode, so the modal
	 * surface cannot survive a mode switch back to regular rendering.
	 */
	private leaveVimModeIfUnavailable(): void {
		if (this.viewportTui() !== undefined) return;
		this.leaveVimMode();
	}

	/** Leave the modal transcript surface, if this tab is on it. */
	private leaveVimMode(): void {
		const state = this.vimTabState();
		if (!state.active) return;
		resetVimTabState(state);
		this.afterVimExit();
	}

	/** Drop what belongs to the modal surface and repaint the editor frame. */
	private afterVimExit(): void {
		this.hideUserMessagePreview();
		this.refreshVimChrome();
	}

	// =========================================================================
	// Key Handlers
	// =========================================================================

	private setupKeyHandlers(): void {
		// Vim mode owns every key while it is active; unbound keys are swallowed so
		// they cannot reach the editor. Tab/tool/thinking actions pass through.
		this.defaultEditor.onVimKey = (data) => this.handleVimKeyInput(data);
		// Empty-queue `ctrl+u` arms vim entry; `u` or another `ctrl+u` confirms it.
		// A draft in the composer and a working session leave the arm open; a queued
		// message blocks it, because `ctrl+u` edits that queue (the dequeue
		// keybinding), so the arm declines and the key falls through.
		this.defaultEditor.onVimEnterArmKey = (data) => {
			const state = this.vimTabState();
			if (state.active) return false;
			const canArm =
				this.compactionQueuedMessages.length === 0 &&
				!this.hasQueuedMessages() &&
				!isShowingAutocomplete(this.editor);
			const result = handleVimEnterArmKey(state, data, this.createVimHost(), canArm, Date.now());
			if (result.entered) this.refreshVimChrome();
			return result.consumed;
		};
		// An armed queue-edit choice (s/f after the dequeue key) takes the next key.
		this.defaultEditor.onQueueEditArmKey = (data) => this.handleQueueEditArmKey(data);

		// Set up handlers on defaultEditor - they use this.editor for text access
		// so they work correctly regardless of which editor is active
		this.defaultEditor.onEscape = () => {
			// A queued steer message sends immediately: abort the run and flush the
			// steer queue as one turn. Follow-up rounds are never promoted.
			if (this.tryFlushSteerQueue()) return;
			if (this.session.isStreaming) {
				this.restoreQueuedMessagesToEditor({ abort: true });
			} else if (this.session.isBashRunning) {
				this.session.abortBash();
			} else if (this.isBashMode) {
				this.editor.setText("");
				this.isBashMode = false;
				this.updateEditorBorderColor();
			} else if (!this.editor.getText().trim()) {
				// Double-escape with empty editor triggers /tree, /fork, or nothing based on setting
				const action = this.settingsManager.getDoubleEscapeAction();
				if (action !== "none") {
					const now = Date.now();
					if (now - this.lastEscapeTime < 500) {
						if (action === "tree") {
							this.showTreeSelector();
						} else {
							this.showUserMessageSelector();
						}
						this.lastEscapeTime = 0;
					} else {
						this.lastEscapeTime = now;
					}
				}
			}
		};

		// The empty-composer Right toggles the widget side panel; it runs before
		// extension shortcuts, which may bind the same key.
		this.defaultEditor.onWidgetPanelKey = () => this.handleWidgetPanelKey();

		// Register app action handlers
		this.defaultEditor.onAction("app.clear", () => this.handleCtrlC());
		this.defaultEditor.onCtrlD = () => this.handleCtrlD();
		this.defaultEditor.onAction("app.quit", () => this.showQuitConfirm());
		this.defaultEditor.onAction("app.palette", () => this.handlePaletteShortcut());
		this.defaultEditor.onAction("app.suspend", () => this.handleCtrlZ());
		this.defaultEditor.onAction("app.thinking.cycle", () => this.cycleThinkingLevel());
		this.defaultEditor.onAction("app.model.cycleForward", () => this.cycleModel("forward"));
		this.defaultEditor.onAction("app.model.cycleBackward", () => this.cycleModel("backward"));

		// Global debug handler on TUI (works regardless of focus)
		this.ui.onDebug = () => this.handleDebugCommand();
		this.defaultEditor.onAction("app.model.select", () => this.showModelSelector());
		this.defaultEditor.onAction("app.tools.expand", () => this.toggleToolOutputExpansion());
		// Tab Jump takes ctrl+t; the thinking-block toggle keeps its own ctrl+t default and is
		// declined here by registration order, so the chord reaches this handler first.
		this.defaultEditor.onAction("app.tab.jump", () => this.handleTabJumpShortcut());
		this.defaultEditor.onAction("app.thinking.toggle", () => this.toggleThinkingBlockVisibility());
		this.defaultEditor.onAction("app.editor.external", () => void this.handleOpenExternalEditor());
		this.defaultEditor.onAction("app.message.copy", () => void this.handleCopyCommand({ preferSelection: true }));
		this.defaultEditor.onAction("app.message.followUp", () => this.handleFollowUp());
		this.defaultEditor.onAction("app.message.dequeue", () => this.handleDequeue());
		this.defaultEditor.onAction("app.session.new", () => this.handleClearCommand());
		this.defaultEditor.onAction("app.tab.next", () => this.handleTabCycle(1));
		this.defaultEditor.onAction("app.tab.previous", () => this.handleTabCycle(-1));
		// Home keys decline (return false) off Home so the composer keeps them.
		this.defaultEditor.onAction("app.home.selectPrevious", () => this.handleHomeSelect(-1));
		this.defaultEditor.onAction("app.home.selectNext", () => this.handleHomeSelect(1));
		this.defaultEditor.onAction("app.home.attach", () => this.handleHomeAttach());
		this.defaultEditor.onAction("app.home.send", (data) => this.handleHomeSend(data));
		this.defaultEditor.onAction("app.home.returnHome", () => this.handleHomeReturn());
		this.defaultEditor.onAction("app.home.toggleNonIdle", () => this.handleHomeToggleNonIdle());
		this.defaultEditor.onAction("app.tab.new", () => void this.handleNewTab());
		this.defaultEditor.onAction("app.tab.close", () => void this.handleCloseTab());
		this.defaultEditor.onAction("app.session.tree", () => this.showTreeSelector());
		this.defaultEditor.onAction("app.session.fork", () => this.showUserMessageSelector());
		this.defaultEditor.onAction("app.session.resume", () => this.showSessionSelector());

		this.defaultEditor.onChange = (text: string) => {
			const wasBashMode = this.isBashMode;
			this.isBashMode = text.trimStart().startsWith("!");
			if (wasBashMode !== this.isBashMode) {
				this.updateEditorBorderColor();
			}
		};

		// Handle clipboard paste (triggered on Ctrl+V). Images are attached by path;
		// otherwise, paste plain text from the system clipboard.
		this.defaultEditor.onPasteImage = () => {
			void this.handleClipboardPaste();
		};

		// The app-chrome shortcuts above live on the editor, which a focused extension dialog
		// replaces; this listener keeps them answering while such a dialog is up.
		this.registerExtensionDialogShortcutListener();
	}

	private async handleRightClickPaste(): Promise<void> {
		const target = this.renderer.getFocusedComponent();
		const handleInput = target?.handleInput;
		if (!target || !handleInput) return;
		try {
			const text = await readClipboardText();
			if (!text || this.renderer.getFocusedComponent() !== target) return;
			handleInput.call(target, `\x1b[200~${text}\x1b[201~`);
			this.ui.requestRender();
		} catch {
			// Silently ignore clipboard errors (may not have permission, etc.)
		}
	}

	private async handleClipboardPaste(): Promise<void> {
		try {
			const image = await readClipboardImage();
			if (image) {
				const tmpDir = os.tmpdir();
				const ext = extensionForImageMimeType(image.mimeType) ?? "png";
				const fileName = `pi-clipboard-${crypto.randomUUID()}.${ext}`;
				const filePath = path.join(tmpDir, fileName);
				fs.writeFileSync(filePath, Buffer.from(image.bytes));

				this.editor.insertTextAtCursor?.(filePath);
				this.ui.requestRender();
				return;
			}

			const text = await readClipboardText();
			if (text) {
				this.editor.insertTextAtCursor?.(text);
				this.ui.requestRender();
			}
		} catch {
			// Silently ignore clipboard errors (may not have permission, etc.)
		}
	}

	private handleStartupSubmit(text: string): void {
		this.editor.setText(text);
		this.showStatus("Startup is still in progress");
	}

	private setupEditorSubmitHandler(): void {
		this.defaultEditor.onSubmit = async (text: string) => {
			text = text.trim();
			if (!text) return;

			// The text may be an extension command, and a turn runs with the hooks
			// `session_start` installs, so the tab is bound before anything is dispatched.
			await this.ensureSessionBoundForSubmit();

			// Handle commands
			if (text === "/settings") {
				this.showSettingsSelector();
				this.editor.setText("");
				return;
			}
			if (text === "/batch" || text.startsWith("/batch ")) {
				this.editor.setText("");
				await this.handleBatchCommand(text.slice("/batch".length).trim());
				return;
			}
			if (text === "/follow-up" || text.startsWith("/follow-up ")) {
				this.editor.setText("");
				await this.handleFollowUpCommand(text.slice("/follow-up".length));
				return;
			}
			if (text === "/scoped-models") {
				this.editor.setText("");
				await this.showModelsSelector();
				return;
			}
			if (text === "/model" || text.startsWith("/model ")) {
				const searchTerm = text.startsWith("/model ") ? text.slice(7).trim() : undefined;
				this.editor.setText("");
				await this.handleModelCommand(searchTerm);
				return;
			}
			if (text === "/thinking" || text.startsWith("/thinking ")) {
				const searchTerm = text.startsWith("/thinking ") ? text.slice(10).trim() : undefined;
				this.editor.setText("");
				this.handleThinkingCommand(searchTerm);
				return;
			}
			if (text === "/context-limit" || text.startsWith("/context-limit ")) {
				const args = text.startsWith("/context-limit ") ? text.slice("/context-limit ".length).trim() : "";
				this.editor.setText("");
				this.handleContextLimitCommand(args);
				return;
			}
			if (text === "/export" || text.startsWith("/export ")) {
				await this.handleExportCommand(text);
				this.editor.setText("");
				return;
			}
			if (text === "/import" || text.startsWith("/import ")) {
				await this.handleImportCommand(text);
				this.editor.setText("");
				return;
			}
			if (text === "/share") {
				await this.handleShareCommand();
				this.editor.setText("");
				return;
			}
			if (text === "/bug" || text.startsWith("/bug ")) {
				const hint = text.slice("/bug".length).trim();
				this.editor.setText("");
				await this.handleBugCommand(hint ? hint : undefined);
				return;
			}
			if (text === "/copy") {
				await this.handleCopyCommand();
				this.editor.setText("");
				return;
			}
			if (text === "/name" || text.startsWith("/name ")) {
				this.handleNameCommand(text);
				this.editor.setText("");
				return;
			}
			if (text === "/session") {
				this.handleSessionCommand();
				this.editor.setText("");
				return;
			}
			if (text === "/changelog") {
				this.handleChangelogCommand();
				this.editor.setText("");
				return;
			}
			if (text === "/hotkeys") {
				this.handleHotkeysCommand();
				this.editor.setText("");
				return;
			}
			if (text === "/console-history") {
				this.editor.setText("");
				await this.handleConsoleHistoryCommand();
				return;
			}
			if (text.startsWith("/console-history ")) {
				this.showError("Usage: /console-history");
				return;
			}
			if (text === "/system-prompt") {
				this.editor.setText("");
				await this.handleSystemPromptCommand();
				return;
			}
			if (text.startsWith("/system-prompt ")) {
				this.showError("Usage: /system-prompt");
				return;
			}
			if (text === "/system-tools" || text.startsWith("/system-tools ")) {
				const args = text.startsWith("/system-tools ") ? text.slice("/system-tools ".length) : "";
				this.editor.setText("");
				await this.handleSystemToolsCommand(args);
				return;
			}
			if (text === "/palette") {
				this.editor.setText("");
				this.showCommandPalette();
				return;
			}
			if (text.startsWith("/palette ")) {
				this.showError("Usage: /palette");
				return;
			}
			if (text === "/jump") {
				this.editor.setText("");
				this.showTabJump();
				return;
			}
			if (text.startsWith("/jump ")) {
				this.showError("Usage: /jump");
				return;
			}
			if (text === "/editor") {
				const pending = this.paletteCommandDraft;
				// An agent tab reaches this with the composer already emptied by its submit. Home re-fills
				// the composer with the command text, and a queued command leaves it as it was, so a
				// composer that still holds exactly this command carries no draft.
				const composer = this.editor.getExpandedText?.() ?? this.editor.getText();
				const holdsCommand = composer.trim() === text;
				const draft = pending?.expandedText ?? (holdsCommand ? "" : composer);
				const wrote = await this.handleOpenExternalEditor(draft);
				// Once the external editor wrote, what it wrote stays: an emptied draft is a result too.
				if (pending && wrote) pending.ownsEditor = true;
				return;
			}
			if (text.startsWith("/editor ")) {
				this.showError("Usage: /editor");
				return;
			}
			if (text === "/fork") {
				this.showUserMessageSelector();
				this.editor.setText("");
				return;
			}
			if (text === "/clone") {
				this.editor.setText("");
				await this.handleCloneCommand();
				return;
			}
			if (text === "/tree") {
				this.showTreeSelector();
				this.editor.setText("");
				return;
			}
			if (text === "/trust") {
				this.showTrustSelector();
				this.editor.setText("");
				return;
			}
			if (text === "/login" || text.startsWith("/login ")) {
				const providerRef = text.startsWith("/login ") ? text.slice(7).trim() : undefined;
				this.editor.setText("");
				await this.handleLoginCommand(providerRef);
				return;
			}
			if (text === "/logout") {
				this.showOAuthSelector("logout");
				this.editor.setText("");
				return;
			}
			if (text === "/workdir" || text.startsWith("/workdir ")) {
				const target = text.slice("/workdir".length).trim();
				this.editor.setText("");
				await this.handleWorkdirCommand(target);
				return;
			}
			if (text === "/new-session" || text.startsWith("/new-session ")) {
				const parsed = parseNewSessionArgs(
					text.startsWith("/new-session ") ? text.slice("/new-session ".length) : "",
				);
				this.editor.setText("");
				if (parsed.error) {
					this.showError(parsed.error);
					return;
				}
				await this.handleNewTab(parsed.title, parsed.focus);
				return;
			}
			if (text === "/close-session" || text.startsWith("/close-session ")) {
				const args = text.slice("/close-session".length).trim();
				this.editor.setText("");
				await this.handleCloseSession(args);
				return;
			}
			if (text === "/close-all-sessions") {
				this.editor.setText("");
				await this.handleCloseAllSessions();
				return;
			}
			if (text === "/delete-session" || text.startsWith("/delete-session ")) {
				const args = text.slice("/delete-session".length).trim();
				this.editor.setText("");
				await this.handleDeleteSession(args);
				return;
			}
			if (text === "/delete-all-sessions") {
				this.editor.setText("");
				await this.handleDeleteAllSessions();
				return;
			}
			if (text === "/rename" || text.startsWith("/rename ")) {
				const title = text.startsWith("/rename ") ? text.slice("/rename ".length).trim() : "";
				this.editor.setText("");
				if (title) this.renameActiveTab(title);
				else this.showError("Tab title cannot be empty");
				return;
			}
			if (text === "/tabs") {
				this.editor.setText("");
				this.showTabList();
				return;
			}
			if (text === "/tab" || text.startsWith("/tab ")) {
				const arg = text.startsWith("/tab ") ? text.slice("/tab ".length).trim() : "";
				this.editor.setText("");
				await this.handleTabCommand(arg);
				return;
			}
			if (text === "/color" || text.startsWith("/color ")) {
				const arg = text.startsWith("/color ") ? text.slice("/color ".length).trim() : "";
				this.editor.setText("");
				this.colorActiveTab(arg);
				return;
			}
			if (text === "/group-colored-tabs") {
				this.editor.setText("");
				this.groupTabsByColor();
				return;
			}
			if (text === "/mark-done") {
				this.editor.setText("");
				this.markActiveTabDone();
				return;
			}
			if (text === "/vim") {
				this.editor.setText("");
				this.enterActiveTabVimMode();
				return;
			}
			if (text === "/toggle-zen-mode") {
				this.editor.setText("");
				this.handleToggleZenMode();
				return;
			}
			if (text === "/toggle-inline-widgets") {
				this.editor.setText("");
				this.handleToggleInlineWidgets();
				return;
			}
			if (text === "/widgets" || text.startsWith("/widgets ")) {
				const args = text.startsWith("/widgets ") ? text.slice("/widgets ".length) : "";
				this.editor.setText("");
				this.handleWidgetsCommand(args);
				return;
			}
			if (text === "/save-workspace" || text.startsWith("/save-workspace ")) {
				const name = text.startsWith("/save-workspace ") ? text.slice("/save-workspace ".length).trim() : "";
				this.editor.setText("");
				if (name) this.saveWorkspaceCommand(name);
				else this.showError("Usage: /save-workspace <name>");
				return;
			}
			if (text === "/restore-workspace" || text.startsWith("/restore-workspace ")) {
				const name = text.startsWith("/restore-workspace ") ? text.slice("/restore-workspace ".length).trim() : "";
				this.editor.setText("");
				if (!name) {
					const names = readWorkspaces(this.tabsWorkdir).map((workspace) => workspace.name);
					this.showError(
						names.length > 0
							? `Usage: /restore-workspace <name> (saved: ${names.join(", ")})`
							: "Usage: /restore-workspace <name> (no saved workspaces)",
					);
					return;
				}
				await this.restoreWorkspaceCommand(name);
				return;
			}
			if (text === "/delete-workspace" || text.startsWith("/delete-workspace ")) {
				const name = text.startsWith("/delete-workspace ") ? text.slice("/delete-workspace ".length).trim() : "";
				this.editor.setText("");
				if (name) this.deleteWorkspaceCommand(name);
				else this.showError("Usage: /delete-workspace <name>");
				return;
			}
			if (text === "/clear") {
				this.editor.setText("");
				await this.handleClearCommand();
				return;
			}
			if (text === "/reset") {
				this.editor.setText("");
				await this.handleResetCommand();
				return;
			}
			if (text === "/compact" || text.startsWith("/compact ")) {
				const args = text.startsWith("/compact ") ? text.slice(9).trim() : "";
				this.editor.setText("");
				await this.handleCompactCommand(args);
				return;
			}
			if (text === "/reload") {
				this.editor.setText("");
				await this.handleReloadCommand();
				return;
			}
			if (text === "/debug") {
				this.handleDebugCommand();
				this.editor.setText("");
				return;
			}
			if (text === "/arminsayshi") {
				this.handleArminSaysHi();
				this.editor.setText("");
				return;
			}
			if (text === "/dementedelves") {
				this.handleDementedDelves();
				this.editor.setText("");
				return;
			}
			if (text === "/resume") {
				this.showSessionSelector();
				this.editor.setText("");
				return;
			}
			if (text === "/resume-trash") {
				this.showTrashSelector();
				this.editor.setText("");
				return;
			}
			if (text === "/quit") {
				this.editor.setText("");
				await this.shutdown();
				return;
			}

			// Handle bash command (! for normal, !! for excluded from context)
			if (text.startsWith("!")) {
				const isExcluded = text.startsWith("!!");
				const command = isExcluded ? text.slice(2).trim() : text.slice(1).trim();
				if (command) {
					if (this.session.isBashRunning) {
						this.showWarning("A bash command is already running. Press Esc to cancel it first.");
						this.editor.setText(text);
						return;
					}
					this.editor.addToHistory?.(text);
					await runInTabConsole(this.tabManager?.getActive(), () => this.handleBashCommand(command, isExcluded));
					this.isBashMode = false;
					this.updateEditorBorderColor();
					return;
				}
			}

			// A message belongs to the tab whose composer submitted it. The main loop runs
			// one prompt at a time, so routing a submit through its shared queue would
			// deliver the message to whichever tab is focused when another turn ends.
			const submitTab = this.tabManager?.activeTab();
			const submitSession = submitTab?.runtime.session ?? this.session;

			// Queue input during compaction (extension commands execute immediately)
			if (submitSession.isCompacting) {
				if (this.isExtensionCommand(text)) {
					this.editor.addToHistory?.(text);
					this.editor.setText("");
					await runInTabConsole(submitTab, () => submitSession.prompt(text));
				} else {
					this.queueCompactionMessage(text, "steer");
				}
				return;
			}

			// If streaming, use prompt() with steer behavior
			// This handles extension commands (execute immediately), prompt template expansion, and queueing
			if (submitSession.isStreaming) {
				this.editor.addToHistory?.(text);
				this.editor.setText("");
				await runInTabConsole(submitTab, () => submitSession.prompt(text, { streamingBehavior: "steer" }));
				this.updatePendingMessagesDisplay();
				this.ui.requestRender();
				return;
			}

			// Normal message submission
			// First, move any pending bash components to chat
			this.flushPendingBashComponents();
			this.editor.addToHistory?.(text);

			// Send now; the shared queue below serves only a session without tabs.
			if (submitTab) {
				runInTabConsole(submitTab, () => submitSession.prompt(text)).then(
					() => this.ui.requestRender(),
					(error: unknown) => {
						this.setEditorText(text);
						this.showError(`Send failed: ${error instanceof Error ? error.message : String(error)}`);
						this.ui.requestRender();
					},
				);
				return;
			}

			if (this.onInputCallback) {
				this.onInputCallback(text);
			} else {
				this.pendingUserInputs.push(text);
			}
		};
	}

	private subscribeToAgent(): void {
		this.unsubscribe = this.session.subscribe(async (event) => {
			await this.handleEvent(event);
		});
	}

	private async handleEvent(event: AgentSessionEvent): Promise<void> {
		if (!this.isInitialized) {
			await this.init();
		}

		this.footer.invalidate();

		switch (event.type) {
			case "agent_start":
				this.pendingTools.clear();
				this.followUpState.followUpRunFailed = false;
				// Restore main escape handler if retry handler is still active
				// (retry success event fires later, but we need main handler now)
				if (this.retryEscapeHandler) {
					this.defaultEditor.onEscape = this.retryEscapeHandler;
					this.retryEscapeHandler = undefined;
				}
				break;

			case "turn_start":
				if (this.settingsManager.getShowTerminalProgress()) {
					this.ui.terminal.setProgress(true);
				}
				if (this.workingVisible) {
					if (this.activeStatusIndicator?.kind !== "working") {
						this.showWorkingStatusIndicator();
					}
				} else {
					this.clearStatusIndicator();
				}
				this.ui.requestRender();
				break;

			case "queue_update":
				this.syncQueuedMessageMirrors(event.steering, event.followUp);
				this.updatePendingMessagesDisplay();
				this.ui.requestRender();
				break;

			case "entry_appended":
				if (this.entriesRenderedByBoundaryCompaction.delete(event.entry.id)) break;
				if (event.entry.type === "custom") {
					this.addCustomEntryToChat(event.entry);
					this.ui.requestRender();
				} else if (event.entry.type === "usage" && event.entry.kind === "cache_warm") {
					this.addCacheWarmingUsage(event.entry);
					this.ui.requestRender();
				} else if (event.entry.type === "custom_message" && event.entry.display) {
					this.addMessageToChat(
						createCustomMessage(
							event.entry.customType,
							event.entry.content,
							event.entry.display,
							event.entry.details,
							event.entry.timestamp,
						),
					);
					this.ui.requestRender();
				} else if (event.entry.type === "compaction") {
					const entries = this.sessionManager.buildContextEntries();
					if (entries[0]?.id !== event.entry.id) break;
					this.chatContainer.clear();
					const branch = this.sessionManager.getBranch();
					const compactionIndex = branch.findIndex((entry) => entry.id === event.entry.id);
					const entriesAfterCompaction = new Set(branch.slice(compactionIndex + 1).map((entry) => entry.id));
					const retainedEntries = entries.slice(1);
					this.renderSessionEntries(retainedEntries.filter((entry) => !entriesAfterCompaction.has(entry.id)));
					this.addMessageToChat(
						createCompactionSummaryMessage(event.entry.summary, event.entry.tokensBefore, event.entry.timestamp),
					);
					if (event.entry.usage) {
						this.addCompactionCostNotice({
							type: "compaction_cost",
							kind: "compaction",
							usage: event.entry.usage,
						});
					}
					this.renderSessionEntries(retainedEntries.filter((entry) => entriesAfterCompaction.has(entry.id)));
					for (const entryId of entriesAfterCompaction) this.entriesRenderedByBoundaryCompaction.add(entryId);
					this.footer.invalidate();
					this.ui.requestRender();
				}
				break;

			case "session_info_changed":
				this.updateTerminalTitle();
				this.footer.invalidate();
				this.ui.requestRender();
				break;

			case "thinking_level_changed":
				this.footer.invalidate();
				this.updateEditorBorderColor();
				break;

			case "message_start":
				if (event.message.role === "custom") {
					this.addMessageToChat(event.message);
					this.ui.requestRender();
				} else if (event.message.role === "user") {
					this.addMessageToChat(event.message);
					this.updatePendingMessagesDisplay();
					this.ui.requestRender();
				} else if (event.message.role === "assistant") {
					this.streamingComponent = new AssistantMessageComponent(
						undefined,
						this.hideThinkingBlock,
						this.getMarkdownThemeWithSettings(),
						this.hiddenThinkingLabel,
						this.outputPad,
						this.getMarkdownTransformers(),
						this.mixcodeSettings.ui.boxedHiddenThinking,
					);
					this.streamingMessage = event.message;
					this.chatContainer.addChild(this.streamingComponent);
					this.streamingComponent.updateContent(this.streamingMessage, true);
					this.ui.requestRender();
				}
				break;

			case "message_update":
				if (this.streamingComponent && event.message.role === "assistant") {
					this.streamingMessage = event.message;
					this.streamingComponent.updateContent(this.streamingMessage, true);

					for (const content of this.streamingMessage.content) {
						if (content.type === "toolCall") {
							if (!this.pendingTools.has(content.id)) {
								const component = new ToolExecutionComponent(
									content.name,
									content.id,
									content.arguments,
									{
										showImages: this.settingsManager.getShowImages(),
										imageWidthCells: this.settingsManager.getImageWidthCells(),
									},
									this.getRegisteredToolDefinition(content.name),
									this.ui,
									this.sessionManager.getCwd(),
								);
								component.setExpanded(this.toolOutputExpanded);
								this.chatContainer.addChild(component);
								this.pendingTools.set(content.id, component);
							} else {
								const component = this.pendingTools.get(content.id);
								if (component) {
									component.updateArgs(content.arguments);
								}
							}
						}
					}
					this.ui.requestRender();
				}
				break;

			case "message_end":
				if (event.message.role === "user") break;
				if (this.streamingComponent && event.message.role === "assistant") {
					this.streamingMessage = event.message;
					let errorMessage: string | undefined;
					if (this.streamingMessage.stopReason === "aborted") {
						const retryAttempt = this.session.retryAttempt;
						errorMessage =
							retryAttempt > 0
								? `Aborted after ${retryAttempt} retry attempt${retryAttempt > 1 ? "s" : ""}`
								: "Operation aborted";
						this.streamingMessage.errorMessage = errorMessage;
					}
					this.streamingComponent.updateContent(this.streamingMessage, false);
					this.maybeShowResponseModelNotice(this.streamingMessage);

					if (this.streamingMessage.stopReason === "aborted" || this.streamingMessage.stopReason === "error") {
						// A failed run pauses queued follow-up rounds once the run settles.
						this.followUpState.followUpRunFailed = true;
						if (!errorMessage) {
							errorMessage = this.streamingMessage.errorMessage || "Error";
						}
						for (const [, component] of this.pendingTools.entries()) {
							component.updateResult({
								content: [{ type: "text", text: errorMessage }],
								isError: true,
							});
						}
						this.pendingTools.clear();
						this.maybeSuggestBugReport(this.streamingMessage);
					} else {
						// Args are now complete - trigger diff computation for edit tools
						for (const [, component] of this.pendingTools.entries()) {
							component.setArgsComplete();
						}
						this.maybeShowThinkingDropNotice(this.streamingMessage);
						this.maybeShowCacheMissNotice(this.streamingMessage);
					}
					this.streamingComponent = undefined;
					this.streamingMessage = undefined;
					this.footer.invalidate();
				}
				this.ui.requestRender();
				break;

			case "bash_execution_update":
				// The bash execution callback handles TUI output rendering.
				break;

			case "tool_execution_start": {
				let component = this.pendingTools.get(event.toolCallId);
				if (!component) {
					component = new ToolExecutionComponent(
						event.toolName,
						event.toolCallId,
						event.args,
						{
							showImages: this.settingsManager.getShowImages(),
							imageWidthCells: this.settingsManager.getImageWidthCells(),
						},
						this.getRegisteredToolDefinition(event.toolName),
						this.ui,
						this.sessionManager.getCwd(),
					);
					component.setExpanded(this.toolOutputExpanded);
					this.chatContainer.addChild(component);
					this.pendingTools.set(event.toolCallId, component);
				}
				component.markExecutionStarted();
				this.ui.requestRender();
				break;
			}

			case "tool_execution_update": {
				const component = this.pendingTools.get(event.toolCallId);
				if (component) {
					component.updateResult({ ...event.partialResult, isError: false }, true);
					this.ui.requestRender();
				}
				break;
			}

			case "tool_execution_end": {
				const component = this.pendingTools.get(event.toolCallId);
				if (component) {
					component.updateResult({ ...event.result, isError: event.isError });
					this.pendingTools.delete(event.toolCallId);
					this.ui.requestRender();
				}
				break;
			}

			case "agent_end":
				if (this.settingsManager.getShowTerminalProgress()) {
					this.ui.terminal.setProgress(false);
				}
				this.clearStatusIndicator("working");
				if (this.streamingComponent) {
					this.chatContainer.removeChild(this.streamingComponent);
					this.streamingComponent = undefined;
					this.streamingMessage = undefined;
				}
				this.pendingTools.clear();

				this.ui.requestRender();
				break;

			case "agent_settled":
				// A failed run pauses queued follow-up rounds, including runs the
				// drain did not start itself.
				if (this.followUpState.followUpRunFailed) pauseFollowUps(this.followUpState);
				// Steer texts left in the queue never start their own turn: send them now.
				scheduleSteerSettleFlush(this.followUpState, this.followUpHost);
				await this.checkShutdownRequested();
				break;

			case "compaction_start": {
				if (this.settingsManager.getShowTerminalProgress()) {
					this.ui.terminal.setProgress(true);
				}
				// Keep editor active; submissions are queued during compaction.
				this.autoCompactionEscapeHandler = this.defaultEditor.onEscape;
				this.defaultEditor.onEscape = () => {
					this.session.abortCompaction();
				};
				this.showStatusIndicator(
					new CompactionStatusIndicator(this.ui, event.reason, this.compactionModelRefs.get(this.session)),
				);
				this.ui.requestRender();
				break;
			}

			case "compaction_end": {
				this.compactionClaimed = false;
				this.compactionModelRefs.delete(this.session);
				if (this.settingsManager.getShowTerminalProgress()) {
					this.ui.terminal.setProgress(false);
				}
				if (this.autoCompactionEscapeHandler) {
					this.defaultEditor.onEscape = this.autoCompactionEscapeHandler;
					this.autoCompactionEscapeHandler = undefined;
				}
				this.clearStatusIndicator("compaction");
				if (event.aborted) {
					if (event.reason === "manual") {
						this.showError("Compaction cancelled");
					} else {
						this.showStatus("Auto-compaction cancelled");
					}
				} else if (event.result) {
					const entries = this.sessionManager.buildContextEntries();
					if (entries[0]?.type !== "compaction") {
						throw new Error("Completed compaction is missing from the session context");
					}
					this.chatContainer.clear();
					// The latest compaction is prepended for model context; append it below at its chronological position.
					this.renderSessionEntries(entries.slice(1));
					this.addMessageToChat(
						createCompactionSummaryMessage(
							event.result.summary,
							event.result.tokensBefore,
							new Date().toISOString(),
						),
					);
					if (event.result.usage) {
						this.addCompactionCostNotice({
							type: "compaction_cost",
							kind: "compaction",
							usage: event.result.usage,
						});
					}
					this.footer.invalidate();
				} else if (event.errorMessage) {
					// A failed compaction pauses queued follow-up rounds too.
					this.followUpState.followUpRunFailed = true;
					pauseFollowUps(this.followUpState);
					if (event.reason === "manual") {
						this.showError(event.errorMessage);
					} else {
						this.chatContainer.addChild(new Spacer(1));
						this.chatContainer.addChild(new Text(theme.fg("error", event.errorMessage), 1, 0));
					}
				}
				void this.flushCompactionQueue({ willRetry: event.willRetry });
				this.ui.requestRender();
				break;
			}

			case "auto_retry_start": {
				// Set up escape to abort retry
				this.retryEscapeHandler = this.defaultEditor.onEscape;
				this.defaultEditor.onEscape = () => {
					this.session.abortRetry();
				};
				this.showStatusIndicator(
					new RetryStatusIndicator(this.ui, event.attempt, event.maxAttempts, event.delayMs),
				);
				this.ui.requestRender();
				break;
			}

			case "auto_retry_end": {
				// Restore escape handler
				if (this.retryEscapeHandler) {
					this.defaultEditor.onEscape = this.retryEscapeHandler;
					this.retryEscapeHandler = undefined;
				}
				this.clearStatusIndicator("retry");
				// Show error only on final failure (success shows normal response)
				if (!event.success) {
					this.followUpState.followUpRunFailed = true;
					this.showError(`Retry failed after ${event.attempt} attempts: ${event.finalError || "Unknown error"}`);
				}
				this.ui.requestRender();
				break;
			}

			case "summarization_retry_scheduled": {
				this.showError(event.errorMessage);
				this.showStatusIndicator(
					new RetryStatusIndicator(this.ui, event.attempt, event.maxAttempts, event.delayMs),
				);
				this.ui.requestRender();
				break;
			}

			case "summarization_retry_attempt_start": {
				this.clearStatusIndicator("retry");
				if (event.source === "branchSummary") {
					this.showStatusIndicator(new BranchSummaryStatusIndicator(this.ui));
				} else {
					this.showStatusIndicator(
						new CompactionStatusIndicator(this.ui, event.reason, this.compactionModelRefs.get(this.session)),
					);
				}
				this.ui.requestRender();
				break;
			}

			case "summarization_retry_finished": {
				this.clearStatusIndicator("retry");
				this.ui.requestRender();
				break;
			}
		}
	}

	/** Extract text content from a user message */
	private getUserMessageText(message: Message): string {
		if (message.role !== "user") return "";
		const textBlocks =
			typeof message.content === "string"
				? [{ type: "text", text: message.content }]
				: message.content.filter((c: { type: string }) => c.type === "text");
		return textBlocks.map((c) => (c as { text: string }).text).join("");
	}

	/** Show a managed-tool status update in the chat. */
	private showManagedToolStatus(status: ToolStatus): void {
		if (!this.managedToolStatusStarted) {
			this.chatContainer.addChild(new Spacer(1));
			this.managedToolStatusStarted = true;
		}
		const message = status.type === "warning" ? `Warning: ${status.message}` : status.message;
		const color = status.type === "warning" ? "warning" : "dim";
		this.chatContainer.addChild(new Text(theme.fg(color, message), 1, 0));
		this.lastStatusSpacer = undefined;
		this.lastStatusText = undefined;
		this.ui.requestRender();
	}

	/**
	 * Show a status message in the chat.
	 *
	 * If multiple status messages are emitted back-to-back (without anything else being added to the chat),
	 * we update the previous status line instead of appending new ones to avoid log spam.
	 */
	private showStatus(message: string): void {
		const children = this.chatContainer.children;
		const last = children.length > 0 ? children[children.length - 1] : undefined;
		const secondLast = children.length > 1 ? children[children.length - 2] : undefined;

		if (last && secondLast && last === this.lastStatusText && secondLast === this.lastStatusSpacer) {
			this.lastStatusText.setText(theme.fg("dim", message));
			this.ui.requestRender();
			return;
		}

		const spacer = new Spacer(1);
		const text = new Text(theme.fg("dim", message), 1, 0);
		this.chatContainer.addChild(spacer);
		this.chatContainer.addChild(text);
		this.lastStatusSpacer = spacer;
		this.lastStatusText = text;
		this.ui.requestRender();
	}

	private addCustomEntryToChat(entry: Extract<SessionEntry, { type: "custom" }>): void {
		const renderer = this.session.extensionRunner.getEntryRenderer(entry.customType);
		if (!renderer) {
			return;
		}
		const component = new CustomEntryComponent(entry, renderer);
		component.setExpanded(this.toolOutputExpanded);
		if (!component.hasContent()) {
			return;
		}

		if (this.streamingComponent) {
			const streamingIndex = this.chatContainer.children.indexOf(this.streamingComponent);
			if (streamingIndex >= 0) {
				this.chatContainer.children.splice(streamingIndex, 0, component);
				return;
			}
		}

		this.chatContainer.addChild(component);
	}

	private addMessageToChat(message: AgentMessage): void {
		switch (message.role) {
			case "bashExecution": {
				const component = new BashExecutionComponent(message.command, this.ui, message.excludeFromContext);
				if (message.output) {
					component.appendOutput(message.output);
				}
				component.setComplete(
					message.exitCode,
					message.cancelled,
					message.truncated ? ({ truncated: true } as TruncationResult) : undefined,
					message.fullOutputPath,
				);
				this.chatContainer.addChild(component);
				break;
			}
			case "custom": {
				if (message.display) {
					const renderer = this.session.extensionRunner.getMessageRenderer(message.customType);
					const component = new CustomMessageComponent(
						message,
						renderer,
						this.getMarkdownThemeWithSettings(),
						this.outputPad,
					);
					component.setExpanded(this.toolOutputExpanded);
					this.chatContainer.addChild(component);
				}
				break;
			}
			case "compactionSummary": {
				this.chatContainer.addChild(new Spacer(1));
				const component = new CompactionSummaryMessageComponent(message, this.getMarkdownThemeWithSettings());
				component.setExpanded(this.toolOutputExpanded);
				this.chatContainer.addChild(component);
				break;
			}
			case "branchSummary": {
				this.chatContainer.addChild(new Spacer(1));
				const component = new BranchSummaryMessageComponent(message, this.getMarkdownThemeWithSettings());
				component.setExpanded(this.toolOutputExpanded);
				this.chatContainer.addChild(component);
				break;
			}
			case "system":
				break;
			case "user": {
				const textContent = this.getUserMessageText(message);
				if (textContent) {
					if (this.chatContainer.children.length > 0) {
						this.chatContainer.addChild(new Spacer(1));
					}
					const skillBlock = parseSkillBlock(textContent);
					if (skillBlock) {
						// Render skill block (collapsible)
						const component = new SkillInvocationMessageComponent(
							skillBlock,
							this.getMarkdownThemeWithSettings(),
						);
						component.setExpanded(this.toolOutputExpanded);
						this.chatContainer.addChild(component);
						// Render user message separately if present
						if (skillBlock.userMessage) {
							this.chatContainer.addChild(new Spacer(1));
							this.addUserMessage(skillBlock.userMessage, message.timestamp);
						}
					} else {
						this.addUserMessage(textContent, message.timestamp);
					}
				}
				break;
			}
			case "assistant": {
				const assistantComponent = new AssistantMessageComponent(
					message,
					this.hideThinkingBlock,
					this.getMarkdownThemeWithSettings(),
					this.hiddenThinkingLabel,
					this.outputPad,
					this.getMarkdownTransformers(),
					this.mixcodeSettings.ui.boxedHiddenThinking,
				);
				this.chatContainer.addChild(assistantComponent);
				break;
			}
			case "toolResult": {
				// Tool results are rendered inline with tool calls, handled separately
				break;
			}
			default: {
				const _exhaustive: never = message;
			}
		}
	}

	private renderSessionItems(items: readonly RenderSessionItem[], options: { updateFooter?: boolean } = {}): void {
		this.pendingTools.clear();
		const renderedPendingTools = new Map<string, ToolExecutionComponent>();
		// Cache misses are not persisted, unlike successful cache-warming usage.
		// Re-derive them and inject them after the assistant messages that paid for them.
		const cacheMisses = this.settingsManager.getShowCacheMissNotices()
			? collectCacheMisses(this.sessionManager.getEntries(), this.session.modelRuntime)
			: new Map<AssistantMessage, CacheMiss>();

		if (options.updateFooter) {
			this.footer.invalidate();
			this.updateEditorBorderColor();
		}

		for (const item of items) {
			if (isCustomSessionEntry(item)) {
				this.addCustomEntryToChat(item);
				continue;
			}
			if (isUsageSessionEntry(item)) {
				this.addCacheWarmingUsage(item);
				continue;
			}
			if (isCompactionCostNotice(item)) {
				this.addCompactionCostNotice(item);
				continue;
			}

			const message = item;
			// Assistant messages need special handling for tool calls
			if (message.role === "assistant") {
				this.addMessageToChat(message);
				// Render tool call components
				for (const content of message.content) {
					if (content.type === "toolCall") {
						const component = new ToolExecutionComponent(
							content.name,
							content.id,
							content.arguments,
							{
								showImages: this.settingsManager.getShowImages(),
								imageWidthCells: this.settingsManager.getImageWidthCells(),
							},
							this.getRegisteredToolDefinition(content.name),
							this.ui,
							this.sessionManager.getCwd(),
						);
						component.setExpanded(this.toolOutputExpanded);
						this.chatContainer.addChild(component);

						if (message.stopReason === "aborted" || message.stopReason === "error") {
							let errorMessage: string;
							if (message.stopReason === "aborted") {
								const retryAttempt = this.session.retryAttempt;
								errorMessage =
									retryAttempt > 0
										? `Aborted after ${retryAttempt} retry attempt${retryAttempt > 1 ? "s" : ""}`
										: "Operation aborted";
							} else {
								errorMessage = message.errorMessage || "Error";
							}
							component.updateResult({ content: [{ type: "text", text: errorMessage }], isError: true });
						} else {
							renderedPendingTools.set(content.id, component);
						}
					}
				}
				this.maybeShowResponseModelNotice(message);
				if (message.stopReason !== "aborted" && message.stopReason !== "error") {
					const miss = cacheMisses.get(message);
					if (miss) this.addCacheMissNotice(miss);
				}
			} else if (message.role === "toolResult") {
				// Match tool results to pending tool components
				const component = renderedPendingTools.get(message.toolCallId);
				if (component) {
					component.updateResult(message);
					renderedPendingTools.delete(message.toolCallId);
				}
			} else {
				// All other messages use standard rendering
				this.addMessageToChat(message);
			}
		}

		for (const [toolCallId, component] of renderedPendingTools) {
			this.pendingTools.set(toolCallId, component);
		}
		this.ui.requestRender();
	}

	/**
	 * Render session entries to chat. Used for initial load and rebuild after compaction.
	 * @param entries Compaction-aware session entries to render
	 * @param options.updateFooter Update footer state
	 */
	private renderSessionEntries(entries: SessionEntry[], options: { updateFooter?: boolean } = {}): void {
		const items = entries.flatMap((entry): RenderSessionItem[] => {
			if (entry.type === "custom" || (entry.type === "usage" && entry.kind === "cache_warm")) {
				return [entry];
			}
			const messages = sessionEntryToContextMessages(entry);
			if ((entry.type === "compaction" || entry.type === "branch_summary") && entry.usage && messages.length > 0) {
				return [...messages, { type: "compaction_cost", kind: entry.type, usage: entry.usage }];
			}
			return messages;
		});
		this.renderSessionItems(items, options);
	}

	private addCacheWarmingUsage(entry: UsageEntry): void {
		if (!this.settingsManager.getShowCacheMissNotices()) return;
		this.chatContainer.addChild(new Spacer(1));
		this.chatContainer.addChild(new Text(theme.fg("dim", formatCacheWarmingUsage(entry)), 1, 0));
	}

	/**
	 * Render billing usage for a compaction or branch summary. The notice is derived
	 * from persisted summary usage and is not stored as a separate session entry.
	 */
	private addCompactionCostNotice(notice: CompactionCostNotice): void {
		if (!this.settingsManager.getShowCacheMissNotices()) return;

		const { usage } = notice;
		const tokens = usage.input + usage.output + usage.cacheRead + usage.cacheWrite;
		const cost = usage.cost.total >= 0.01 ? ` (~$${usage.cost.total.toFixed(2)})` : "";
		const label = notice.kind === "compaction" ? "Compaction" : "Branch summary";
		this.chatContainer.addChild(new Spacer(1));
		this.chatContainer.addChild(
			new Text(theme.fg("warning", `${label}: ${formatTokens(tokens)} tokens billed${cost}`), 1, 0),
		);
	}

	private static countDroppedThinkingBlocks(message: AssistantMessage): number {
		let count = 0;
		for (const diagnostic of message.diagnostics ?? []) {
			if (diagnostic.type !== "anthropic_input_transformations") continue;
			const transformations = diagnostic.details?.transformations;
			if (!Array.isArray(transformations)) continue;
			count += transformations.filter(
				(transformation) =>
					typeof transformation === "object" &&
					transformation !== null &&
					(transformation as Record<string, unknown>).type === "thinking_dropped",
			).length;
		}
		return count;
	}

	private maybeShowThinkingDropNotice(message: AssistantMessage): void {
		if (!this.settingsManager.getShowCacheMissNotices()) return;

		const droppedCount = InteractiveMode.countDroppedThinkingBlocks(message);
		if (droppedCount === 0) return;

		let previousDroppedCount = 0;
		// message_end reaches the UI before the current message is persisted,
		// so the branch's last assistant message is the previous response.
		const branch = this.sessionManager.getBranch();
		for (let i = branch.length - 1; i >= 0; i--) {
			const entry = branch[i];
			if (entry.type === "message" && entry.message.role === "assistant") {
				previousDroppedCount = InteractiveMode.countDroppedThinkingBlocks(entry.message);
				break;
			}
		}
		if (droppedCount <= previousDroppedCount) return;

		const noun = droppedCount === 1 ? "thinking block" : "thinking blocks";
		this.chatContainer.addChild(new Spacer(1));
		this.chatContainer.addChild(
			new Text(theme.fg("warning", `Anthropic dropped ${droppedCount} ${noun} (details in session)`), 1, 0),
		);
	}

	/**
	 * Show a transcript notice when the provider answered with a model other than
	 * the one requested. Display only: the message keeps its own model, and a
	 * rebuild derives the notice from the persisted metadata again.
	 */
	private maybeShowResponseModelNotice(message: AssistantMessage): void {
		if (!this.mixcodeSettings.ui.showResponseModelNotices) return;
		const text = responseModelNoticeText(message);
		if (text) this.addTranscriptNotice(text);
	}

	/**
	 * Show a transcript notice when a completed assistant message paid for a
	 * significant cache miss. Only states observable facts: the miss itself,
	 * a model switch, or an idle gap past the cache TTL.
	 */
	private maybeShowCacheMissNotice(message: AssistantMessage): void {
		if (!this.settingsManager.getShowCacheMissNotices()) return;

		// Entries don't contain `message` yet: message_end fires before persistence.
		const miss = detectCacheMiss(this.sessionManager.getEntries(), message, this.session.modelRuntime);
		if (miss) this.addCacheMissNotice(miss);
	}

	/** Append one warning notice under a blank row of the transcript. */
	private addTranscriptNotice(text: string): void {
		this.chatContainer.addChild(new Spacer(1));
		this.chatContainer.addChild(new Text(theme.fg("warning", text), 1, 0));
	}

	private addCacheMissNotice(miss: CacheMiss): void {
		if (miss.missedTokens < 20_000 && miss.missedCost < 0.1) return;

		const cost = miss.missedCost >= 0.01 ? ` (~$${miss.missedCost.toFixed(2)})` : "";
		const reBilled = `${formatTokens(miss.missedTokens)} tokens re-billed${cost}`;
		let label = "Cache miss";
		if (miss.modelChanged) {
			label = "Cache miss after model switch";
		} else if (miss.idleMs >= CACHE_TTL_MS) {
			label = `Cache miss after ${Math.round(miss.idleMs / 60_000)}m idle`;
		}
		const text = `${label}: ${reBilled}`;
		this.addTranscriptNotice(text);
	}

	renderInitialMessages(): void {
		const entries = this.sessionManager.buildContextEntries();
		this.renderSessionEntries(entries, { updateFooter: true });
		this.syncEditorHistory();
		this.renderProjectTrustWarningIfNeeded();

		// Show compaction info if session was compacted
		const allEntries = this.sessionManager.getEntries();
		const compactionCount = allEntries.filter((e) => e.type === "compaction").length;
		if (compactionCount > 0) {
			const times = compactionCount === 1 ? "1 time" : `${compactionCount} times`;
			this.showStatus(`Session compacted ${times}`);
		}
	}

	private renderProjectTrustWarningIfNeeded(): void {
		if (this.settingsManager.isProjectTrusted() || !hasTrustRequiringProjectResources(this.sessionManager.getCwd())) {
			return;
		}

		if (this.chatContainer.children.length > 0) {
			this.chatContainer.addChild(new Spacer(1));
		}
		this.chatContainer.addChild(
			new Text(
				theme.fg(
					"warning",
					`This project is not trusted. Project ${CONFIG_DIR_NAME} resources and packages are ignored. Use /trust to save a trust decision, then restart pi.`,
				),
				1,
				0,
			),
		);
	}

	async getUserInput(): Promise<string> {
		const queuedInput = this.pendingUserInputs.shift();
		if (queuedInput !== undefined) {
			return queuedInput;
		}

		return new Promise((resolve) => {
			this.onInputCallback = (text: string) => {
				this.onInputCallback = undefined;
				resolve(text);
			};
		});
	}

	private rebuildChatFromMessages(): void {
		this.chatContainer.clear();
		this.renderSessionEntries(this.sessionManager.buildContextEntries());
	}

	/**
	 * Drop the rendered rows under the chat and under every parked transcript.
	 *
	 * Invalidation on its own stops short of them: a message block keeps its children's rows unless the
	 * theme changed, and the fullscreen layout mounts the windowed transcript, which does not forward
	 * invalidation into its blocks. This walks every descendant instead, so the rows a transcript painted
	 * before the deferred syntax grammars registered are rebuilt on the next render.
	 */
	private flushTranscriptRenderCaches(): void {
		const flush = (component: Component): void => {
			component.invalidate?.();
			if (component instanceof Container) {
				for (const child of component.children) flush(child);
			}
		};
		flush(this.chatContainer);
		for (const parkedTranscript of this.tabTranscript.values()) {
			for (const block of parkedTranscript.chat) flush(block);
			for (const block of parkedTranscript.loaded) flush(block);
		}
	}

	// =========================================================================
	// Key handlers
	// =========================================================================

	private handleCtrlC(): void {
		const now = Date.now();
		if (now - this.lastSigintTime < 500) {
			void this.shutdown();
		} else {
			this.stashEditorInput();
			this.clearEditor();
			// Clearing the composer also disarms a pending double-escape.
			this.lastEscapeTime = 0;
			this.lastSigintTime = now;
		}
	}

	/**
	 * Park the composer's text in the prompt history before `ctrl+c` clears it, so
	 * `up` recalls it. Home's composer is ephemeral, so nothing is parked there.
	 */
	private stashEditorInput(): void {
		const text = (this.editor.getExpandedText?.() ?? this.editor.getText()).trim();
		if (!text || this.homeSelection.active) return;
		const tabId = this.activeTabIdForUi;
		if (!tabId) {
			// No tabs: the one shared history takes the parked text.
			this.editor.addToHistory?.(text);
			return;
		}
		// Park the draft in the stash, then rebuild: the stash already drops an equal
		// older copy, so the editor must not also append one.
		const stashed = [text, ...(this.stashedPrompts.get(tabId) ?? []).filter((item) => item !== text)];
		this.stashedPrompts.set(tabId, stashed.slice(0, 100));
		this.syncEditorHistory();
	}

	private handleCtrlD(): void {
		// Only called when editor is empty (enforced by CustomEditor)
		void this.shutdown();
	}

	/**
	 * Gracefully shutdown the agent.
	 * Stops the TUI before emitting shutdown events so extension UI cleanup cannot
	 * repaint the final frame while the process is exiting.
	 */
	private isShuttingDown = false;

	private async shutdown(options?: { fromSignal?: boolean }): Promise<void> {
		if (this.isShuttingDown) return;
		this.isShuttingDown = true;
		// Keep signal handlers registered until terminal cleanup has completed.
		// `signal-exit` checks the listener list during the same SIGTERM/SIGHUP
		// dispatch and re-sends the signal if only its own listeners remain.

		if (options?.fromSignal) {
			// Signal-triggered shutdown (SIGTERM/SIGHUP). Emit extension cleanup
			// (session_shutdown) BEFORE touching the terminal. Extension teardown
			// such as removing sockets does not write to the tty, so it must not be
			// skipped if a later terminal-restore write fails on a dead or stalled
			// terminal. If the terminal is gone, the restore writes below emit EIO,
			// which the stdout/stderr error handler turns into emergencyTerminalExit;
			// the render loop is already idle, so this cannot hot-spin (see #4144).
			this.persistOpenTabs();
			this.sharedTabLayout?.dispose();
			this.sharedTabLayout = undefined;
			this.sharedLayoutErrorShown.clear();
			if (this.tabManager) {
				await this.tabManager.dispose();
			} else {
				await this.runtimeHost.dispose();
			}
			this.themeController.disableAutoSync();
			await this.ui.terminal.drainInput(1000);
			this.stop();
			process.exit(0);
		}

		// Interactive quit (Ctrl+D, Ctrl+C, /quit, extension shutdown()). Stop the
		// TUI before emitting shutdown events so extension UI cleanup cannot repaint
		// the final frame while the process is exiting.
		// Drain any in-flight Kitty key release events before stopping.
		// This prevents escape sequences from leaking to the parent shell over slow SSH.
		this.themeController.disableAutoSync();
		await this.ui.terminal.drainInput(1000);

		// Record the tab the user left on. Focus changes do not write the layout, so
		// the exit path is what keeps the restored focus current.
		this.persistOpenTabs();
		this.stop();
		this.sharedTabLayout?.dispose();
		this.sharedTabLayout = undefined;
		this.sharedLayoutErrorShown.clear();
		if (this.tabManager) {
			await this.tabManager.dispose();
		} else {
			await this.runtimeHost.dispose();
		}

		process.exit(0);
	}

	private emergencyTerminalExit(): never {
		this.isShuttingDown = true;
		this.unregisterSignalHandlers();
		killTrackedDetachedChildren();
		// The terminal is gone. Do not run normal shutdown because TUI and
		// extension cleanup can write restore sequences and re-trigger EIO.
		process.exit(129);
	}

	/**
	 * Last-resort handler for uncaught exceptions. The TUI puts stdin into raw
	 * mode and hides the cursor; without this handler, an uncaught throw from
	 * anywhere (e.g. an extension's async `ChildProcess.on("exit")` callback)
	 * tears down the process while leaving the terminal in raw mode with no
	 * cursor, requiring `stty sane && reset` to recover.
	 *
	 * Unlike emergencyTerminalExit, the terminal is still alive here, so we
	 * call ui.stop() to restore cooked mode, the cursor, and disable bracketed
	 * paste / Kitty / modifyOtherKeys sequences.
	 */
	private uncaughtCrash(error: Error): never {
		if (this.isShuttingDown) {
			process.exit(1);
		}
		this.isShuttingDown = true;
		try {
			this.unregisterSignalHandlers();
		} catch {}
		try {
			killTrackedDetachedChildren();
		} catch {}
		try {
			this.ui.stop();
		} catch {}
		// Straight to the real stderr: the console bridge would route this into a TUI
		// that stop() has just torn down, so the report would never be rendered.
		process.stderr.write(`${APP_NAME} exiting due to uncaughtException:\n`);
		process.stderr.write(`${format(error)}\n`);
		const extensionHint = this.getCrashExtensionHint(error);
		if (extensionHint) process.stderr.write(`\n${extensionHint}\n`);
		if (this.recordCrash("uncaught_exception", error)) {
			process.stderr.write(`\n${this.crashReportInstructions()}\n`);
		}
		process.exit(1);
	}

	/**
	 * Check if shutdown was requested and perform shutdown if so.
	 */
	private async checkShutdownRequested(): Promise<void> {
		if (!this.shutdownRequested) return;
		await this.shutdown();
	}

	private registerSignalHandlers(): void {
		this.unregisterSignalHandlers();

		const signals: NodeJS.Signals[] = ["SIGTERM"];
		if (process.platform !== "win32") {
			signals.push("SIGHUP");
		}

		for (const signal of signals) {
			const handler = () => {
				// SIGHUP no longer hard-exits: graceful shutdown emits session_shutdown
				// first, then attempts terminal restore. A genuinely dead terminal
				// surfaces as an EIO on the restore writes, which the stdout/stderr
				// error handler converts into emergencyTerminalExit (see #4144, #5080).
				killTrackedDetachedChildren();
				void this.shutdown({ fromSignal: true });
			};
			process.prependListener(signal, handler);
			this.signalCleanupHandlers.push(() => process.off(signal, handler));
		}

		const terminalErrorHandler = (error: Error) => {
			if (isDeadTerminalError(error)) {
				this.emergencyTerminalExit();
			}
			throw error;
		};
		process.stdout.on("error", terminalErrorHandler);
		process.stderr.on("error", terminalErrorHandler);
		this.signalCleanupHandlers.push(() => process.stdout.off("error", terminalErrorHandler));
		this.signalCleanupHandlers.push(() => process.stderr.off("error", terminalErrorHandler));

		// Restore the terminal before the process dies on any uncaught throw.
		// Without this, an unhandled exception from extension code (or anywhere
		// in pi) leaves the terminal in raw mode with no cursor.
		const uncaughtExceptionHandler = (error: Error) => this.uncaughtCrash(error);
		process.prependListener("uncaughtException", uncaughtExceptionHandler);
		this.signalCleanupHandlers.push(() => process.off("uncaughtException", uncaughtExceptionHandler));
	}

	private unregisterSignalHandlers(): void {
		for (const cleanup of this.signalCleanupHandlers) {
			cleanup();
		}
		this.signalCleanupHandlers = [];
	}

	private handleCtrlZ(): void {
		if (process.platform === "win32") {
			this.showStatus("Suspend to background is not supported on Windows");
			return;
		}

		// Keep the event loop alive while suspended. Without this, stopping the TUI
		// can leave Node with no ref'ed handles, causing the process to exit on fg
		// before the SIGCONT handler gets a chance to restore the terminal.
		const suspendKeepAlive = setInterval(() => {}, 2 ** 30);

		// Ignore SIGINT while suspended so Ctrl+C in the terminal does not
		// kill the backgrounded process. The handler is removed on resume.
		const ignoreSigint = () => {};
		process.on("SIGINT", ignoreSigint);

		// Set up handler to restore TUI when resumed
		process.once("SIGCONT", () => {
			clearInterval(suspendKeepAlive);
			process.removeListener("SIGINT", ignoreSigint);
			this.ui.start();
			this.ui.requestRender(true);
		});

		try {
			// Stop the TUI (restore terminal to normal mode)
			this.ui.stop();

			// Send SIGTSTP to process group (pid=0 means all processes in group)
			process.kill(0, "SIGTSTP");
		} catch (error) {
			clearInterval(suspendKeepAlive);
			process.removeListener("SIGINT", ignoreSigint);
			throw error;
		}
	}

	private async handleFollowUp(): Promise<void> {
		try {
			await this.queueFollowUpFromEditor();
		} catch (error) {
			this.showError(error instanceof Error ? error.message : String(error));
		}
	}

	private async queueFollowUpFromEditor(): Promise<void> {
		const text = (this.editor.getExpandedText?.() ?? this.editor.getText()).trim();
		if (!text) return;

		// Queue input during compaction (extension commands execute immediately)
		if (this.session.isCompacting) {
			if (this.isExtensionCommand(text)) {
				this.editor.addToHistory?.(text);
				this.editor.setText("");
				await runInTabConsole(this.tabManager?.getActive(), () => this.session.prompt(text));
			} else {
				// Follow-up rounds wait out the compaction like any other run; the
				// drain dispatches them once compaction_end settles.
				this.editor.addToHistory?.(text);
				this.editor.setText("");
				await submitFollowUps(this.followUpState, this.followUpHost, [text], "batch");
			}
			return;
		}

		// Alt+Enter queues a follow-up round (waits until agent finishes). The
		// round merges with adjacent batch rounds; /follow-up queues exclusive
		// rounds instead. Extension commands execute when their round arrives.
		// A paused queue keeps its order: new rounds append instead of jumping ahead.
		if (
			this.session.isStreaming ||
			(this.followUpState.followUpsPaused && this.followUpState.followUpQueue.length > 0)
		) {
			this.editor.addToHistory?.(text);
			this.editor.setText("");
			await submitFollowUps(this.followUpState, this.followUpHost, [text], "batch");
		}
		// If not streaming, Alt+Enter acts like regular Enter (trigger onSubmit)
		else if (this.editor.onSubmit) {
			this.editor.setText("");
			this.editor.onSubmit(text);
		}
	}

	/** Esc with queued steer texts: abort, then send the steer queue as one turn now. */
	private tryFlushSteerQueue(): boolean {
		// Compaction owns the queue until compaction_end; Esc falls through.
		if (this.session.isCompacting || this.compactionClaimed) return false;
		if (this.followUpState.pendingSteer.length === 0) return false;
		if (this.session.isStreaming) {
			pauseFollowUps(this.followUpState);
			void this.session.abort();
		}
		void flushSteerQueue(this.followUpState, this.followUpHost)
			.then(() => this.ui.requestRender())
			.catch((error: unknown) => {
				this.showError(`Failed to send queued messages: ${error instanceof Error ? error.message : String(error)}`);
			});
		return true;
	}

	/** `/batch <script> [-- <args...>]`: run a batch script against the tab fleet. */
	private async handleBatchCommand(rawArgs: string): Promise<void> {
		await runBatchCommand(this.batchCommandHost(), rawArgs);
	}

	/** The batch adapter's view of this instance; the mode owns no batch logic itself. */
	private batchCommandHost(): BatchCommandHost {
		return {
			tabManager: this.tabManager,
			homeActive: this.homeSelection.active,
			homeWorkdir: this.tabsWorkdir,
			followUpStates: this.followUpStates,
			boundSessions: this.boundSessions,
			compactionClaimed: this.compactionClaimed,
			bindTabExtensions: (tab) => this.bindTabExtensions(tab),
			showTab: (tab) => this.enqueueTabSwitch(() => this.switchActiveTab(tab)),
			withTabConsole: (tab, run) => runInTabConsole(tab, run),
			requestRender: () => {
				this.updatePendingMessagesDisplay();
				this.ui.requestRender();
			},
			showError: (message) => this.showError(message),
			showStatus: (message) => this.showStatus(message),
		};
	}

	/** `/follow-up [--batch] [message]`: queue a round, or resume paused rounds. */
	private async handleFollowUpCommand(rawArgs: string): Promise<void> {
		const { batch, message } = parseFollowUpArgs(rawArgs);
		if (batch && !message) {
			this.showError(`Usage: /follow-up [${FOLLOW_UP_BATCH_FLAG}] <message>`);
			return;
		}
		if (!message) {
			try {
				await resumeFollowUps(this.followUpState, this.followUpHost);
			} catch (error) {
				this.showError(error instanceof Error ? error.message : String(error));
			}
			return;
		}
		// Command texts queue as host rounds (executed on arrival, no model turn).
		try {
			await submitFollowUps(this.followUpState, this.followUpHost, [message], batch ? "batch" : "next");
		} catch (error) {
			this.showError(error instanceof Error ? error.message : String(error));
		}
	}

	/** The editable list of one queue kind, matching popQueuedMessage's view. */
	private pendingListFor(kind: QueueKind): string[] {
		return kind === "steering" ? this.followUpState.pendingSteer : this.followUpState.pendingFollowUps;
	}

	/** True while any steer or follow-up entry waits for dispatch or editing. */
	private hasQueuedMessages(): boolean {
		return this.pendingListFor("steering").length > 0 || this.pendingListFor("followUp").length > 0;
	}

	private handleDequeue(): void {
		const steerCount = this.followUpState.pendingSteer.length;
		const followUpCount = this.followUpState.pendingFollowUps.length;
		if (steerCount > 0 && followUpCount > 0) {
			// Both queues wait on one choice; arm a short window for s/f.
			this.queueEditArmDeadline = Date.now() + QUEUE_EDIT_ARM_WINDOW_MS;
			this.queueEditArmMessage = queueEditArmMessage();
			this.notifyToast("info", this.queueEditArmMessage);
			if (this.queueEditArmTimer) clearTimeout(this.queueEditArmTimer);
			this.queueEditArmTimer = setTimeout(() => this.endQueueEditArm(), QUEUE_EDIT_ARM_WINDOW_MS);
			return;
		}
		if (steerCount > 0) {
			this.popQueuedIntoEditor("steering");
			return;
		}
		if (followUpCount > 0) {
			this.popQueuedIntoEditor("followUp");
			return;
		}
		this.showStatus("No queued messages to restore");
	}

	/** Resolve an armed queue-edit choice; consumes only the queue-edit bindings inside the window. */
	private handleQueueEditArmKey(data: string): boolean {
		if (this.queueEditArmDeadline === 0 || Date.now() > this.queueEditArmDeadline) {
			this.endQueueEditArm();
			return false;
		}
		if (this.keybindings.matches(data, "app.queueEdit.cancel")) {
			this.endQueueEditArm();
			this.showStatus("Queue edit canceled");
			return true;
		}
		if (this.keybindings.matches(data, "app.queueEdit.steer")) {
			this.endQueueEditArm();
			this.popQueuedIntoEditor("steering");
			return true;
		}
		if (this.keybindings.matches(data, "app.queueEdit.followUp")) {
			this.endQueueEditArm();
			this.popQueuedIntoEditor("followUp");
			return true;
		}
		return false;
	}

	/** End the choice window, clear its timer, and drop the choice toast if it still shows. */
	private endQueueEditArm(): void {
		this.queueEditArmDeadline = 0;
		if (this.queueEditArmTimer) {
			clearTimeout(this.queueEditArmTimer);
			this.queueEditArmTimer = undefined;
		}
		const shownMessage = this.queueEditArmMessage;
		this.queueEditArmMessage = undefined;
		if (shownMessage === undefined || activeToast(this.toastHost())?.message !== shownMessage) return;
		clearToast(this.toastHost());
		this.hideToast();
	}

	/** Pop the last entry of one queue into the editor, preserving a non-empty draft. */
	private popQueuedIntoEditor(kind: QueueKind): void {
		const text = popQueuedMessage(this.followUpState, this.followUpHost, kind);
		if (text === undefined) {
			this.showWarning(`${kind === "steering" ? "Steer" : "Follow-up"} queue is empty`);
			return;
		}
		const draft = this.editorText();
		if (draft.trim()) {
			this.pendingListFor(kind).unshift(draft);
		}
		this.editor.setText(text);
		this.updatePendingMessagesDisplay();
		this.ui.requestRender();
	}

	private updateEditorBorderColor(): void {
		if (this.homeSelection.active) {
			// Home is not an agent: frame the composer with the neutral thinking colour.
			this.editor.borderColor = theme.getThinkingBorderColor("off");
			this.activeStatusIndicator?.invalidate();
			this.ui.requestRender();
			return;
		}
		if (this.vimTabState().active) {
			// Vim mode is a modal transcript surface; frame the locked editor distinctly.
			this.editor.borderColor = (str: string) => theme.fg("borderAccent", str);
		} else if (this.isBashMode) {
			this.editor.borderColor = theme.getBashModeBorderColor();
		} else {
			const level = this.session.thinkingLevel || "off";
			this.editor.borderColor = theme.getThinkingBorderColor(level);
		}
		this.activeStatusIndicator?.invalidate();
		this.ui.requestRender();
	}

	private cycleThinkingLevel(): void {
		const newLevel = this.session.cycleThinkingLevel();
		if (newLevel === undefined) {
			this.showStatus("Current model does not support thinking");
		} else {
			this.footer.invalidate();
			this.updateEditorBorderColor();
			this.showStatus(`Thinking level: ${newLevel}`);
		}
	}

	private async cycleModel(direction: "forward" | "backward"): Promise<void> {
		try {
			const result = await this.session.cycleModel(direction);
			if (result === undefined) {
				const msg = this.session.scopedModels.length > 0 ? "Only one model in scope" : "Only one model available";
				this.showStatus(msg);
			} else {
				this.dropContextLimitOverride();
				this.footer.invalidate();
				this.updateEditorBorderColor();
				const thinkingStr =
					result.model.reasoning && result.thinkingLevel !== "off" ? ` (thinking: ${result.thinkingLevel})` : "";
				this.showStatus(`Switched to ${result.model.name || result.model.id}${thinkingStr}`);
				void this.maybeWarnAboutAnthropicSubscriptionAuth(result.model);
			}
		} catch (error) {
			this.showError(error instanceof Error ? error.message : String(error));
		}
	}

	private toggleToolOutputExpansion(): void {
		this.setToolsExpanded(!this.toolOutputExpanded);
	}

	private setToolsExpanded(expanded: boolean): void {
		if (expanded === this.toolOutputExpanded) return;

		this.toolOutputExpanded = expanded;
		const activeHeader = this.customHeader ?? this.builtInHeader;
		if (isExpandable(activeHeader)) {
			activeHeader.setExpanded(expanded);
		}
		for (const container of [this.loadedResourcesContainer, this.chatContainer]) {
			for (const child of container.children) {
				if (isExpandable(child)) {
					child.setExpanded(expanded);
				}
			}
		}
		this.windowedTranscript?.resetMeasurements();
		this.showStatus(`Tool output: ${expanded ? "expanded" : "collapsed"}`);
	}

	/** Update rendered assistant messages without rebuilding live tool components. */
	private updateThinkingBlockVisibility(): void {
		for (const child of this.chatContainer.children) {
			if (child instanceof AssistantMessageComponent) {
				child.setHideThinkingBlock(this.hideThinkingBlock);
			}
		}
		this.windowedTranscript?.resetMeasurements();
		this.ui.requestRender();
	}

	private toggleThinkingBlockVisibility(): void {
		this.hideThinkingBlock = !this.hideThinkingBlock;
		this.settingsManager.setHideThinkingBlock(this.hideThinkingBlock);
		this.updateThinkingBlockVisibility();
		this.showStatus(`Thinking blocks: ${this.hideThinkingBlock ? "hidden" : "visible"}`);
	}

	/**
	 * Hand the composer's draft to the configured external editor and take its
	 * result back. A failure leaves the draft untouched in the composer, so it is
	 * not reported here; only the console-output path reports the editor error,
	 * where silence would read as if the output had been handed over.
	 */
	private async handleOpenExternalEditor(
		content = this.editor.getExpandedText?.() ?? this.editor.getText(),
	): Promise<boolean> {
		const editorCmd = this.settingsManager.getExternalEditorCommand();
		const result = await this.runExternalEditor(editorCmd, content);
		if (result.status !== "complete") return false;
		this.editor.setText(result.content);
		return true;
	}

	// =========================================================================
	// UI helpers
	// =========================================================================

	clearEditor(): void {
		this.editor.setText("");
		this.ui.requestRender();
	}

	showError(errorMessage: string): void {
		this.chatContainer.addChild(new Spacer(1));
		this.chatContainer.addChild(new Text(theme.fg("error", `Error: ${errorMessage}`), this.outputPad, 0));
		this.ui.requestRender();
	}

	showWarning(warningMessage: string): void {
		this.chatContainer.addChild(new Spacer(1));
		this.chatContainer.addChild(new Text(theme.fg("warning", `Warning: ${warningMessage}`), 1, 0));
		this.ui.requestRender();
	}

	/**
	 * Paint a bridged console line in the notice panel above the composer. Consecutive
	 * lines grow the open panel; a dismissed one is gone, so the next line opens a new
	 * panel on top of whatever is on screen.
	 */
	private showConsoleNotice(line: string): void {
		const open = this.consoleNotice;
		if (open) {
			open.component.append(line);
			const options = consoleNoticeOverlayOptions(open.component.getText());
			// Re-show the panel only when it has to grow: the text update above is enough
			// otherwise, and hiding and showing it on every line would flicker.
			if (options.width !== open.width) {
				open.handle.hide();
				this.consoleNotice = { ...open, handle: this.ui.showOverlay(open.component, options) };
			}
		} else {
			const component = new ConsoleNotice(line);
			const options = consoleNoticeOverlayOptions(line);
			const unsubscribe = this.ui.addInputListener((data) => this.handleConsoleNoticeKey(data));
			this.consoleNotice = {
				component,
				handle: this.ui.showOverlay(component, options),
				unsubscribe,
				width: Number(options.width),
			};
		}
		this.ui.requestRender();
	}

	/**
	 * Keys the open console notice answers without stealing the keyboard. Escape closes
	 * the panel, unless a run or a bash command is live and Escape is its interrupt key;
	 * the letter keys apply only while the composer is empty, so a draft always wins.
	 */
	private handleConsoleNoticeKey(data: string): { consume: boolean } | undefined {
		const open = this.consoleNotice;
		if (!open) return undefined;
		const interrupt = this.session.isStreaming || this.session.isBashRunning;
		if (interrupt && this.keybindings.matches(data, "app.interrupt")) return undefined;
		if (this.keybindings.matches(data, "app.notice.dismiss")) {
			this.hideConsoleNotice();
			return { consume: true };
		}
		if (this.editorText().length > 0) return undefined;
		if (this.keybindings.matches(data, "app.notice.copy")) {
			void copyToClipboard(open.component.getText()).catch((error: unknown) => {
				this.showError(`Copying the notice failed: ${error instanceof Error ? error.message : String(error)}`);
			});
			return { consume: true };
		}
		return undefined;
	}

	private hideConsoleNotice(): void {
		const open = this.consoleNotice;
		if (!open) return;
		this.consoleNotice = undefined;
		open.unsubscribe();
		open.handle.hide();
		this.ui.requestRender();
	}

	/**
	 * `/console-history`: hand the captured lines to an external editor when one is
	 * configured or installed, and fall back to a transcript block when none is.
	 */
	private async handleConsoleHistoryCommand(): Promise<void> {
		const history = getConsoleHistory();
		const text = history.length > 0 ? history.join("\n") : "No console history in this process.";
		await this.showInspectionOutput(text, { title: "Console History" });
	}

	/**
	 * `/system-prompt` shows the prompt the provider receives: the replayed
	 * transcript system message, or the base render before the first request records
	 * one. The footer breaks the prompt into its named sections.
	 */
	private async handleSystemPromptCommand(): Promise<void> {
		const effective = getEffectiveSystemPrompt(this.session);
		let text = effective?.text ?? this.session.systemPrompt;
		if (effective) text += renderSystemPromptSectionStats(effective.sections, text);
		await this.showInspectionOutput(text, { title: "System Prompt" });
	}

	/** `/system-tools` shows every active tool definition, with a per-tool size breakdown. */
	private async handleSystemToolsCommand(args: string): Promise<void> {
		// The report names itself, so it needs no block title.
		await this.showInspectionOutput(renderSystemToolsText(this.activeToolInfos()), {
			request: parseEditorFlag(args),
		});
	}

	/** Active tools with their source metadata, in the session's tool order. */
	private activeToolInfos(): ToolInfo[] {
		const active = new Set(this.session.getActiveToolNames());
		return this.session.getAllTools().filter((tool) => active.has(tool.name));
	}

	/**
	 * Show read-only command output: in the resolved external editor when one is
	 * available, in a chat block otherwise. The text is handed over to be read, so
	 * only an editor failure is reported and anything it wrote back is dropped.
	 */
	private async showInspectionOutput(
		text: string,
		options: { title?: string; request?: EditorFlagRequest } = {},
	): Promise<void> {
		const editor = options.request?.editorDisabled
			? undefined
			: options.request?.editor || resolveOutputEditor(this.configuredOutputEditor());
		if (editor) {
			const result = await this.runExternalEditor(editor, text);
			if (result.status === "failed") this.showError(`External editor "${editor}" exited with an error.`);
			return;
		}
		this.renderOutputBlock(options.title, text);
	}

	/** `externalEditor` from the project scope first, then the global scope. */
	private configuredOutputEditor(): string | undefined {
		const project = this.settingsManager.getProjectSettings().externalEditor;
		return typeof project === "string" ? project : this.settingsManager.getGlobalSettings().externalEditor;
	}

	/**
	 * Show `text` in `editor` with the TUI down, so the editor owns the terminal,
	 * and return what it produced. Only the console-output path reports a failure:
	 * its text went over to be read, so silence would look as if it had been shown,
	 * while a failed composer draft is still sitting in the composer.
	 */
	private async runExternalEditor(editor: string, text: string): Promise<ExternalEditorResult> {
		this.ui.stop();
		try {
			return await editInExternalEditor({ command: editor, content: text });
		} finally {
			this.ui.start();
			this.ui.requestRender(true);
		}
	}

	/** Render read-only command output as a bordered block in the transcript. */
	private renderOutputBlock(title: string | undefined, text: string): void {
		this.chatContainer.addChild(new Spacer(1));
		this.chatContainer.addChild(new DynamicBorder());
		if (title !== undefined) {
			this.chatContainer.addChild(new Text(theme.bold(theme.fg("accent", title)), 1, 0));
			this.chatContainer.addChild(new Spacer(1));
		}
		this.chatContainer.addChild(new Text(text, this.outputPad, 0));
		this.chatContainer.addChild(new DynamicBorder());
		this.ui.requestRender();
	}

	/**
	 * Clear all queued messages and return their contents.
	 * Clears both session queue and compaction queue.
	 */
	private clearAllQueues(): { steering: string[]; followUp: string[] } {
		const { steering, followUp } = this.session.clearQueue();
		const compactionSteering = this.compactionQueuedMessages
			.filter((msg) => msg.mode === "steer")
			.map((msg) => msg.text);
		const compactionFollowUp = this.compactionQueuedMessages
			.filter((msg) => msg.mode === "followUp")
			.map((msg) => msg.text);
		this.compactionQueuedMessages.length = 0;
		return {
			steering: [...steering, ...compactionSteering],
			followUp: [...followUp, ...compactionFollowUp],
		};
	}

	/** Session-side integration for the follow-up queue (core/mixcode/follow-up/). */
	private get followUpHost(): FollowUpHost {
		// Bind to the tab that owns this queue: a drain of a background tab must
		// dispatch into that tab's runtime, not whichever tab is focused.
		const tabId = this.followUpStateKey();
		const owningTab = () => this.tabManager?.get(tabId);
		const owningSession = () => owningTab()?.runtime.session ?? this.session;
		return {
			get session() {
				return owningSession();
			},
			promptTurn: (text, preflightResult) =>
				runInTabConsole(owningTab(), () => owningSession().prompt(text, { preflightResult })),
			runQueuedCommand: async (text) => {
				// A command runs through the shared composer, so its owning tab has to be the
				// tab in front: a background round would otherwise enter the focused tab's
				// `up` history and act on that tab. Home's action buttons and `/batch`
				// mount the tab they act on the same way.
				const tab = owningTab();
				if (tab && this.activeTabIdForUi !== tab.id) await this.activateTab(tab);
				await this.defaultEditor.onSubmit?.(text);
			},
			isQueuedCommandText: (text) => this.isQueuedFollowUpCommand(text),
			isCompactionClaimed: () => this.compactionClaimed,
			onQueueChanged: () => {
				this.updatePendingMessagesDisplay();
				this.ui.requestRender();
			},
			onQueueError: (error) => {
				this.showError(error instanceof Error ? error.message : `Follow-up queue failed: ${String(error)}`);
			},
			isDiscarded: () => this.followUpStates.get(tabId) === undefined,
		};
	}

	/** Queue state of the owning tab; rounds never cross conversations. */
	private followUpStateKey(): string {
		return this.tabManager?.activeTab()?.id ?? SINGLE_SESSION_TAB_ID;
	}

	private get followUpState(): FollowUpQueueState {
		const key = this.followUpStateKey();
		let state = this.followUpStates.get(key);
		if (!state) {
			state = createFollowUpQueueState();
			this.followUpStates.set(key, state);
		}
		return state;
	}

	/**
	 * Parked compaction messages of the active tab. Keyed by tab, so a message always
	 * flushes into the session that queued it.
	 */
	private get compactionQueuedMessages(): CompactionQueuedMessage[] {
		const key = this.followUpStateKey();
		let queue = this.compactionQueues.get(key);
		if (!queue) {
			queue = [];
			this.compactionQueues.set(key, queue);
		}
		return queue;
	}

	/** True when a slash/skill/template/builtin text must run host-side instead of as a model turn. */
	private isQueuedFollowUpCommand(text: string): boolean {
		if (!text.startsWith("/")) return false;
		const commandName = /^\/(\S+)/.exec(text)?.[1];
		if (commandName === undefined) return false;
		if (commandName.startsWith("skill:")) return true;
		if (BUILTIN_SLASH_COMMANDS.some((command) => command.name === commandName)) return true;
		if (this.isExtensionCommand(text)) return true;
		return this.session.promptTemplates.some((template) => template.name === commandName);
	}

	private updatePendingMessagesDisplay(): void {
		this.pendingMessagesContainer.clear();
		const steerCount = this.followUpState.pendingSteer.length;
		const followUpCount = this.followUpState.pendingFollowUps.length;
		if (steerCount === 0 && followUpCount === 0 && this.compactionQueuedMessages.length === 0) {
			return;
		}
		this.pendingMessagesContainer.addChild(new Spacer(1));
		this.pendingMessagesContainer.addChild(
			new QueuePreviewComponent(
				(): QueuePreviewData => ({
					// Parked (compaction) texts lead; SDK-mirrored steering texts trail.
					steer: this.followUpState.pendingSteer,
					followUpRounds: this.followUpState.followUpQueue,
					sdkFollowUps: this.followUpState.pendingFollowUps.slice(this.followUpState.followUpQueue.length),
					followUpsPaused: this.followUpState.followUpsPaused,
					compacting: this.session.isCompacting,
				}),
				(): QueuePreviewHints => ({
					dequeue: this.getAppKeyDisplay("app.message.dequeue"),
					sendNow: this.getAppKeyDisplay("app.interrupt"),
				}),
			),
		);
	}

	private restoreQueuedMessagesToEditor(options?: { abort?: boolean; currentText?: string }): number {
		// Aborting stops the run on purpose; queued follow-up rounds wait for an
		// explicit /follow-up instead of firing into the stopped session.
		if (options?.abort) pauseFollowUps(this.followUpState);
		const { steering, followUp } = this.clearAllQueues();
		const allQueued = [...steering, ...followUp];
		if (allQueued.length === 0) {
			this.updatePendingMessagesDisplay();
			if (options?.abort) {
				void this.session.abort();
			}
			return 0;
		}
		const queuedText = allQueued.join("\n\n");
		const currentText = options?.currentText ?? this.editor.getText();
		const combinedText = [queuedText, currentText].filter((t) => t.trim()).join("\n\n");
		this.editor.setText(combinedText);
		this.updatePendingMessagesDisplay();
		if (options?.abort) {
			void this.session.abort();
		}
		return allQueued.length;
	}

	/** Refresh the SDK steering/follow-up mirrors; parked steer texts keep their prefix. */
	private syncQueuedMessageMirrors(steering: readonly string[], followUp: readonly string[]): void {
		const state = this.followUpState;
		const parked = state.pendingSteer.slice(0, Math.max(0, state.pendingSteer.length - state.queuedSteerCount));
		state.pendingSteer = [...parked, ...steering];
		state.queuedSteerCount = steering.length;
		syncFollowUpPreview(state, followUp);
	}

	/**
	 * Re-derive the active tab's mirrors from its session.
	 *
	 * `queue_update` is only delivered for the session this mode is subscribed to, so
	 * a tab that is backgrounded while its steer/follow-up queue drains keeps a stale
	 * mirror. Showing that tab again must not repaint the consumed entries, and an Esc
	 * flush must not resend them, so read the live queues before the box is drawn.
	 */
	private resyncQueuedMessageMirrors(): void {
		this.syncQueuedMessageMirrors(this.session.getSteeringMessages(), this.session.getFollowUpMessages());
	}

	private queueCompactionMessage(text: string, mode: "steer" | "followUp"): void {
		this.compactionQueuedMessages.push({ text, mode });
		if (mode === "steer") {
			// Parked texts lead the SDK-mirrored tail; the mirror tells the two apart by
			// position, so insert before the tail instead of appending after it.
			const state = this.followUpState;
			state.pendingSteer.splice(state.pendingSteer.length - state.queuedSteerCount, 0, text);
		}
		this.editor.addToHistory?.(text);
		this.editor.setText("");
		this.updatePendingMessagesDisplay();
		this.showStatus("Queued message for after compaction");
	}

	private isExtensionCommand(text: string): boolean {
		if (!text.startsWith("/")) return false;

		const extensionRunner = this.session.extensionRunner;

		const spaceIndex = text.indexOf(" ");
		const commandName = spaceIndex === -1 ? text.slice(1) : text.slice(1, spaceIndex);
		return !!extensionRunner.getCommand(commandName);
	}

	private async flushCompactionQueue(options?: { willRetry?: boolean }): Promise<void> {
		// Flushing can outlive a tab switch, so hold the array this call started with.
		const parkedQueue = this.compactionQueuedMessages;
		if (parkedQueue.length === 0) {
			return;
		}

		const queuedMessages = parkedQueue.splice(0, parkedQueue.length);
		// Steer texts parked during compaction leave the preview with the flush;
		// restoreQueue puts them back if the flush fails.
		const parkedSteer = queuedMessages.filter((message) => message.mode === "steer").map((message) => message.text);
		const remainingSteer = [...this.followUpState.pendingSteer];
		for (const text of parkedSteer) {
			const index = remainingSteer.indexOf(text);
			if (index !== -1) remainingSteer.splice(index, 1);
		}
		this.followUpState.pendingSteer = remainingSteer;
		this.updatePendingMessagesDisplay();

		const restoreQueue = (error: unknown) => {
			this.session.clearQueue();
			parkedQueue.push(...queuedMessages);
			this.followUpState.pendingSteer = [...parkedSteer, ...this.followUpState.pendingSteer];
			this.updatePendingMessagesDisplay();
			this.showError(
				`Failed to send queued message${queuedMessages.length > 1 ? "s" : ""}: ${
					error instanceof Error ? error.message : String(error)
				}`,
			);
		};

		try {
			if (options?.willRetry) {
				// When retry is pending, queue messages for the retry turn
				for (const message of queuedMessages) {
					if (this.isExtensionCommand(message.text)) {
						await runInTabConsole(this.tabManager?.getActive(), () => this.session.prompt(message.text));
					} else if (message.mode === "followUp") {
						await runInTabConsole(this.tabManager?.getActive(), () => this.session.followUp(message.text));
					} else {
						await runInTabConsole(this.tabManager?.getActive(), () => this.session.steer(message.text));
					}
				}
				this.updatePendingMessagesDisplay();
				return;
			}

			// Find first non-extension-command message to use as prompt
			const firstPromptIndex = queuedMessages.findIndex((message) => !this.isExtensionCommand(message.text));
			if (firstPromptIndex === -1) {
				// All extension commands - execute them all
				for (const message of queuedMessages) {
					await runInTabConsole(this.tabManager?.getActive(), () => this.session.prompt(message.text));
				}
				return;
			}

			// Execute any extension commands before the first prompt
			const preCommands = queuedMessages.slice(0, firstPromptIndex);
			const firstPrompt = queuedMessages[firstPromptIndex];
			const rest = queuedMessages.slice(firstPromptIndex + 1);

			for (const message of preCommands) {
				await runInTabConsole(this.tabManager?.getActive(), () => this.session.prompt(message.text));
			}

			// Start a prompt when idle, or queue it into a run still finishing compaction.
			const promptPromise = runInTabConsole(this.tabManager?.getActive(), () =>
				this.session.prompt(firstPrompt.text, { streamingBehavior: firstPrompt.mode }),
			).catch((error) => {
				restoreQueue(error);
			});

			// Queue remaining messages
			for (const message of rest) {
				if (this.isExtensionCommand(message.text)) {
					await runInTabConsole(this.tabManager?.getActive(), () => this.session.prompt(message.text));
				} else if (message.mode === "followUp") {
					await runInTabConsole(this.tabManager?.getActive(), () => this.session.followUp(message.text));
				} else {
					await runInTabConsole(this.tabManager?.getActive(), () => this.session.steer(message.text));
				}
			}
			this.updatePendingMessagesDisplay();
			void promptPromise;
		} catch (error) {
			restoreQueue(error);
		}
	}

	/** Move pending bash components from pending area to chat */
	private flushPendingBashComponents(): void {
		for (const component of this.pendingBashComponents) {
			this.pendingMessagesContainer.removeChild(component);
			this.chatContainer.addChild(component);
		}
		this.pendingBashComponents = [];
	}

	// =========================================================================
	// Selectors
	// =========================================================================

	private disposeActiveSelector(): void {
		const dispose = this.activeSelectorDispose;
		this.activeSelectorToken = undefined;
		this.activeSelectorDispose = undefined;
		dispose?.();
	}

	/**
	 * Shows a selector component in place of the editor.
	 * @param create Factory that receives a `done` callback and returns the component and focus target
	 */
	private showSelector(
		create: (done: () => void) => { component: Component; focus: Component; dispose?: () => void },
	): void {
		const token = {};
		let dispose: (() => void) | undefined;
		const done = () => {
			dispose?.();
			if (this.activeSelectorToken !== token) return;
			this.activeSelectorToken = undefined;
			this.activeSelectorDispose = undefined;
			this.editorContainer.clear();
			this.editorContainer.addChild(this.editor);
			this.ui.setFocus(this.editor);
		};
		const created = create(done);
		dispose = created.dispose;
		this.disposeActiveSelector();
		this.activeSelectorToken = token;
		this.activeSelectorDispose = dispose;
		this.editorContainer.clear();
		this.editorContainer.addChild(created.component);
		this.ui.setFocus(created.focus);
		this.ui.requestRender();
	}

	/**
	 * Command palette (Ctrl+P): list every runnable command and run the chosen one.
	 * Skipped while the editor's own command popup is up, because that popup already
	 * owns the keyboard.
	 */
	private handlePaletteShortcut(): void {
		if (isShowingAutocomplete(this.editor)) return;
		this.showCommandPalette();
	}

	private showCommandPalette(): void {
		// The palette never lists itself: its only row would reopen what is already open.
		const commands: CommandPaletteEntry[] = collectSlashCommands(InteractiveMode.commandSource(this))
			.filter((command) => command.name !== "palette")
			.map((command) => ({ name: command.name, description: command.description }));
		if (commands.length === 0) return;

		// The overlay takes this share of the terminal, and clamps to the terminal as well, so a
		// window shorter than the panel's own chrome still loses the frame.
		const rowBudget = Math.floor((this.ui.terminal.rows * COMMAND_PALETTE_HEIGHT_PERCENT) / 100);
		let handle: OverlayHandle | undefined;
		const palette = new CommandPaletteComponent(
			commands,
			rowBudget,
			(name) => {
				handle?.hide();
				this.runCommandFromPalette(name);
			},
			() => handle?.hide(),
		);
		handle = this.ui.showOverlay(palette, {
			anchor: "center",
			width: `${COMMAND_PALETTE_WIDTH_PERCENT}%`,
			maxHeight: `${COMMAND_PALETTE_HEIGHT_PERCENT}%`,
			margin: 1,
		});
	}

	/**
	 * Tab Jump (Ctrl+T): list Home and every open agent tab and jump to the chosen one.
	 * Skipped while the editor's own command popup is up, like the palette chord.
	 */
	private handleTabJumpShortcut(): void {
		if (isShowingAutocomplete(this.editor)) return;
		this.showTabJump();
	}

	private showTabJump(): void {
		// A selector in the editor slot (tree, model, resume) or an overlay of this fork already
		// owns the keyboard, and opening over either would leave its close path unrun. An
		// extension dialog is different: the overlay stack hands it back its focus when Tab Jump
		// closes.
		if (!this.tabManager || this.activeSelectorToken !== undefined) return;
		if (this.ui.hasCapturingOverlay() && !this.hasFocusedExtensionOverlay()) return;
		const model = this.getTabBarModel();

		const maxVisibleRows = Math.max(
			TAB_JUMP_MIN_VISIBLE_ROWS,
			Math.floor(this.ui.terminal.rows * TAB_JUMP_MAX_ROWS_SHARE),
		);
		let handle: OverlayHandle | undefined;
		const overlay = new TabJumpComponent(
			this.tabJumpEntries(model),
			model.activeId || HOME_TAB_ID,
			maxVisibleRows,
			(id) => {
				handle?.hide();
				void this.activateTabById(id);
			},
			() => handle?.hide(),
		);
		handle = this.ui.showOverlay(overlay, {
			anchor: "center",
			width: `${TAB_JUMP_WIDTH_PERCENT}%`,
			maxHeight: `${TAB_JUMP_HEIGHT_PERCENT}%`,
			margin: 1,
		});
	}

	/**
	 * The rows Tab Jump lists: Home first, then the tabs the tab bar is showing. Reusing that
	 * projection keeps the two surfaces from disagreeing, and a tab still coming up shows its
	 * spinner in both.
	 */
	private tabJumpEntries(model: TabBarModel): TabJumpEntry[] {
		return [
			{ id: HOME_TAB_ID, title: model.home?.label ?? "MixCode Home", status: "idle", unread: false },
			...model.tabs.map((tab) => ({
				id: tab.id,
				title: tab.title,
				status: tab.status,
				unread: tab.unread,
				waiting: tab.waiting,
			})),
		];
	}

	/**
	 * Run a palette selection through the editor's submit path, so the command's own
	 * argument parsing, gating and error reporting apply unchanged. The command sees
	 * its own text in the editor; once it is done with the editor, the draft that was
	 * there goes back, so picking from the palette never costs the user what they had
	 * typed.
	 */
	private runCommandFromPalette(name: string): void {
		const text = `/${name}`;
		const draft = this.editorText();
		// Every tab shares one composer, so a draft belongs to the surface that mounts it. A command
		// that switches tabs must hand the draft back there instead of typing it into the tab it
		// switched to; Home's composer is ephemeral, so it owns no draft.
		const ownerOfMountedComposer = () => (this.homeSelection.active ? HOME_TAB_ID : this.activeTabIdForUi);
		const draftOwner = ownerOfMountedComposer();
		// `/editor` edits the draft this replaces and keeps what the external editor wrote.
		const pending: PaletteCommandDraft = {
			expandedText: this.editor.getExpandedText?.() ?? draft,
			ownsEditor: false,
		};
		this.paletteCommandDraft = pending;
		// A command that cleared the editor, or left the command text in it, is done with it.
		const restoreDraft = () => {
			this.paletteCommandDraft = undefined;
			if (pending.ownsEditor) return;
			if (draftOwner && draftOwner !== ownerOfMountedComposer()) {
				// Park it on the tab that owned the composer; a tab the command closed is ignored.
				if (draftOwner !== HOME_TAB_ID) this.tabManager?.setDraft(draftOwner, draft);
				return;
			}
			const remaining = this.editorText();
			if (!remaining.trim() || remaining === text) this.editor.setText(draft);
		};
		this.editor.setText(text);
		void Promise.resolve(this.defaultEditor.onSubmit?.(text)).then(restoreDraft, (error: unknown) => {
			restoreDraft();
			this.showError(error instanceof Error ? error.message : String(error));
		});
	}

	/**
	 * Quit confirmation (Ctrl+Q). Ctrl+D keeps its immediate exit; this chord asks
	 * first, so a stray press cannot end a session mid-task.
	 */
	private showQuitConfirm(): void {
		let handle: OverlayHandle | undefined;
		const hide = () => handle?.hide();
		const overlay = new QuitConfirmComponent(() => {
			hide();
			void this.shutdown();
		}, hide);
		handle = this.ui.showOverlay(overlay, { anchor: "center", width: QUIT_CONFIRM_WIDTH, margin: 1 });
	}

	private showSettingsSelector(): void {
		this.showSettingsPanelOverlay((done) => {
			let selector: SettingsSelectorComponent | undefined;
			const defaultProvider = this.settingsManager.getDefaultProvider();
			const defaultModelId = this.settingsManager.getDefaultModel();
			const defaultModel = defaultProvider && defaultModelId ? `${defaultProvider}/${defaultModelId}` : "not set";
			selector = new SettingsSelectorComponent(
				{
					autoCompact: this.session.autoCompactionEnabled,
					defaultModel,
					currentModel: this.session.model,
					availableDefaultModels: this.session.modelRuntime.getAvailableSnapshot(),
					showImages: this.settingsManager.getShowImages(),
					imageWidthCells: this.settingsManager.getImageWidthCells(),
					autoResizeImages: this.settingsManager.getImageAutoResize(),
					blockImages: this.settingsManager.getBlockImages(),
					enableSkillCommands: this.settingsManager.getEnableSkillCommands(),
					steeringMode: this.session.steeringMode,
					followUpMode: this.session.followUpMode,
					transport: this.settingsManager.getTransport(),
					httpIdleTimeoutMs: this.settingsManager.getHttpIdleTimeoutMs(),
					cacheWarmingMode: this.settingsManager.getCacheWarmingMode(),
					thinkingLevel: this.settingsManager.getDefaultThinkingLevel() ?? DEFAULT_THINKING_LEVEL,
					availableThinkingLevels: [...THINKING_LEVEL_OPTIONS],
					modelThinkingLevels: this.settingsManager.getAllModelThinkingLevels(),
					currentTheme: this.themeController.getThemeSelection() || "dark",
					terminalTheme: this.themeController.getTerminalTheme(),
					availableThemes: getAvailableThemes(),
					hideThinkingBlock: this.hideThinkingBlock,
					mermaidRenderingMode: this.settingsManager.getMermaidRenderingMode(),
					collapseChangelog: this.settingsManager.getCollapseChangelog(),
					enableInstallTelemetry: this.settingsManager.getEnableInstallTelemetry(),
					doubleEscapeAction: this.settingsManager.getDoubleEscapeAction(),
					treeFilterMode: this.settingsManager.getTreeFilterMode(),
					showHardwareCursor: this.settingsManager.getShowHardwareCursor(),
					showCacheMissNotices: this.settingsManager.getShowCacheMissNotices(),
					defaultProjectTrust: this.settingsManager.getDefaultProjectTrust(),
					editorPaddingX: this.settingsManager.getEditorPaddingX(),
					outputPad: this.settingsManager.getOutputPad(),
					autocompleteMaxVisible: this.settingsManager.getAutocompleteMaxVisible(),
					quietStartup: this.settingsManager.getQuietStartup(),
					clearOnShrink: this.settingsManager.getClearOnShrink(),
					showTerminalProgress: this.settingsManager.getShowTerminalProgress(),
					tuiMode: this.ui.mode,
					fullscreenExitOutput: this.settingsManager.getFullscreenExitOutput(),
					fullscreenScrollbar: this.settingsManager.getFullscreenScrollbar(),
					fullscreenCopyOnSelect: this.settingsManager.getFullscreenCopyOnSelect(),
					warnings: this.settingsManager.getWarnings(),
					inlineWidgets: this.mixcodeSettings.ui.inlineWidgets,
					boxedHiddenThinking: this.mixcodeSettings.ui.boxedHiddenThinking,
					iconMode: this.mixcodeSettings.ui.icons.mode,
					showResponseModelNotices: this.mixcodeSettings.ui.showResponseModelNotices,
				},
				{
					onAutoCompactChange: (enabled) => {
						this.session.setAutoCompactionEnabled(enabled);
						this.footer.setAutoCompactEnabled(enabled);
					},
					onShowImagesChange: (enabled) => {
						this.settingsManager.setShowImages(enabled);
						for (const child of this.chatContainer.children) {
							if (child instanceof ToolExecutionComponent) {
								child.setShowImages(enabled);
							}
						}
						this.windowedTranscript?.resetMeasurements();
					},
					onImageWidthCellsChange: (width) => {
						this.settingsManager.setImageWidthCells(width);
						for (const child of this.chatContainer.children) {
							if (child instanceof ToolExecutionComponent) {
								child.setImageWidthCells(width);
							}
						}
						this.windowedTranscript?.resetMeasurements();
					},
					onAutoResizeImagesChange: (enabled) => {
						this.settingsManager.setImageAutoResize(enabled);
					},
					onBlockImagesChange: (blocked) => {
						this.settingsManager.setBlockImages(blocked);
					},
					onEnableSkillCommandsChange: (enabled) => {
						this.settingsManager.setEnableSkillCommands(enabled);
						this.setupAutocompleteProvider();
					},
					onSteeringModeChange: (mode) => {
						this.session.setSteeringMode(mode);
					},
					onFollowUpModeChange: (mode) => {
						this.session.setFollowUpMode(mode);
					},
					onTransportChange: (transport) => {
						this.settingsManager.setTransport(transport);
						this.session.agent.transport = transport;
					},
					onHttpIdleTimeoutMsChange: (timeoutMs) => {
						this.settingsManager.setHttpIdleTimeoutMs(timeoutMs);
						configureHttpDispatcher(timeoutMs);
						this.showStatus(`HTTP idle timeout: ${formatHttpIdleTimeoutMs(timeoutMs)}`);
					},
					onCacheWarmingModeChange: (mode) => {
						this.session.setCacheWarmingMode(mode);
						this.showStatus(`Cache warming: ${mode}`);
					},
					onModelThinkingLevelChange: (provider, modelId, level) => {
						this.settingsManager.setModelThinkingLevel(provider, modelId, level);
						// If the override is for the current model, apply it to the session too
						const current = this.session.model;
						if (current && current.provider === provider && current.id === modelId) {
							this.session.setThinkingLevel(level);
							this.footer.invalidate();
							this.updateEditorBorderColor();
						}
					},
					onModelThinkingLevelRemove: (provider, modelId) => {
						this.settingsManager.removeModelThinkingLevel(provider, modelId);
						// If the override was for the current model, revert to global default
						const current = this.session.model;
						if (current && current.provider === provider && current.id === modelId) {
							const globalDefault = this.settingsManager.getDefaultThinkingLevel() ?? DEFAULT_THINKING_LEVEL;
							this.session.setThinkingLevel(globalDefault);
							this.footer.invalidate();
							this.updateEditorBorderColor();
						}
					},
					onThemeChange: (themeSetting) => {
						this.settingsManager.setTheme(themeSetting);
						void this.themeController.setThemeSetting(themeSetting);
					},
					onThemePreview: (themeName) => this.themeController.preview(themeName),
					onHideThinkingBlockChange: (hidden) => {
						this.hideThinkingBlock = hidden;
						this.settingsManager.setHideThinkingBlock(hidden);
						this.updateThinkingBlockVisibility();
					},
					onMermaidRenderingModeChange: (mode) => {
						this.settingsManager.setMermaidRenderingMode(mode);
						this.chatContainer.invalidate();
						this.windowedTranscript?.resetMeasurements();
						this.ui.requestRender();
					},
					onShowCacheMissNoticesChange: (shown) => {
						applyCacheMissNoticeSetting(this.settingsManager, this.tabManager?.list() ?? [], shown);
						// Parked transcripts were built under the old setting.
						this.tabTranscript.clear();
						this.rebuildChatFromMessages();
					},
					onCollapseChangelogChange: (collapsed) => {
						this.settingsManager.setCollapseChangelog(collapsed);
					},
					onEnableInstallTelemetryChange: (enabled) => {
						this.settingsManager.setEnableInstallTelemetry(enabled);
					},
					onQuietStartupChange: (enabled) => {
						this.settingsManager.setQuietStartup(enabled);
					},
					onDefaultProjectTrustChange: (defaultProjectTrust) => {
						this.settingsManager.setDefaultProjectTrust(defaultProjectTrust);
					},
					onDoubleEscapeActionChange: (action) => {
						this.settingsManager.setDoubleEscapeAction(action);
					},
					onTreeFilterModeChange: (mode) => {
						this.settingsManager.setTreeFilterMode(mode);
					},
					onShowHardwareCursorChange: (enabled) => {
						this.settingsManager.setShowHardwareCursor(enabled);
						this.ui.setShowHardwareCursor(enabled);
					},
					onEditorPaddingXChange: (padding) => {
						this.settingsManager.setEditorPaddingX(padding);
						this.defaultEditor.setPaddingX(padding);
						if (this.editor !== this.defaultEditor && this.editor.setPaddingX !== undefined) {
							this.editor.setPaddingX(padding);
						}
					},
					onOutputPadChange: (padding) => {
						this.settingsManager.setOutputPad(padding);
						this.outputPad = padding;
						if (this.streamingComponent || this.session.isStreaming) {
							for (const child of this.chatContainer.children) {
								if (
									child instanceof AssistantMessageComponent ||
									child instanceof CustomMessageComponent ||
									child instanceof UserMessageComponent
								) {
									child.setOutputPad(padding);
								}
							}
							if (this.streamingComponent) {
								this.streamingComponent.setOutputPad(padding);
							}
							this.ui.requestRender();
							return;
						}
						this.rebuildChatFromMessages();
					},
					onAutocompleteMaxVisibleChange: (maxVisible) => {
						this.settingsManager.setAutocompleteMaxVisible(maxVisible);
						this.defaultEditor.setAutocompleteMaxVisible(maxVisible);
						if (this.editor !== this.defaultEditor && this.editor.setAutocompleteMaxVisible !== undefined) {
							this.editor.setAutocompleteMaxVisible(maxVisible);
						}
					},
					onClearOnShrinkChange: (enabled) => {
						this.settingsManager.setClearOnShrink(enabled);
						this.ui.setClearOnShrink(enabled);
						if (!enabled && !this.activeStatusIndicator) {
							this.statusContainer.clear();
						}
					},
					onShowTerminalProgressChange: (enabled) => {
						this.settingsManager.setShowTerminalProgress(enabled);
					},
					onTuiModeChange: (mode) => {
						// The panel is an overlay, and a mode switch refuses while one is open:
						// take the panel down first, then switch.
						done();
						if (!this.switchTuiMode(mode)) {
							selector?.getSettingsList().updateValue("tui-mode", this.ui.mode);
							this.showStatus("Close active overlays before changing TUI mode");
							return;
						}
						this.settingsManager.setTuiMode(mode);
						if (!this.activeStatusIndicator) this.statusContainer.clear();
						this.showStatus(`TUI mode: ${mode}`);
					},
					onFullscreenExitOutputChange: (output) => {
						this.settingsManager.setFullscreenExitOutput(output);
					},
					onFullscreenScrollbarChange: (mode) => {
						this.settingsManager.setFullscreenScrollbar(mode);
						this.applyFullscreenScrollbarSetting();
					},
					onFullscreenCopyOnSelectChange: (enabled) => {
						this.settingsManager.setFullscreenCopyOnSelect(enabled);
						if (this.renderer instanceof TuiAltScreen) this.renderer.setCopyOnSelect(enabled);
					},
					onWarningsChange: (warnings) => {
						this.settingsManager.setWarnings(warnings);
					},
					onInlineWidgetsChange: (enabled) => {
						this.setInlineWidgetsGlobal(enabled);
					},
					onBoxedHiddenThinkingChange: (enabled) => {
						this.setBoxedHiddenThinkingGlobal(enabled);
					},
					onIconModeChange: (mode) => {
						this.setIconModeGlobal(mode);
					},
					onShowResponseModelNoticesChange: (enabled) => {
						this.setShowResponseModelNoticesGlobal(enabled);
					},
					onCancel: () => {
						done();
						this.ui.requestRender();
					},
					onSettingsChanged: () => this.broadcastSettingsChange(),
				},
			);
			return selector.getSettingsList();
		});
	}

	/**
	 * Put every open tab on a `/settings` change made in one of them. Parked
	 * transcripts were rendered under the old values, so they are dropped and
	 * rebuilt on the next visit.
	 */
	private broadcastSettingsChange(): void {
		const tabs = this.tabManager?.list() ?? [];
		if (tabs.length === 0) return;
		this.tabTranscript.clear();
		void reloadSettingsAcrossTabs(this.settingsManager, tabs);
	}

	/**
	 * Show the `/settings` panel as the centred floating overlay the MixCode panels
	 * use, so the transcript and the draft stay visible behind it. `create` receives
	 * the function that takes the overlay down.
	 */
	private showSettingsPanelOverlay(create: (done: () => void) => Component): void {
		let handle: OverlayHandle | undefined;
		const done = () => {
			handle?.hide();
			this.ui.requestRender();
		};
		const component = create(done);
		handle = this.ui.showOverlay(component, {
			anchor: "center",
			width: `${SETTINGS_PANEL_WIDTH_PERCENT}%`,
			maxHeight: `${SETTINGS_PANEL_HEIGHT_PERCENT}%`,
			margin: 1,
		});
	}

	private handleThinkingCommand(searchTerm?: string): void {
		const availableLevels = this.session.getAvailableThinkingLevels();
		if (!searchTerm) {
			this.showThinkingSelector();
			return;
		}

		const normalized = searchTerm.trim().toLowerCase();
		const level = availableLevels.find((candidate) => candidate.toLowerCase() === normalized);
		if (!level) {
			this.showError(`Unknown thinking level "${searchTerm}". Available levels: ${availableLevels.join(", ")}.`);
			return;
		}

		this.selectThinkingLevel(level, false);
	}

	/** `/context-limit [tokens|reset]`: apply directly, or open the picker with no argument. */
	private handleContextLimitCommand(args: string): void {
		if (args === "") {
			this.showContextLimitSelector();
			return;
		}
		const value = parseContextLimitValue(args);
		if (value === undefined) {
			this.showError(`Invalid context limit: "${args}". Use a number (e.g. 32k, 40000) or "reset".`);
			return;
		}
		this.applyContextLimit(value);
	}

	/**
	 * Apply a limit to the tab the tab manager has focused. On the Home surface
	 * that is the last focused agent tab, the same target `/color` and `/rename`
	 * use there.
	 */
	private applyContextLimit(value: ContextLimitValue): void {
		const tab = this.activeTab();
		if (!tab) {
			this.showWarning("Context limit needs an agent tab; return to an agent first.");
			return;
		}
		try {
			const toast = applyContextLimitToSession(tab, value, tab.runtime.session);
			this.notifyToast(toast.type, toast.message);
			this.footer.invalidate();
			this.ui.requestRender();
		} catch (error) {
			this.showError(error instanceof Error ? error.message : String(error));
		}
	}

	/** The picker's fractions are taken from the tab's own model, not the current limit. */
	private showContextLimitSelector(): void {
		const tab = this.activeTab();
		if (!tab) {
			this.showWarning("Context limit needs an agent tab; return to an agent first.");
			return;
		}
		const modelWindow = baseContextWindow(tab, tab.runtime.session);
		if (modelWindow <= 0) {
			this.showWarning("Context limit needs a model in this tab; pick one with /model first.");
			return;
		}
		this.showSelector((done) => {
			const selector = new ContextLimitSelectorComponent(
				modelWindow,
				(value) => {
					done();
					this.applyContextLimit(value);
				},
				() => {
					done();
					this.ui.requestRender();
				},
			);
			return { component: selector, focus: selector };
		});
	}

	/**
	 * A `/context-limit` override belongs to the model it was set on, so a model
	 * change drops it and gives the compaction budgets back their baseline. A
	 * reload resolves the session model again and counts as one.
	 */
	private dropContextLimitOverride(): void {
		const tab = this.activeTab();
		if (!tab) return;
		clearContextLimitOverride(tab, tab.runtime.session);
	}

	/**
	 * The tab every multi-tab command acts on, without the throw an empty tab
	 * manager would raise mid-teardown.
	 */
	private activeTab(): AgentTab | undefined {
		return this.tabManager?.activeTab();
	}

	private selectThinkingLevel(level: ThinkingLevel, persist: boolean): void {
		try {
			this.session.setThinkingLevel(level, { persist });
			this.footer.invalidate();
			this.updateEditorBorderColor();
			this.showStatus(persist ? `Default thinking level: ${level}` : `Thinking level: ${level}`);
		} catch (error) {
			this.showError(error instanceof Error ? error.message : String(error));
		}
	}

	private showThinkingSelector(): void {
		this.showSelector((done) => {
			const selectLevel = (level: ThinkingLevel, persist: boolean) => {
				this.selectThinkingLevel(level, persist);
				done();
			};
			const selector = new ThinkingSelectorComponent(
				this.session.thinkingLevel ?? DEFAULT_THINKING_LEVEL,
				this.session.getAvailableThinkingLevels(),
				(level) => selectLevel(level, false),
				() => {
					done();
					this.ui.requestRender();
				},
				(level) => selectLevel(level, true),
				this.settingsManager.getDefaultThinkingLevel() ?? DEFAULT_THINKING_LEVEL,
			);
			return { component: selector, focus: selector };
		});
	}

	private async handleModelCommand(searchTerm?: string): Promise<void> {
		if (!searchTerm) {
			this.showModelSelector();
			return;
		}

		const model = await this.findExactModelMatch(searchTerm);
		if (model) {
			try {
				await this.session.setModel(model, { persist: false });
				this.dropContextLimitOverride();
				this.footer.invalidate();
				this.updateEditorBorderColor();
				this.showStatus(`Model: ${model.id}`);
				void this.maybeWarnAboutAnthropicSubscriptionAuth(model);
				this.checkDaxnutsEasterEgg(model);
			} catch (error) {
				this.showError(error instanceof Error ? error.message : String(error));
			}
			return;
		}

		this.showModelSelector(searchTerm);
	}

	private async findExactModelMatch(searchTerm: string): Promise<Model<any> | undefined> {
		const cachedModels =
			this.session.scopedModels.length > 0
				? this.session.scopedModels.map((scoped) => scoped.model)
				: [...this.session.modelRuntime.getAvailableSnapshot()];
		const cachedMatch = findExactModelReferenceMatch(searchTerm, cachedModels);
		if (cachedMatch || this.session.scopedModels.length > 0) return cachedMatch;

		this.showStatus("Refreshing model catalogs…");
		const controller = new AbortController();
		let timedOut = false;
		const timeout = setTimeout(() => {
			timedOut = true;
			controller.abort();
		}, 15_000);
		try {
			const result = await refreshModelCatalogs(this.session.modelRuntime, controller.signal);
			if (result.aborted && timedOut) {
				this.showWarning("Model refresh timed out; searching cached models.");
			} else if (result.errors.size > 0) {
				this.showWarning(`Could not refresh ${[...result.errors.keys()].join(", ")}; searching cached models.`);
			}
		} catch (error) {
			this.showWarning(
				timedOut
					? "Model refresh timed out; searching cached models."
					: `Could not refresh model catalogs: ${error instanceof Error ? error.message : String(error)}`,
			);
		} finally {
			clearTimeout(timeout);
		}
		return findExactModelReferenceMatch(searchTerm, [...this.session.modelRuntime.getAvailableSnapshot()]);
	}

	/** Update the footer's available provider count from the current snapshot without refreshing catalogs. */
	private updateAvailableProviderCount(): void {
		const models =
			this.session.scopedModels.length > 0
				? this.session.scopedModels.map((scoped) => scoped.model)
				: this.session.modelRuntime.getAvailableSnapshot();
		const uniqueProviders = new Set(models.map((model) => model.provider));
		this.footerDataProvider.setAvailableProviderCount(uniqueProviders.size);
	}

	private async maybeWarnAboutAnthropicSubscriptionAuth(
		model: Model<any> | undefined = this.session.model,
	): Promise<void> {
		if (this.settingsManager.getWarnings().anthropicExtraUsage === false) {
			return;
		}
		if (this.anthropicSubscriptionWarningShown) {
			return;
		}
		if (!model || model.provider !== "anthropic") {
			return;
		}

		try {
			if ((await this.session.modelRuntime.checkAuth("anthropic"))?.type === "oauth") {
				this.anthropicSubscriptionWarningShown = true;
				this.showWarning(ANTHROPIC_SUBSCRIPTION_AUTH_WARNING);
				return;
			}
			const apiKey = (await this.session.modelRuntime.getAuth(model.provider))?.auth.apiKey;
			if (!isAnthropicSubscriptionAuthKey(apiKey)) {
				return;
			}
			this.anthropicSubscriptionWarningShown = true;
			this.showWarning(ANTHROPIC_SUBSCRIPTION_AUTH_WARNING);
		} catch {
			// Ignore auth lookup failures for warning-only checks.
		}
	}

	private maybeSaveImplicitProjectTrustAfterReload(): boolean {
		const cwd = this.sessionManager.getCwd();
		if (this.autoTrustOnReloadCwd !== cwd) {
			return false;
		}
		if (!this.settingsManager.isProjectTrusted() || !hasTrustRequiringProjectResources(cwd)) {
			return false;
		}

		const trustStore = new ProjectTrustStore(this.runtimeHost.services.agentDir);
		try {
			if (trustStore.get(cwd) !== null) {
				this.autoTrustOnReloadCwd = undefined;
				return false;
			}
			trustStore.set(cwd, true);
			this.autoTrustOnReloadCwd = undefined;
			return true;
		} catch (error) {
			this.showWarning(
				`Could not save project trust after reload: ${error instanceof Error ? error.message : String(error)}`,
			);
			return false;
		}
	}

	private showTrustSelector(): void {
		const cwd = this.sessionManager.getCwd();
		const trustStore = new ProjectTrustStore(this.runtimeHost.services.agentDir);
		const savedDecision = trustStore.getEntry(cwd);
		this.showSelector((done) => {
			const selector = new TrustSelectorComponent({
				cwd,
				savedDecision,
				projectTrusted: this.settingsManager.isProjectTrusted(),
				onSelect: (selection) => {
					trustStore.setMany(selection.updates);
					done();
					this.showStatus(
						`Saved trust decision: ${selection.trusted ? "trusted" : "untrusted"}. Restart ${APP_NAME} for this to take effect.`,
					);
				},
				onCancel: () => {
					done();
					this.ui.requestRender();
				},
			});
			return { component: selector, focus: selector };
		});
	}

	private showModelSelector(initialSearchInput?: string): void {
		this.showSelector((done) => {
			const selectModel = async (model: Model<any>, persist: boolean) => {
				try {
					await this.session.setModel(model, { persist });
					this.dropContextLimitOverride();
					this.updateAvailableProviderCount();
					this.footer.invalidate();
					this.updateEditorBorderColor();
					done();
					this.showStatus(persist ? `Default model: ${model.provider}/${model.id}` : `Model: ${model.id}`);
					void this.maybeWarnAboutAnthropicSubscriptionAuth(model);
					this.checkDaxnutsEasterEgg(model);
				} catch (error) {
					done();
					this.showError(error instanceof Error ? error.message : String(error));
				}
			};
			const defaultProvider = this.settingsManager.getDefaultProvider();
			const defaultModel = this.settingsManager.getDefaultModel();
			const selector = new ModelSelectorComponent(
				this.ui,
				this.session.model,
				this.session.modelRuntime,
				this.session.scopedModels,
				(model) => selectModel(model, false),
				() => {
					done();
					this.ui.requestRender();
				},
				initialSearchInput,
				(model) => selectModel(model, true),
				defaultProvider && defaultModel ? { provider: defaultProvider, id: defaultModel } : undefined,
			);
			return { component: selector, focus: selector, dispose: () => selector.dispose() };
		});
	}

	private showModelsSelector(): void {
		let availableModels = [...this.session.modelRuntime.getAvailableSnapshot()];
		let availableModelIds = new Set(availableModels.map((model) => `${model.provider}/${model.id}`));
		const configuredPatterns = this.settingsManager.getEnabledModels();
		const sessionScopedModels = this.session.scopedModels;
		const configuredEnabledIds = (models: readonly Model<any>[]): string[] | null => {
			if (!configuredPatterns?.length) return null;
			const resolved = resolveModelScopeFromModels(configuredPatterns, models);
			const ids = resolved.scopedModels.map((scoped) => `${scoped.model.provider}/${scoped.model.id}`);
			for (const diagnostic of resolved.diagnostics) {
				if (diagnostic.code === "no-match" && !ids.includes(diagnostic.pattern)) ids.push(diagnostic.pattern);
			}
			return ids;
		};

		let currentEnabledIds =
			sessionScopedModels.length > 0
				? sessionScopedModels.map((scoped) => `${scoped.model.provider}/${scoped.model.id}`)
				: configuredEnabledIds(availableModels);
		let selectionChanged = false;

		const updateSessionModels = (enabledIds: string[] | null): void => {
			currentEnabledIds = enabledIds === null ? null : [...enabledIds];
			const hasEnabledAvailableModel = enabledIds?.some((id) => availableModelIds.has(id)) ?? false;
			const allAvailableModelsEnabled =
				enabledIds !== null && [...availableModelIds].every((id) => enabledIds.includes(id));
			if (enabledIds && hasEnabledAvailableModel && !allAvailableModelsEnabled) {
				const newScopedModels = resolveModelScopeFromModels(enabledIds, availableModels).scopedModels;
				this.session.setScopedModels(
					newScopedModels.map((scoped) => ({
						model: scoped.model,
						thinkingLevel: scoped.thinkingLevel,
					})),
				);
			} else {
				this.session.setScopedModels([]);
			}
			this.updateAvailableProviderCount();
			this.ui.requestRender();
		};

		this.showSelector((done) => {
			let disposed = false;
			let timedOut = false;
			const controller = new AbortController();
			const timeout = setTimeout(() => {
				timedOut = true;
				controller.abort();
			}, 15_000);
			const selector = new ScopedModelsSelectorComponent(
				{
					allModels: availableModels,
					enabledModelIds: currentEnabledIds,
					refreshStatus: "Refreshing model catalogs…",
				},
				{
					onChange: (enabledIds) => {
						selectionChanged = true;
						updateSessionModels(enabledIds);
					},
					onPersist: (enabledIds) => {
						const allEnabled =
							enabledIds !== null &&
							enabledIds.length === availableModels.length &&
							enabledIds.every((id) => availableModelIds.has(id));
						const newPatterns = enabledIds === null || allEnabled ? undefined : enabledIds;
						this.settingsManager.setEnabledModels(newPatterns ? [...newPatterns] : undefined);
						this.showStatus("Model selection saved to settings");
					},
					onCancel: () => {
						done();
						this.ui.requestRender();
					},
				},
			);
			void refreshModelCatalogs(this.session.modelRuntime, controller.signal)
				.then((result) => {
					if (disposed) return;
					availableModels = [...this.session.modelRuntime.getAvailableSnapshot()];
					availableModelIds = new Set(availableModels.map((model) => `${model.provider}/${model.id}`));
					if (!selectionChanged && sessionScopedModels.length === 0) {
						currentEnabledIds = configuredEnabledIds(availableModels);
						selector.updateModels(availableModels, currentEnabledIds);
					} else {
						selector.updateModels(availableModels);
					}
					if (currentEnabledIds !== null) updateSessionModels(currentEnabledIds);
					if (result.aborted && timedOut) {
						selector.setRefreshStatus("Model refresh timed out; showing cached models.", "warning");
					} else if (result.errors.size > 0) {
						selector.setRefreshStatus(
							`Could not refresh ${[...result.errors.keys()].join(", ")}; showing cached models.`,
							"warning",
						);
					} else {
						selector.setRefreshStatus("Model catalogs refreshed.", "success");
					}
					this.ui.requestRender();
				})
				.catch((error: unknown) => {
					if (disposed) return;
					selector.setRefreshStatus(
						timedOut
							? "Model refresh timed out; showing cached models."
							: `Could not refresh model catalogs: ${error instanceof Error ? error.message : String(error)}`,
						"warning",
					);
					this.ui.requestRender();
				})
				.finally(() => clearTimeout(timeout));
			return {
				component: selector,
				focus: selector,
				dispose: () => {
					disposed = true;
					clearTimeout(timeout);
					controller.abort();
				},
			};
		});
	}

	private showUserMessageSelector(): void {
		const userMessages = this.session.getUserMessagesForForking();

		if (userMessages.length === 0) {
			this.showStatus("No messages to fork from");
			return;
		}

		const initialSelectedId = userMessages[userMessages.length - 1]?.entryId;
		const sourceTab = this.tabManager?.getActive();

		this.showSelector((done) => {
			const selector = new UserMessageSelectorComponent(
				userMessages.map((m) => ({ id: m.entryId, text: m.text })),
				async (entryId) => {
					done();
					try {
						if (this.tabManager && sourceTab) {
							this.tabManager.setDraft(sourceTab.id, this.editorText());
							const result = await this.tabManager.forkTab(sourceTab.id, entryId);
							const tab = result.tab;
							if (tab) {
								await this.enqueueTabSwitch(() => this.switchActiveTab(tab));
								this.showStatus("Forked to new tab");
							}
							this.ui.requestRender();
							return;
						}
						const result = await this.runtimeHost.fork(entryId);
						if (result.cancelled) {
							this.ui.requestRender();
							return;
						}

						this.editor.setText(result.selectedText ?? "");
						this.showStatus("Forked to new session");
					} catch (error: unknown) {
						this.showError(error instanceof Error ? error.message : String(error));
					}
				},
				() => {
					done();
					this.ui.requestRender();
				},
				initialSelectedId,
			);
			return { component: selector, focus: selector.getMessageList() };
		});
	}

	private async handleCloneCommand(): Promise<void> {
		const leafId = this.sessionManager.getLeafId();
		if (!leafId) {
			this.showStatus("Nothing to clone yet");
			return;
		}

		// With tabs, a clone is a sibling tab: the source keeps its session and stays open.
		const sourceTab = this.tabManager?.getActive();
		if (this.tabManager && sourceTab) {
			try {
				const result = await this.tabManager.cloneTab(sourceTab.id);
				const tab = result.tab;
				if (tab) {
					await this.enqueueTabSwitch(() => this.switchActiveTab(tab));
					this.showStatus("Cloned to new tab");
				}
				this.ui.requestRender();
			} catch (error: unknown) {
				this.showError(error instanceof Error ? error.message : String(error));
			}
			return;
		}

		try {
			const result = await this.runtimeHost.fork(leafId, { position: "at" });
			if (result.cancelled) {
				this.ui.requestRender();
				return;
			}

			this.editor.setText("");
			this.showStatus("Cloned to new session");
		} catch (error: unknown) {
			this.showError(error instanceof Error ? error.message : String(error));
		}
	}

	private showTreeSelector(initialSelectedId?: string): void {
		const tree = this.sessionManager.getTree();
		const realLeafId = this.sessionManager.getLeafId();
		const initialFilterMode = this.settingsManager.getTreeFilterMode();

		if (tree.length === 0) {
			this.showStatus("No entries in session");
			return;
		}

		this.showSelector((done) => {
			const selector = new TreeSelectorComponent(
				tree,
				realLeafId,
				this.ui.terminal.rows,
				async (entryId) => {
					// Selecting the current leaf is a no-op (already there)
					if (entryId === this.sessionManager.getLeafId()) {
						done();
						this.showStatus("Already at this point");
						return;
					}

					// Ask about summarization
					done(); // Close selector first

					// Loop until user makes a complete choice or cancels to tree
					let wantsSummary = false;
					let customInstructions: string | undefined;

					// Check if we should skip the prompt (user preference to always default to no summary)
					if (!this.settingsManager.getBranchSummarySkipPrompt()) {
						while (true) {
							const summaryChoice = await this.showExtensionSelector("Summarize branch?", [
								"No summary",
								"Summarize",
								"Summarize with custom prompt",
							]);

							if (summaryChoice === undefined) {
								// User pressed escape - re-show tree selector with same selection
								this.showTreeSelector(entryId);
								return;
							}

							wantsSummary = summaryChoice !== "No summary";

							if (summaryChoice === "Summarize with custom prompt") {
								customInstructions = await this.showExtensionEditor("Custom summarization instructions");
								if (customInstructions === undefined) {
									// User cancelled - loop back to summary selector
									continue;
								}
							}

							// User made a complete choice
							break;
						}
					}

					// The user committed to navigating: stop the active response first.
					if (this.session.isStreaming) {
						this.restoreQueuedMessagesToEditor();
						await this.session.abort();
					}

					// Recheck after the dialogs and streaming abort, before replacing another operation's UI.
					if (this.session.isCompacting) {
						this.showError(
							"Wait for the current compaction or tree navigation to finish before navigating the session tree.",
						);
						return;
					}

					// Set up escape handler and status indicator if summarizing
					let showingSummaryIndicator = false;
					const originalOnEscape = this.defaultEditor.onEscape;

					if (wantsSummary) {
						this.defaultEditor.onEscape = () => {
							this.session.abortBranchSummary();
						};
						this.chatContainer.addChild(new Spacer(1));
						this.showStatusIndicator(new BranchSummaryStatusIndicator(this.ui));
						showingSummaryIndicator = true;
						this.ui.requestRender();
					}

					try {
						const result = await this.session.navigateTree(entryId, {
							summarize: wantsSummary,
							customInstructions,
						});

						if (result.aborted) {
							// Summarization aborted - re-show tree selector with same selection
							this.showStatus("Branch summarization cancelled");
							this.showTreeSelector(entryId);
							return;
						}
						if (result.cancelled) {
							this.showStatus("Navigation cancelled");
							return;
						}

						// Update UI
						this.chatContainer.clear();
						this.renderInitialMessages();
						if (result.editorText && !this.editor.getText().trim()) {
							this.editor.setText(result.editorText);
						}
						this.showStatus("Navigated to selected point");
						void this.flushCompactionQueue({ willRetry: false });
					} catch (error) {
						this.showError(error instanceof Error ? error.message : String(error));
					} finally {
						if (showingSummaryIndicator) {
							this.clearStatusIndicator("branchSummary");
						}
						this.defaultEditor.onEscape = originalOnEscape;
					}
				},
				() => {
					done();
					this.ui.requestRender();
				},
				(entryId, label) => {
					this.sessionManager.appendLabelChange(entryId, label);
					this.ui.requestRender();
				},
				initialSelectedId,
				initialFilterMode,
			);
			selector.onCopy = async (text) => {
				if (!text) {
					this.showError("Selected entry has no text to copy");
					return;
				}
				try {
					await copyToClipboard(text);
					this.notifyToast("success", copyConfirmation(countGraphemes(text)));
				} catch (error) {
					const message = error instanceof Error ? error.message : String(error);
					this.showError(message);
					this.notifyToast("error", copyFailure(message));
				}
			};
			return { component: selector, focus: selector };
		});
	}

	private showSessionSelector(): void {
		this.showSelector((done) => {
			const selector = new SessionSelectorComponent(
				(onProgress, signal) =>
					SessionManager.list(
						this.sessionManager.getCwd(),
						this.sessionManager.getSessionDir(),
						onProgress,
						signal,
					),
				(onProgress, signal) =>
					this.sessionManager.usesDefaultSessionDir()
						? SessionManager.listAll(onProgress, signal)
						: SessionManager.listAll(this.sessionManager.getSessionDir(), onProgress, signal),
				async (sessionPath) => {
					done();
					await this.handleResumeIntoTab(sessionPath);
				},
				() => {
					done();
					this.ui.requestRender();
				},
				() => {
					void this.shutdown();
				},
				() => this.ui.requestRender(),
				{
					renameSession: async (sessionFilePath: string, nextName: string | undefined) => {
						const next = (nextName ?? "").trim();
						if (!next) return;
						const mgr = SessionManager.open(sessionFilePath);
						mgr.appendSessionInfo(next);
					},
					showRenameHint: true,
					keybindings: this.keybindings,
				},

				this.sessionManager.getSessionFile(),
			);
			// A session file that another tab is still writing must not be deleted
			// from the selector either.
			selector.setSessionDeleteGuard((sessionPath: string) => {
				const tab = this.tabManager?.list().find((item) => item.runtime.session.sessionFile === sessionPath);
				const reason = tab ? tabBusyReason(tab) : undefined;
				return reason ? `Cannot delete a session while ${reason}` : undefined;
			});
			return { component: selector, focus: selector };
		});
	}

	/**
	 * `/resume-trash`: the session selector over the trash dir. Picking an entry
	 * restores its file to the original path before the runtime opens it; a
	 * `.jsonl` dropped into the trash by hand opens in place.
	 */
	private showTrashSelector(): void {
		const trashRoot = trashDir();
		this.showSelector((done) => {
			const selector = new SessionSelectorComponent(
				(onProgress, signal) => SessionManager.list(this.sessionManager.getCwd(), trashRoot, onProgress, signal),
				(onProgress, signal) => SessionManager.listAll(trashRoot, onProgress, signal),
				async (trashPath) => {
					done();
					await this.handleResumeIntoTab(await this.restoreTrashedSession(trashPath));
				},
				() => {
					done();
					this.ui.requestRender();
				},
				() => {
					void this.shutdown();
				},
				() => this.ui.requestRender(),
				{
					renameSession: async (sessionFilePath: string, nextName: string | undefined) => {
						const next = (nextName ?? "").trim();
						if (!next) return;
						SessionManager.open(sessionFilePath).appendSessionInfo(next);
					},
					showRenameHint: true,
					keybindings: this.keybindings,
				},
				this.sessionManager.getSessionFile(),
			);
			// A trash file can be the open session of a tab (an unindexed file opens in
			// place), so refuse a delete for a session any tab holds, not only a busy one.
			selector.setSessionDeleteGuard((sessionPath: string) => {
				const tab = this.tabManager?.list().find((item) => item.runtime.session.sessionFile === sessionPath);
				return tab ? `Cannot delete a session open in tab: ${tab.title}` : undefined;
			});
			return { component: selector, focus: selector };
		});
	}

	/** Restore a trashed session and return the path to open. */
	private async restoreTrashedSession(trashPath: string): Promise<string> {
		const entry = (await listTrash()).find((item) => item.trashPath === trashPath);
		if (!entry) return trashPath;
		try {
			return restoreFromTrash(entry.sessionId).originalPath;
		} catch {
			return trashPath;
		}
	}

	/**
	 * `/resume` and `/resume-trash`: the picked session opens in a tab of its own,
	 * the way `/clone` and a restored workspace entry do, so the focused tab keeps
	 * its session. A host without a tab manager has no tab to open, and there the
	 * session replaces the current one as upstream does.
	 */
	private async handleResumeIntoTab(sessionPath: string): Promise<void> {
		if (!this.tabManager) {
			await this.handleResumeSession(sessionPath);
			return;
		}
		await handleResumeIntoTabImpl(this.resumeTabHost(), sessionPath);
	}

	private async handleResumeSession(
		sessionPath: string,
		options?: Parameters<ExtensionCommandContext["switchSession"]>[1],
	): Promise<{ cancelled: boolean }> {
		this.clearStatusIndicator();
		try {
			const result = await this.runtimeHost.switchSession(sessionPath, {
				withSession: options?.withSession,
				projectTrustContextFactory: (cwd) => this.createProjectTrustContext(cwd),
			});
			if (result.cancelled) {
				return result;
			}
			this.showStatus("Resumed session");
			return result;
		} catch (error: unknown) {
			if (error instanceof MissingSessionCwdError) {
				const selectedCwd = await this.promptForMissingSessionCwd(error);
				if (!selectedCwd) {
					this.showStatus("Resume cancelled");
					return { cancelled: true };
				}
				const result = await this.runtimeHost.switchSession(sessionPath, {
					cwdOverride: selectedCwd,
					withSession: options?.withSession,
					projectTrustContextFactory: (cwd) => this.createProjectTrustContext(cwd),
				});
				if (result.cancelled) {
					return result;
				}
				this.showStatus("Resumed session in current cwd");
				return result;
			}
			return this.handleFatalRuntimeError("Failed to resume session", error);
		}
	}

	private getLoginProviderOptions(authType?: "oauth" | "api_key"): AuthSelectorProvider[] {
		const options: AuthSelectorProvider[] = [];
		for (const provider of this.session.modelRuntime.getProviders()) {
			const authStatus = this.session.modelRuntime.getProviderAuthStatus(provider.id);
			const status = authStatus.configured
				? {
						type: this.session.modelRuntime.isUsingOAuth(provider.id) ? ("oauth" as const) : ("api_key" as const),
						source: authStatus.label ?? authStatus.source,
					}
				: undefined;
			if ((!authType || authType === "oauth") && provider.auth.oauth) {
				options.push({
					id: provider.id,
					name: provider.name,
					authType: "oauth",
					method: provider.auth.oauth,
					status,
				});
			}
			if ((!authType || authType === "api_key") && provider.auth.apiKey) {
				options.push({
					id: provider.id,
					name: provider.name,
					authType: "api_key",
					method: provider.auth.apiKey,
					status,
				});
			}
		}
		return options.sort((a, b) => a.name.localeCompare(b.name));
	}

	private async getLogoutProviderOptions(): Promise<AuthSelectorProvider[]> {
		return (await this.session.modelRuntime.listCredentials({ signal: AbortSignal.timeout(15_000) }))
			.map(({ providerId, type }) => ({
				id: providerId,
				name: this.session.modelRuntime.getProvider(providerId)?.name ?? providerId,
				authType: type,
				status: { type, source: "stored credential" },
			}))
			.sort((a, b) => a.name.localeCompare(b.name));
	}

	private findLoginProviderOptions(providerRef: string): AuthSelectorProvider[] {
		const normalizedProviderRef = providerRef.trim().toLowerCase();
		if (!normalizedProviderRef) {
			return [];
		}

		return this.getLoginProviderOptions().filter(
			(provider) =>
				provider.id.toLowerCase() === normalizedProviderRef ||
				provider.name.toLowerCase() === normalizedProviderRef,
		);
	}

	private async handleLoginCommand(providerRef?: string): Promise<void> {
		if (!providerRef) {
			this.showLoginAuthTypeSelector();
			return;
		}

		const providerOptions = this.findLoginProviderOptions(providerRef);
		if (providerOptions.length === 1) {
			await this.startProviderLogin(providerOptions[0]!);
			return;
		}

		if (providerOptions.length > 1) {
			const providerIds = new Set(providerOptions.map((provider) => provider.id));
			if (providerIds.size === 1) {
				this.showLoginAuthTypeSelector(providerOptions);
				return;
			}
		}

		this.showLoginProviderSelector(undefined, providerRef);
	}

	private async startProviderLogin(providerOption: AuthSelectorProvider): Promise<void> {
		if (providerOption.authType === "oauth") {
			await this.showLoginDialog(providerOption.id, providerOption.name);
		} else if (providerOption.method?.login) {
			await this.showApiKeyLoginDialog(providerOption.id, providerOption.name);
		} else {
			this.showAmbientAuthDialog(providerOption);
		}
	}

	private showLoginAuthTypeSelector(providerOptions?: AuthSelectorProvider[]): void {
		const oauthProvider = providerOptions?.find((provider) => provider.authType === "oauth");
		const oauthLoginLabel =
			oauthProvider?.method && "loginLabel" in oauthProvider.method ? oauthProvider.method.loginLabel : undefined;
		const subscriptionLabel = oauthLoginLabel ?? "Sign in with an account";
		const apiKeyLabel = "Sign in with an API key";
		const availableAuthTypes = providerOptions
			? new Set(providerOptions.map((provider) => provider.authType))
			: new Set<AuthSelectorProvider["authType"]>(["oauth", "api_key"]);
		const options: string[] = [];
		if (availableAuthTypes.has("oauth")) {
			options.push(subscriptionLabel);
		}
		if (availableAuthTypes.has("api_key")) {
			options.push(apiKeyLabel);
		}

		if (options.length === 0) {
			this.showStatus("No login methods available.");
			return;
		}

		if (providerOptions && options.length === 1) {
			const providerOption = providerOptions[0];
			if (providerOption) {
				void this.startProviderLogin(providerOption);
			}
			return;
		}

		const title = providerOptions?.[0]
			? `Select authentication method for ${providerOptions[0].name}:`
			: "Select authentication method:";
		this.showSelector((done) => {
			const selector = new ExtensionSelectorComponent(
				title,
				options,
				(option) => {
					done();
					const authType = option === subscriptionLabel ? "oauth" : "api_key";
					if (providerOptions) {
						const providerOption = providerOptions.find((provider) => provider.authType === authType);
						if (providerOption) {
							void this.startProviderLogin(providerOption);
						}
						return;
					}
					this.showLoginProviderSelector(authType);
				},
				() => {
					done();
					this.ui.requestRender();
				},
			);
			return { component: selector, focus: selector };
		});
	}

	private showLoginProviderSelector(authType?: AuthSelectorProvider["authType"], initialSearchInput?: string): void {
		const providerOptions = this.getLoginProviderOptions(authType);
		if (providerOptions.length === 0) {
			const message =
				authType === "oauth"
					? "No subscription providers available."
					: authType === "api_key"
						? "No API key providers available."
						: "No login providers available.";
			this.showStatus(message);
			return;
		}

		this.showSelector((done) => {
			const selector = new OAuthSelectorComponent(
				"login",
				providerOptions,
				async (providerId, selectedAuthType) => {
					done();

					const providerOption = providerOptions.find(
						(provider) => provider.id === providerId && provider.authType === selectedAuthType,
					);
					if (!providerOption) {
						return;
					}

					await this.startProviderLogin(providerOption);
				},
				() => {
					done();
					if (authType) {
						this.showLoginAuthTypeSelector();
					} else {
						this.ui.requestRender();
					}
				},
				initialSearchInput,
			);
			return { component: selector, focus: selector };
		});
	}

	private async showOAuthSelector(mode: "login" | "logout"): Promise<void> {
		if (mode === "login") {
			this.showLoginAuthTypeSelector();
			return;
		}

		let providerOptions: AuthSelectorProvider[];
		try {
			providerOptions = await this.getLogoutProviderOptions();
		} catch (error) {
			this.showError(`Could not read stored credentials: ${error instanceof Error ? error.message : String(error)}`);
			return;
		}
		if (providerOptions.length === 0) {
			this.showStatus(
				"No stored credentials to remove. /logout only removes credentials saved by /login; environment variables and models.json config are unchanged.",
			);
			return;
		}

		this.showSelector((done) => {
			const selector = new OAuthSelectorComponent(
				mode,
				providerOptions,
				async (providerId: string) => {
					done();

					const providerOption = providerOptions.find((provider) => provider.id === providerId);
					if (!providerOption) {
						return;
					}

					try {
						await this.session.modelRuntime.logout(providerOption.id, {
							signal: AbortSignal.timeout(15_000),
						});
						await this.updateAvailableProviderCount();
						const message =
							providerOption.authType === "oauth"
								? `Logged out of ${providerOption.name}`
								: `Removed stored API key for ${providerOption.name}. Environment variables and models.json config are unchanged.`;
						this.showStatus(message);
					} catch (error: unknown) {
						const message = error instanceof Error ? error.message : String(error);
						this.showError(
							error instanceof CredentialSynchronizationError
								? `Credentials removed for ${providerOption.name}, but local model state could not be synchronized: ${message}`
								: `Logout failed: ${message}`,
						);
					}
				},
				() => {
					done();
					this.ui.requestRender();
				},
			);
			return { component: selector, focus: selector };
		});
	}

	private async completeProviderAuthentication(
		providerId: string,
		providerName: string,
		authType: "oauth" | "api_key",
		previousModel: Model<any> | undefined,
	): Promise<void> {
		const actionLabel = authType === "oauth" ? `Logged in to ${providerName}` : `Saved API key for ${providerName}`;

		const session = this.session;
		// Dynamic catalogs may be empty until the first authenticated network refresh.
		const deferSelection =
			isUnknownModel(previousModel) &&
			hasDefaultModelProvider(providerId) &&
			!session.modelRuntime
				.getAvailableSnapshot()
				.some((model) => model.provider === providerId && model.id === defaultModelPerProvider[providerId]);
		const finishAuthentication = async () => {
			let selectedModel: Model<any> | undefined;
			let selectionError: string | undefined;
			if (isUnknownModel(previousModel)) {
				const availableModels = this.session.modelRuntime.getAvailableSnapshot();
				const providerModels = availableModels.filter((model) => model.provider === providerId);
				// Matches LLAMA_PROVIDER_ID from extensions/llama/provider.ts; kept inline to avoid coupling interactive mode to the built-in extension.
				if (providerId === "llama.cpp") {
					selectionError = llamaCppPostLoginGuidance(actionLabel, providerModels.length);
				} else if (!hasDefaultModelProvider(providerId)) {
					selectionError = `${actionLabel}, but no default model is configured for provider "${providerId}". Use /model to select a model.`;
				} else if (providerModels.length === 0) {
					selectionError = `${actionLabel}, but no models are available for that provider. Use /model to select a model.`;
				} else {
					const defaultModelId = defaultModelPerProvider[providerId];
					// Radius catalogs vary by account; prefer balanced, then use catalog order.
					selectedModel =
						providerModels.find((model) => model.id === defaultModelId) ??
						(providerId === "radius" ? providerModels[0] : undefined);
					if (!selectedModel) {
						selectionError = `${actionLabel}, but its default model "${defaultModelId}" is not available. Use /model to select a model.`;
					} else {
						try {
							await this.session.setModel(selectedModel, { persist: true });
						} catch (error: unknown) {
							selectedModel = undefined;
							const errorMessage = error instanceof Error ? error.message : String(error);
							selectionError = `${actionLabel}, but selecting its default model failed: ${errorMessage}. Use /model to select a model.`;
						}
					}
				}
			}

			await this.updateAvailableProviderCount();
			this.footer.invalidate();
			this.updateEditorBorderColor();
			if (selectedModel) {
				this.showStatus(`${actionLabel}. Selected ${selectedModel.id}. Credentials saved to ${getAuthPath()}`);
				void this.maybeWarnAboutAnthropicSubscriptionAuth(selectedModel);
				this.checkDaxnutsEasterEgg(selectedModel);
			} else {
				this.showStatus(`${actionLabel}. Credentials saved to ${getAuthPath()}`);
				if (selectionError) {
					this.showError(selectionError);
				} else {
					void this.maybeWarnAboutAnthropicSubscriptionAuth();
				}
			}
		};
		if (deferSelection) {
			this.showStatus(`${actionLabel}. Credentials saved to ${getAuthPath()}. Refreshing model catalog…`);
		} else {
			await finishAuthentication();
		}

		const controller = new AbortController();
		const timeout = setTimeout(() => controller.abort(), 15_000);
		void session.modelRuntime
			.refresh({ providers: [providerId], signal: controller.signal })
			.then(async (result) => {
				if (result.aborted) {
					this.showWarning(`${actionLabel}, but its model catalog refresh timed out; using cached models.`);
				} else if (result.errors.size > 0) {
					this.showWarning(`${actionLabel}, but its model catalog could not be refreshed; using cached models.`);
				}
				// Do not replace a model or session selected while the refresh was running.
				if (deferSelection && this.session === session && session.model === previousModel) {
					await finishAuthentication();
				}
				this.updateAvailableProviderCount();
				this.footer.invalidate();
				this.ui.requestRender();
			})
			.catch((error: unknown) => {
				this.showWarning(
					`${actionLabel}, but its model catalog could not be refreshed: ${error instanceof Error ? error.message : String(error)}`,
				);
			})
			.finally(() => clearTimeout(timeout));
	}

	private showAmbientAuthDialog(providerOption: AuthSelectorProvider): void {
		const restoreEditor = () => {
			this.editorContainer.clear();
			this.editorContainer.addChild(this.editor);
			this.ui.setFocus(this.editor);
			this.ui.requestRender();
		};

		const dialog = new LoginDialogComponent(
			this.ui,
			providerOption.id,
			() => restoreEditor(),
			providerOption.name,
			`${providerOption.name} setup`,
		);
		dialog.showInfo(
			`${providerOption.method?.name ?? "Authentication"} is configured outside ${APP_NAME}.`,
			[],
			true,
		);

		this.editorContainer.clear();
		this.editorContainer.addChild(dialog);
		this.ui.setFocus(dialog);
		this.ui.requestRender();
	}

	private async showApiKeyLoginDialog(providerId: string, providerName: string): Promise<void> {
		const previousModel = this.session.model;

		const dialog = new LoginDialogComponent(
			this.ui,
			providerId,
			(_success, _message) => {
				// Completion handled below
			},
			providerName,
		);

		if (providerId === "amazon-bedrock") {
			dialog.showDetails([
				theme.fg("text", "You can also use an AWS profile, IAM keys, or role-based credentials."),
				theme.fg("muted", "See:"),
				theme.fg("accent", `  ${path.join(getDocsPath(), "providers.md")}`),
			]);
		}

		this.editorContainer.clear();
		this.editorContainer.addChild(dialog);
		this.ui.setFocus(dialog);
		this.ui.requestRender();

		const restoreEditor = () => {
			this.editorContainer.clear();
			this.editorContainer.addChild(this.editor);
			this.ui.setFocus(this.editor);
			this.ui.requestRender();
		};

		try {
			await this.loginProvider(dialog, providerId, "api_key");
			restoreEditor();
			const modelBeforeLogin = this.session.model;
			await this.completeProviderAuthentication(providerId, providerName, "api_key", previousModel);
			// Login picks a new default model only for a provider it did not know;
			// otherwise the session keeps its model and a live limit stays with it.
			if (this.session.model !== modelBeforeLogin) this.dropContextLimitOverride();
		} catch (error: unknown) {
			restoreEditor();
			const errorMsg = error instanceof Error ? error.message : String(error);
			if (error instanceof CredentialSynchronizationError) {
				this.showError(
					`Saved API key for ${providerName}, but local model state could not be synchronized: ${errorMsg}`,
				);
			} else if (errorMsg !== "Login cancelled") {
				this.showError(`Failed to save API key for ${providerName}: ${errorMsg}`);
			}
		}
	}

	private showAuthSelect(
		dialog: LoginDialogComponent,
		prompt: Extract<AuthPrompt, { type: "select" }>,
	): Promise<string> {
		return new Promise((resolve, reject) => {
			const restoreDialog = () => {
				this.editorContainer.clear();
				this.editorContainer.addChild(dialog);
				this.ui.setFocus(dialog);
				this.ui.requestRender();
			};
			const labels = prompt.options.map((option) => option.label);
			const selector = new ExtensionSelectorComponent(
				prompt.message,
				labels,
				(optionLabel) => {
					restoreDialog();
					const id = prompt.options.find((option) => option.label === optionLabel)?.id;
					if (id) resolve(id);
					else reject(new Error("Login cancelled"));
				},
				() => {
					restoreDialog();
					reject(new Error("Login cancelled"));
				},
			);
			this.editorContainer.clear();
			this.editorContainer.addChild(selector);
			this.ui.setFocus(selector);
			this.ui.requestRender();
		});
	}

	private async showAuthPrompt(dialog: LoginDialogComponent, prompt: AuthPrompt): Promise<string> {
		let response: Promise<string>;
		if (prompt.type === "select") {
			response = this.showAuthSelect(dialog, prompt);
		} else if (prompt.type === "manual_code") {
			response = dialog.showManualInput(prompt.message);
		} else {
			response = dialog.showPrompt(prompt.message, prompt.placeholder);
		}
		if (!prompt.signal) return response;
		if (prompt.signal.aborted) throw new Error("Login cancelled");
		const signal = prompt.signal;
		let onAbort: (() => void) | undefined;
		const aborted = new Promise<string>((_resolve, reject) => {
			onAbort = () => reject(new Error("Login cancelled"));
			signal.addEventListener("abort", onAbort, { once: true });
		});
		try {
			return await Promise.race([response, aborted]);
		} finally {
			if (onAbort) signal.removeEventListener("abort", onAbort);
		}
	}

	private notifyAuthDialog(dialog: LoginDialogComponent, event: AuthEvent): void {
		if (event.type === "auth_url") {
			dialog.showAuth(event.url, event.instructions);
		} else if (event.type === "device_code") {
			dialog.showDeviceCode(event);
			dialog.showWaiting("Waiting for authentication...");
		} else if (event.type === "info") {
			dialog.showInfo(event.message, event.links);
		} else {
			dialog.showProgress(event.message);
		}
	}

	private async loginProvider(
		dialog: LoginDialogComponent,
		providerId: string,
		method: "api_key" | "oauth",
	): Promise<void> {
		await this.session.modelRuntime.login(providerId, method, {
			signal: dialog.signal,
			prompt: (prompt) => this.showAuthPrompt(dialog, prompt),
			notify: (event) => this.notifyAuthDialog(dialog, event),
		});
	}

	private async showLoginDialog(providerId: string, providerName: string): Promise<void> {
		const previousModel = this.session.model;
		const dialog = new LoginDialogComponent(this.ui, providerId, (_success, _message) => {}, providerName);
		this.editorContainer.clear();
		this.editorContainer.addChild(dialog);
		this.ui.setFocus(dialog);
		this.ui.requestRender();

		const restoreEditor = () => {
			this.editorContainer.clear();
			this.editorContainer.addChild(this.editor);
			this.ui.setFocus(this.editor);
			this.ui.requestRender();
		};

		try {
			await this.loginProvider(dialog, providerId, "oauth");
			restoreEditor();
			const modelBeforeLogin = this.session.model;
			await this.completeProviderAuthentication(providerId, providerName, "oauth", previousModel);
			// Login picks a new default model only for a provider it did not know;
			// otherwise the session keeps its model and a live limit stays with it.
			if (this.session.model !== modelBeforeLogin) this.dropContextLimitOverride();
		} catch (error: unknown) {
			restoreEditor();
			const errorMsg = error instanceof Error ? error.message : String(error);
			if (error instanceof CredentialSynchronizationError) {
				this.showError(
					`Logged in to ${providerName}, but local model state could not be synchronized: ${errorMsg}`,
				);
			} else if (errorMsg !== "Login cancelled") {
				this.showError(`Failed to login to ${providerName}: ${errorMsg}`);
			}
		}
	}

	// =========================================================================
	// Command handlers
	// =========================================================================

	private async handleReloadCommand(): Promise<void> {
		if (this.session.isStreaming) {
			this.showWarning("Wait for the current response to finish before reloading.");
			return;
		}
		if (this.session.isCompacting) {
			this.showWarning("Wait for compaction to finish before reloading.");
			return;
		}

		this.resetExtensionUI();

		const reloadBox = new Container();
		const borderColor = (s: string) => theme.fg("border", s);
		reloadBox.addChild(new DynamicBorder(borderColor));
		reloadBox.addChild(new Spacer(1));
		reloadBox.addChild(
			new Text(
				theme.fg("muted", "Reloading keybindings, extensions, skills, prompts, themes, and context files..."),
				1,
				0,
			),
		);
		reloadBox.addChild(new Spacer(1));
		reloadBox.addChild(new DynamicBorder(borderColor));

		const previousEditor = this.editor;
		this.editorContainer.clear();
		this.editorContainer.addChild(reloadBox);
		this.ui.setFocus(reloadBox);
		this.ui.requestRender(true);
		await new Promise((resolve) => process.nextTick(resolve));

		const dismissReloadBox = (editor: Component) => {
			this.editorContainer.clear();
			this.editorContainer.addChild(editor);
			this.ui.setFocus(editor);
			this.ui.requestRender();
		};

		let chatRestoredBeforeSessionStart = false;
		let reloadBoxDismissed = false;
		const restoreChatBeforeSessionStart = () => {
			if (chatRestoredBeforeSessionStart) {
				return;
			}
			this.hideThinkingBlock = this.settingsManager.getHideThinkingBlock();
			this.outputPad = this.settingsManager.getOutputPad();
			this.rebuildChatFromMessages();
			chatRestoredBeforeSessionStart = true;
		};

		try {
			await this.session.reload({ beforeSessionStart: restoreChatBeforeSessionStart });
			restoreChatBeforeSessionStart();
			this.dropContextLimitOverride();
			this.keybindings.reload();
			const activeHeader = this.customHeader ?? this.builtInHeader;
			if (isExpandable(activeHeader)) {
				activeHeader.setExpanded(this.toolOutputExpanded);
			}
			setRegisteredThemes(this.session.resourceLoader.getThemes().themes);
			this.applyRuntimeSettings();
			await this.themeController.applyFromSettings();
			this.setupAutocompleteProvider();
			const runner = this.session.extensionRunner;
			this.setupExtensionShortcuts(runner);
			this.showLoadedResources({
				force: false,
				showDiagnosticsWhenQuiet: true,
			});
			const savedImplicitProjectTrust = this.maybeSaveImplicitProjectTrustAfterReload();
			const modelsJsonError = this.session.modelRuntime.getError();
			if (modelsJsonError) {
				this.showError(`models.json error: ${modelsJsonError}`);
			}
			this.showStatus(
				savedImplicitProjectTrust
					? "Reloaded keybindings, extensions, skills, prompts, themes, and context files; saved project trust"
					: "Reloaded keybindings, extensions, skills, prompts, themes, and context files",
			);
			dismissReloadBox(this.editor as Component);
			reloadBoxDismissed = true;
		} catch (error) {
			if (!reloadBoxDismissed) {
				dismissReloadBox(previousEditor as Component);
			}
			this.showError(`Reload failed: ${error instanceof Error ? error.message : String(error)}`);
		}
	}

	private async handleExportCommand(text: string): Promise<void> {
		const outputPath = this.getPathCommandArgument(text, "/export");

		try {
			if (outputPath?.endsWith(".jsonl")) {
				const filePath = this.session.exportToJsonl(outputPath);
				this.showStatus(`Session exported to: ${filePath}`);
			} else {
				const filePath = await this.session.exportToHtml(outputPath, {
					themeName: theme.name,
				});
				this.showStatus(`Session exported to: ${filePath}`);
			}
		} catch (error: unknown) {
			this.showError(`Failed to export session: ${error instanceof Error ? error.message : "Unknown error"}`);
		}
	}

	private getPathCommandArgument(text: string, command: "/export" | "/import"): string | undefined {
		if (text === command) {
			return undefined;
		}
		if (!text.startsWith(`${command} `)) {
			return undefined;
		}

		const argsString = text.slice(command.length + 1).trimStart();
		if (!argsString) {
			return undefined;
		}

		const firstChar = argsString[0];
		if (firstChar === '"' || firstChar === "'") {
			const closingQuoteIndex = argsString.indexOf(firstChar, 1);
			if (closingQuoteIndex < 0) {
				return undefined;
			}
			return argsString.slice(1, closingQuoteIndex);
		}

		const firstWhitespaceIndex = argsString.search(/\s/);
		if (firstWhitespaceIndex < 0) {
			return argsString;
		}
		return argsString.slice(0, firstWhitespaceIndex);
	}

	private async handleImportCommand(text: string): Promise<void> {
		const inputPath = this.getPathCommandArgument(text, "/import");
		if (!inputPath) {
			this.showError("Usage: /import <path.jsonl>");
			return;
		}

		const confirmed = await this.showExtensionConfirm("Import session", `Replace current session with ${inputPath}?`);
		if (!confirmed) {
			this.showStatus("Import cancelled");
			return;
		}

		try {
			this.clearStatusIndicator();
			const result = await this.runtimeHost.importFromJsonl(inputPath);
			if (result.cancelled) {
				this.showStatus("Import cancelled");
				return;
			}
			this.showStatus(`Session imported from: ${inputPath}`);
		} catch (error: unknown) {
			if (error instanceof MissingSessionCwdError) {
				const selectedCwd = await this.promptForMissingSessionCwd(error);
				if (!selectedCwd) {
					this.showStatus("Import cancelled");
					return;
				}
				const result = await this.runtimeHost.importFromJsonl(inputPath, selectedCwd);
				if (result.cancelled) {
					this.showStatus("Import cancelled");
					return;
				}
				this.showStatus(`Session imported from: ${inputPath}`);
				return;
			}
			if (error instanceof SessionImportFileNotFoundError) {
				this.showError(`Failed to import session: ${error.message}`);
				return;
			}
			await this.handleFatalRuntimeError("Failed to import session", error);
		}
	}

	private async handleShareCommand(): Promise<void> {
		await shareSession({
			session: this.session,
			ui: this.ui,
			editorContainer: this.editorContainer,
			editor: this.editor,
			showStatus: (message) => this.showStatus(message),
			showError: (message) => this.showError(message),
		});
	}

	private async handleBugCommand(hint: string | undefined): Promise<void> {
		await reportBug(
			{
				session: this.session,
				ui: this.ui,
				editorContainer: this.editorContainer,
				editor: this.editor,
				keybindings: this.keybindings,
				showStatus: (message) => this.showStatus(message),
				showError: (message) => this.showError(message),
			},
			hint,
		);
	}

	private async handleCopyCommand(options: { preferSelection?: boolean } = {}): Promise<void> {
		if (
			options.preferSelection &&
			this.ui instanceof TuiAltScreen &&
			!this.ui.getCopyOnSelect() &&
			this.ui.hasActiveSelection()
		) {
			await this.ui.copyActiveSelectionToClipboard();
			return;
		}

		const text = this.session.getLastAssistantText();
		if (!text) {
			this.showError("No agent messages to copy yet.");
			return;
		}

		try {
			await copyToClipboard(text);
			this.notifyToast("success", copyConfirmation(countGraphemes(text)));
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			this.showError(message);
			this.notifyToast("error", copyFailure(message));
		}
	}

	private handleNameCommand(text: string): void {
		const name = text.replace(/^\/name\s*/, "").trim();
		if (!name) {
			const currentName = this.sessionManager.getSessionName();
			if (currentName) {
				this.chatContainer.addChild(new Spacer(1));
				this.chatContainer.addChild(new Text(theme.fg("dim", `Session name: ${currentName}`), 1, 0));
			} else {
				this.showWarning("Usage: /name <name>");
			}
			this.ui.requestRender();
			return;
		}

		this.session.setSessionName(name);
		const sessionName = this.sessionManager.getSessionName();
		if (sessionName !== name) {
			this.showWarning(`Session name was normalized from ${JSON.stringify(name)} to ${JSON.stringify(sessionName)}`);
		}
		this.chatContainer.addChild(new Spacer(1));
		this.chatContainer.addChild(new Text(theme.fg("dim", `Session name set: ${sessionName ?? name}`), 1, 0));
		this.ui.requestRender();
	}

	private handleSessionCommand(): void {
		const stats = this.session.getSessionStats();
		const sessionName = this.sessionManager.getSessionName();
		const entries = this.sessionManager.getEntries();
		const cacheWaste = computeCacheWaste(entries, this.session.modelRuntime);

		// Cost/token totals per provider/model actually used (e.g. OpenRouter `auto`
		// resolves to a concrete responseModel). Usage without model attribution is
		// grouped separately so the breakdown reconciles with the session total.
		const usageBreakdown = getUsageCostBreakdown(entries);

		let info = `${theme.bold("Session Info")}\n\n`;
		if (sessionName) {
			info += `${theme.fg("dim", "Name:")} ${sessionName}\n`;
		}
		info += `${theme.fg("dim", "File:")} ${stats.sessionFile ?? "In-memory"}\n`;
		info += `${theme.fg("dim", "ID:")} ${stats.sessionId}\n\n`;
		info += `${theme.bold("Messages")}\n`;
		info += `${theme.fg("dim", "Total:")} ${stats.totalMessages}\n`;
		info += `${theme.fg("dim", "User:")} ${stats.userMessages}\n`;
		info += `${theme.fg("dim", "Assistant:")} ${stats.assistantMessages}\n`;
		info += `${theme.fg("dim", "Tools:")} ${stats.toolCalls} calls, ${stats.toolResults} results\n\n`;
		info += `${theme.bold("Tokens")}\n`;
		// "Input" is the full prompt volume. With cache activity, split it into
		// cached (served from cache) vs uncached (everything else) - the only
		// provider-independent split. Cache writes, where reported, are a detail
		// of the uncached portion.
		const { input, cacheRead, cacheWrite } = stats.tokens;
		const promptTokens = input + cacheRead + cacheWrite;
		info += `${theme.fg("dim", "Input:")} ${promptTokens.toLocaleString()}\n`;
		if (promptTokens > 0 && (cacheRead > 0 || cacheWrite > 0)) {
			const hitRate = theme.fg("dim", `(${((cacheRead / promptTokens) * 100).toFixed(1)}%)`);
			info += `  ${theme.fg("dim", "Cached:")} ${cacheRead.toLocaleString()} ${hitRate}\n`;
			const written =
				cacheWrite > 0 ? ` ${theme.fg("dim", `(${cacheWrite.toLocaleString()} written to cache)`)}` : "";
			info += `  ${theme.fg("dim", "Uncached:")} ${(input + cacheWrite).toLocaleString()}${written}\n`;
		}
		info += `${theme.fg("dim", "Output:")} ${stats.tokens.output.toLocaleString()}\n`;
		info += `${theme.fg("dim", "Total:")} ${stats.tokens.total.toLocaleString()}\n`;

		const cacheWarmingStatus = this.session.cacheWarmingStatus;
		info += `\n${theme.bold("Cache Warming")}\n`;
		info += `${theme.fg("dim", "Mode:")} ${this.settingsManager.getCacheWarmingMode()}\n`;
		info += `${theme.fg("dim", "Status:")} ${cacheWarmingStatus ? formatCacheWarmingStatus(cacheWarmingStatus) : "Inactive (cache warming unavailable)"}\n`;
		const decision = cacheWarmingStatus?.decision;
		if (decision?.economicsAvailable) {
			info += `${theme.fg("dim", "Cache miss penalty:")} $${decision.missCost.toFixed(3)}\n`;
			info += `${theme.fg("dim", "Refresh cost:")} $${decision.warmCost.toFixed(3)}\n`;
		}

		if (stats.cost > 0 || cacheWaste.missedTokens > 0) {
			info += `\n${theme.bold("Cost")}\n`;
			info += `${theme.fg("dim", "Total:")} $${stats.cost.toFixed(3)}`;
			if (usageBreakdown.length > 1) {
				for (const entry of usageBreakdown) {
					info += `\n  ${theme.fg("dim", `${entry.key}:`)} $${entry.cost.toFixed(3)} ${theme.fg("dim", `(${formatTokens(entry.tokens)} tokens)`)}`;
				}
			}
			if (cacheWaste.missedTokens > 0) {
				const missLabel = cacheWaste.missCount === 1 ? "1 miss" : `${cacheWaste.missCount} misses`;
				const detail = `${cacheWaste.missedTokens.toLocaleString()} tokens, ${missLabel}`;
				info +=
					cacheWaste.missedCost >= 0.0001
						? `\n${theme.fg("dim", "Cache Re-billed:")} $${cacheWaste.missedCost.toFixed(3)} ${theme.fg("dim", `(${detail})`)}`
						: `\n${theme.fg("dim", "Cache Re-billed:")} ${detail}`;
			}
		}

		this.chatContainer.addChild(new Spacer(1));
		this.chatContainer.addChild(new Text(info, 1, 0));
		this.ui.requestRender();
	}

	private handleChangelogCommand(): void {
		const changelogPath = getChangelogPath();
		const allEntries = parseChangelog(changelogPath);

		const changelogMarkdown =
			allEntries.length > 0
				? allEntries
						.reverse()
						.map((e) => normalizeChangelogLinks(e.content, e))
						.join("\n\n")
				: "No changelog entries found.";

		this.chatContainer.addChild(new Spacer(1));
		this.chatContainer.addChild(new DynamicBorder());
		this.chatContainer.addChild(new Text(theme.bold(theme.fg("accent", "What's New")), 1, 0));
		this.chatContainer.addChild(new Spacer(1));
		this.chatContainer.addChild(new Markdown(changelogMarkdown, 1, 1, this.getMarkdownThemeWithSettings()));
		this.chatContainer.addChild(new DynamicBorder());
		this.ui.requestRender();
	}

	/**
	 * Get capitalized display string for an app keybinding action.
	 */
	private getAppKeyDisplay(action: AppKeybinding): string {
		return keyDisplayText(action);
	}

	/**
	 * Get capitalized display string for an editor keybinding action.
	 */
	private getEditorKeyDisplay(action: Keybinding): string {
		return keyDisplayText(action);
	}

	private handleHotkeysCommand(): void {
		// Navigation keybindings
		const cursorUp = this.getEditorKeyDisplay("tui.editor.cursorUp");
		const cursorDown = this.getEditorKeyDisplay("tui.editor.cursorDown");
		const cursorLeft = this.getEditorKeyDisplay("tui.editor.cursorLeft");
		const cursorRight = this.getEditorKeyDisplay("tui.editor.cursorRight");
		const cursorWordLeft = this.getEditorKeyDisplay("tui.editor.cursorWordLeft");
		const cursorWordRight = this.getEditorKeyDisplay("tui.editor.cursorWordRight");
		const cursorLineStart = this.getEditorKeyDisplay("tui.editor.cursorLineStart");
		const cursorLineEnd = this.getEditorKeyDisplay("tui.editor.cursorLineEnd");
		const jumpForward = this.getEditorKeyDisplay("tui.editor.jumpForward");
		const jumpBackward = this.getEditorKeyDisplay("tui.editor.jumpBackward");
		const pageUp = this.getEditorKeyDisplay("tui.editor.pageUp");
		const pageDown = this.getEditorKeyDisplay("tui.editor.pageDown");

		// Editing keybindings
		const submit = this.getEditorKeyDisplay("tui.input.submit");
		const newLine = this.getEditorKeyDisplay("tui.input.newLine");
		const deleteWordBackward = this.getEditorKeyDisplay("tui.editor.deleteWordBackward");
		const deleteWordForward = this.getEditorKeyDisplay("tui.editor.deleteWordForward");
		const deleteToLineStart = this.getEditorKeyDisplay("tui.editor.deleteToLineStart");
		const deleteToLineEnd = this.getEditorKeyDisplay("tui.editor.deleteToLineEnd");
		const yank = this.getEditorKeyDisplay("tui.editor.yank");
		const yankPop = this.getEditorKeyDisplay("tui.editor.yankPop");
		const undo = this.getEditorKeyDisplay("tui.editor.undo");
		const tab = this.getEditorKeyDisplay("tui.input.tab");

		// App keybindings
		const interrupt = this.getAppKeyDisplay("app.interrupt");
		const clear = this.getAppKeyDisplay("app.clear");
		const exit = this.getAppKeyDisplay("app.exit");
		const quit = this.getAppKeyDisplay("app.quit");
		const palette = this.getAppKeyDisplay("app.palette");
		const jumpTab = this.getAppKeyDisplay("app.tab.jump");
		const jumpNonIdle = this.getAppKeyDisplay("app.tabJump.toggleNonIdle");
		const suspend = this.getAppKeyDisplay("app.suspend");
		const cycleThinkingLevel = this.getAppKeyDisplay("app.thinking.cycle");
		const selectModel = this.getAppKeyDisplay("app.model.select");
		const expandTools = this.getAppKeyDisplay("app.tools.expand");
		const toggleThinking = this.getAppKeyDisplay("app.thinking.toggle");
		const externalEditor = this.getAppKeyDisplay("app.editor.external");
		const cycleModelBackward = this.getAppKeyDisplay("app.model.cycleBackward");
		const copyMessage = this.getAppKeyDisplay("app.message.copy");
		const followUp = this.getAppKeyDisplay("app.message.followUp");
		const dequeue = this.getAppKeyDisplay("app.message.dequeue");
		const pasteImage = this.getAppKeyDisplay("app.clipboard.pasteImage");

		let hotkeys = `
**Navigation**
| Key | Action |
|-----|--------|
| \`${cursorUp}\` / \`${cursorDown}\` / \`${cursorLeft}\` / \`${cursorRight}\` | Move cursor / browse history |
| \`${cursorWordLeft}\` / \`${cursorWordRight}\` | Move by word |
| \`${cursorLineStart}\` | Start of line |
| \`${cursorLineEnd}\` | End of line |
| \`${jumpForward}\` | Jump forward to character |
| \`${jumpBackward}\` | Jump backward to character |
| \`${pageUp}\` / \`${pageDown}\` | Scroll by page |

**Editing**
| Key | Action |
|-----|--------|
| \`${submit}\` | Send message |
| \`${newLine}\` | New line${process.platform === "win32" ? " (Ctrl+Enter on Windows Terminal)" : ""} |
| \`${deleteWordBackward}\` | Delete word backwards |
| \`${deleteWordForward}\` | Delete word forwards |
| \`${deleteToLineStart}\` | Delete to start of line |
| \`${deleteToLineEnd}\` | Delete to end of line |
| \`${yank}\` | Paste the most-recently-deleted text |
| \`${yankPop}\` | Cycle through the deleted text after pasting |
| \`${undo}\` | Undo |

**Other**
| Key | Action |
|-----|--------|
| \`${tab}\` | Path completion / accept autocomplete |
| \`${interrupt}\` | Cancel autocomplete / abort streaming |
| \`${clear}\` | Clear editor (first) / exit (second) |
| \`${exit}\` | Exit (when editor is empty) |
| \`${quit}\` | Quit (asks first) |
| \`${palette}\` | Open command palette |
| \`${jumpTab}\` | Open tab jump overlay |
| \`${jumpNonIdle}\` | Toggle the tab jump non-idle filter |
| \`${suspend}\` | Suspend to background |
| \`${cycleThinkingLevel}\` | Cycle thinking level |
| \`${cycleModelBackward}\` | Cycle to previous model |
| \`${selectModel}\` | Open model selector |
| \`${expandTools}\` | Toggle tool output expansion |
| \`${toggleThinking}\` | Toggle thinking block visibility (taken by Tab Jump; rebind it to use it) |
| \`${externalEditor}\` | Edit message in external editor |
| \`${copyMessage}\` | Copy selection or last assistant message |
| \`${followUp}\` | Queue follow-up message (rounds merge while the agent runs) |
| \`${dequeue}\` | Edit queued messages: steer / follow-up pick when both are queued (\`${dequeue},S\` / \`${dequeue},F\`) |
| \`Esc\` | Abort / send queued steer messages now |
| \`${pasteImage}\` | Paste image or text from clipboard |
| \`/\` | Slash commands |
| \`!\` | Run bash command |
| \`!!\` | Run bash command (excluded from context) |
`;

		// Add extension-registered shortcuts
		const extensionRunner = this.session.extensionRunner;
		const shortcuts = extensionRunner.getShortcuts(this.keybindings.getEffectiveConfig());
		if (shortcuts.size > 0) {
			hotkeys += `
**Extensions**
| Key | Action |
|-----|--------|
`;
			for (const [key, shortcut] of shortcuts) {
				const description = shortcut.description ?? shortcut.extensionPath;
				const keyDisplay = formatKeyText(key, { capitalize: true });
				hotkeys += `| \`${keyDisplay}\` | ${description} |\n`;
			}
		}

		this.chatContainer.addChild(new Spacer(1));
		this.chatContainer.addChild(new DynamicBorder());
		this.chatContainer.addChild(new Text(theme.bold(theme.fg("accent", "Keyboard Shortcuts")), 1, 0));
		this.chatContainer.addChild(new Spacer(1));
		this.chatContainer.addChild(new Markdown(hotkeys.trim(), 1, 1, this.getMarkdownThemeWithSettings()));
		this.chatContainer.addChild(new DynamicBorder());
		this.ui.requestRender();
	}

	/**
	 * `/clear`: replace the active tab's session with a fresh file, keeping the tab, its workdir, its
	 * model and its thinking level. Refused while a turn or a bash command runs.
	 */
	private async handleClearCommand(): Promise<void> {
		// Bash is checked first: a running bash command also reports streaming.
		if (this.session.isBashRunning) {
			this.showWarning("A bash command is already running. Press Esc to cancel it first.");
			return;
		}
		if (this.session.isStreaming) {
			this.showWarning("Wait for the current response to finish before clearing the session.");
			return;
		}
		this.clearStatusIndicator();
		try {
			const result = await this.runtimeHost.newSession({
				// A cleared session keeps the outgoing header's parent, so the two stay siblings.
				parentSession: this.session.sessionManager.getHeader()?.parentSession,
			});
			if (result.cancelled) {
				return;
			}
			// The chip color is keyed by session id, and a cleared session has none.
			const activeTab = this.tabManager?.activeTab();
			if (activeTab) this.tabManager?.setColor(activeTab.id, undefined);
			// The new conversation owns nothing from the old queue.
			discardFollowUps(this.followUpState);
			this.followUpState.pendingSteer = [];
			this.chatContainer.addChild(new Spacer(1));
			this.chatContainer.addChild(new Text(`${theme.fg("accent", "✓ New session started")}`, 1, 1));
			this.ui.requestRender();
		} catch (error: unknown) {
			await this.handleFatalRuntimeError("Failed to create session", error);
		}
	}

	/**
	 * `/reset`: move the leaf back to the session root in the same tab, file and title, leaving the
	 * abandoned branches in `/tree`.
	 */
	private async handleResetCommand(): Promise<void> {
		if (this.session.isBashRunning) {
			this.showWarning("A bash command is already running. Press Esc to cancel it first.");
			return;
		}
		try {
			const result = await this.session.resetLeafToRoot();
			if (result.noop) {
				this.showStatus("Already at session root (nothing to reset).");
				return;
			}
			this.chatContainer.clear();
			this.renderInitialMessages();
			this.showStatus("Reset to session root. Earlier branches are in /tree.");
			void this.flushCompactionQueue({ willRetry: false });
		} catch (error: unknown) {
			this.showError(error instanceof Error ? error.message : String(error));
		}
	}

	private handleDebugCommand(): void {
		const width = this.ui.terminal.columns;
		const height = this.ui.terminal.rows;
		const allLines = this.ui.render(width);

		const debugLogPath = getDebugLogPath();
		const debugData = [
			`Debug output at ${new Date().toISOString()}`,
			`Terminal: ${width}x${height}`,
			`Total lines: ${allLines.length}`,
			"",
			"=== All rendered lines with visible widths ===",
			...allLines.map((line, idx) => {
				const vw = visibleWidth(line);
				const escaped = JSON.stringify(line);
				return `[${idx}] (w=${vw}) ${escaped}`;
			}),
			"",
			"=== Agent messages (JSONL) ===",
			...this.session.messages.map((msg) => JSON.stringify(msg)),
			"",
		].join("\n");

		fs.mkdirSync(path.dirname(debugLogPath), { recursive: true });
		fs.writeFileSync(debugLogPath, debugData);

		this.chatContainer.addChild(new Spacer(1));
		this.chatContainer.addChild(
			new Text(`${theme.fg("accent", "✓ Debug log written")}\n${theme.fg("muted", debugLogPath)}`, 1, 1),
		);
		this.ui.requestRender();
	}

	private handleArminSaysHi(): void {
		this.chatContainer.addChild(new Spacer(1));
		this.chatContainer.addChild(new ArminComponent(this.ui));
		this.ui.requestRender();
	}

	private handleDementedDelves(): void {
		this.chatContainer.addChild(new Spacer(1));
		this.chatContainer.addChild(new EarendilAnnouncementComponent());
		this.ui.requestRender();
	}

	private handleDaxnuts(): void {
		this.chatContainer.addChild(new Spacer(1));
		this.chatContainer.addChild(new DaxnutsComponent(this.ui));
		this.ui.requestRender();
	}

	private checkDaxnutsEasterEgg(model: { provider: string; id: string }): void {
		if (model.provider === "opencode" && model.id.toLowerCase().includes("kimi-k2.5")) {
			this.handleDaxnuts();
		}
	}

	private async handleBashCommand(command: string, excludeFromContext = false): Promise<void> {
		const extensionRunner = this.session.extensionRunner;

		// Emit user_bash event to let extensions intercept
		let eventResult: UserBashEventResult | undefined;
		try {
			eventResult = await extensionRunner.emitUserBash({
				type: "user_bash",
				command,
				excludeFromContext,
				cwd: this.sessionManager.getCwd(),
			});
		} catch {
			// The extension runner already reported the error. Do not fall back to local execution.
			return;
		}

		// If extension returned a full result, use it directly
		if (eventResult?.result) {
			const result = eventResult.result;

			// Create UI component for display
			this.bashComponent = new BashExecutionComponent(command, this.ui, excludeFromContext);
			if (this.session.isStreaming) {
				this.pendingMessagesContainer.addChild(this.bashComponent);
				this.pendingBashComponents.push(this.bashComponent);
			} else {
				this.chatContainer.addChild(this.bashComponent);
			}

			// Show output and complete
			if (result.output) {
				this.bashComponent.appendOutput(result.output);
			}
			this.bashComponent.setComplete(
				result.exitCode,
				result.cancelled,
				result.truncated ? ({ truncated: true, content: result.output } as TruncationResult) : undefined,
				result.fullOutputPath,
			);

			// Record the result in session
			this.session.recordBashResult(command, result, { excludeFromContext });
			this.bashComponent = undefined;
			this.ui.requestRender();
			return;
		}

		// Normal execution path (possibly with custom operations)
		const isDeferred = this.session.isStreaming;
		this.bashComponent = new BashExecutionComponent(command, this.ui, excludeFromContext);

		if (isDeferred) {
			// Show in pending area when agent is streaming
			this.pendingMessagesContainer.addChild(this.bashComponent);
			this.pendingBashComponents.push(this.bashComponent);
		} else {
			// Show in chat immediately when agent is idle
			this.chatContainer.addChild(this.bashComponent);
		}
		this.ui.requestRender();

		try {
			const result = await this.session.executeBash(
				command,
				(chunk) => {
					if (this.bashComponent) {
						this.bashComponent.appendOutput(chunk);
						this.ui.requestRender();
					}
				},
				{ excludeFromContext, operations: eventResult?.operations },
			);

			if (this.bashComponent) {
				this.bashComponent.setComplete(
					result.exitCode,
					result.cancelled,
					result.truncated ? ({ truncated: true, content: result.output } as TruncationResult) : undefined,
					result.fullOutputPath,
				);
			}
		} catch (error) {
			if (this.bashComponent) {
				this.bashComponent.setComplete(undefined, false);
			}
			this.showError(`Bash command failed: ${error instanceof Error ? error.message : "Unknown error"}`);
		}

		this.bashComponent = undefined;
		this.ui.requestRender();
	}

	private async handleCompactCommand(args = ""): Promise<void> {
		const session = this.session;
		const tab = this.tabManager?.getActive();
		const firstToken = args.trimStart().split(/\s/)[0] ?? "";
		const modelRef = /^[^/\s]+\/[^/\s]+(?:\/[^/\s]+)*$/.test(firstToken) ? firstToken : undefined;
		const customInstructions = modelRef ? args.trimStart().slice(firstToken.length).trimStart() : args;
		const model = modelRef
			? findExactModelReferenceMatch(modelRef, [...session.modelRuntime.getAvailableSnapshot()])
			: undefined;
		if (modelRef && !model) {
			this.showError(`Unknown model: ${modelRef}`);
			return;
		}
		if (modelRef) this.compactionModelRefs.set(session, modelRef);
		this.clearStatusIndicator();

		// Claim synchronously so queued rounds cannot enter before compaction starts.
		this.compactionClaimed = true;
		try {
			await runInTabConsole(tab, () => session.compact(customInstructions || undefined, model));
		} catch {
			// A throw before compaction starts never reaches compaction_end, so this is
			// the only place the synchronous claim is released.
			this.compactionClaimed = false;
		} finally {
			this.compactionModelRefs.delete(session);
		}
	}

	stop(fullscreenExitOutput = this.settingsManager.getFullscreenExitOutput()): void {
		this.stopTabShimmerRedraw?.();
		this.stopTabShimmerRedraw = undefined;
		this.stopWorkingIndicatorRedraw?.();
		this.stopWorkingIndicatorRedraw = undefined;
		this.stopTabLoadingRedraw?.();
		this.stopTabLoadingRedraw = undefined;
		this.disposeActiveSelector();
		if (this.settingsManager.getShowTerminalProgress()) {
			this.ui.terminal.setProgress(false);
		}
		this.clearStatusIndicator();
		this.themeController.disableAutoSync();
		this.clearExtensionTerminalInputListeners();
		this.extensionDialogShortcutUnsubscribe?.();
		this.extensionDialogShortcutUnsubscribe = undefined;
		this.footer.dispose();
		this.footerDataProvider.dispose();
		if (this.unsubscribe) {
			this.unsubscribe();
		}
		if (this.isInitialized) {
			this.stopInteractiveTui(fullscreenExitOutput);
			this.isInitialized = false;
		}
		this.unregisterSignalHandlers();
		// The TUI is gone: give console output back to the terminal, so a report written
		// after this point (startup timings, shutdown hooks) stays readable.
		unwireConsoleSink();
	}
}
