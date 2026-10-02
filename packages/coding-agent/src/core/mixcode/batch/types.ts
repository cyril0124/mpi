/**
 * Batch script domain types.
 *
 * A batch script collects named tab requests and a host applies them: create or
 * reuse tabs, configure each tab, then dispatch one prompt (or an ordered
 * `prompts` sequence). The core (parsing, validation, planning) is host-agnostic
 * so the CLI dry-run and the interactive TUI share one executor.
 */
import type { ThinkingLevel } from "@earendil-works/pi-agent-core";

/** How a request treats an existing tab with the same name. */
export type BatchReuseMode = "append" | "clear" | "delete";

/** Snapshot of one open tab, exposed to scripts as `list_tabs()` / `listTabs()`. */
export interface BatchTabSnapshot {
	name: string;
	sessionId: string;
	workdir: string;
	model: string;
	thinking: ThinkingLevel;
	status: string;
}

/** Snapshot of one available model, exposed as `list_models()` / `listModels()`. */
export interface BatchModelInfo {
	/** Canonical `provider/modelId`. */
	id: string;
	provider: string;
	modelId: string;
	displayName: string;
	contextWindow: number;
	reasoning: boolean;
}

/**
 * A model a request resolved to. Carries enough capability data for validation
 * (thinking levels) and for the host to select the concrete catalog model.
 */
export interface BatchResolvedModel {
	/** Canonical `provider/modelId`. */
	id: string;
	provider: string;
	modelId: string;
	displayName: string;
	contextWindow: number;
	reasoning: boolean;
	/** Thinking levels this model accepts, as reported by the host catalog. */
	thinkingLevels: readonly string[];
}

/** Fixed inputs for one script invocation. */
export interface BatchContext {
	workdir: string;
	tabs: BatchTabSnapshot[];
	/** Available models captured before this invocation. */
	models?: BatchModelInfo[];
	/** Provider of the invocation's default model, preferred for bare ids. */
	defaultProvider?: string;
	/** Canonical model ids excluded from resolution. */
	disabledModelIds?: string[];
	/** Arguments after `--` in the startup CLI or the interactive /batch command. */
	args?: string[];
}

/** One parsed `open_tab` / `openTab` request. */
export interface BatchTabRequest {
	name: string;
	/** One input to dispatch into the tab; omit both prompt fields to configure the tab only. */
	prompt?: string;
	/** Exclusive follow-up rounds; mutually exclusive with prompt. Returns after enqueue. */
	prompts?: string[];
	/** Workdir for a new tab; a different workdir on an existing tab is rejected. */
	workdir?: string;
	/** Model reference resolved against the invocation snapshot; omitted keeps the tab's model. */
	model?: string;
	/** Thinking level; omitted keeps the tab's level. */
	thinking?: string;
	/** Normalized per-session tokens, or `reset`; applied before any input. */
	contextLimit?: number | "reset";
	/**
	 * Base/identity system prompt. Requires a new session: create or
	 * `mode="delete"`. Rejected with `mode="clear"`.
	 */
	systemPrompt?: string;
	/** Behavior when reusing an existing tab: `append` (default), `clear`, `delete`. */
	mode?: BatchReuseMode;
}

/** Result of loading a batch script. */
export interface BatchPlan {
	requests: BatchTabRequest[];
}

/** Model override applied to a tab before its input dispatches. */
export interface BatchTabConfig {
	model?: BatchResolvedModel;
	thinking?: ThinkingLevel;
	contextLimit?: number | "reset";
	/** Workdir requested for an existing tab; hosts may reopen or reject explicitly. */
	workdir?: string;
}

/**
 * Host interface the executor uses to touch the TUI/runtime. The core never
 * imports the interactive mode; the host adapter supplies these operations.
 */
export interface BatchExecutorHost {
	/** Current default model, used for implicit resolution of same-name requests. */
	defaultModel: BatchResolvedModel;
	/** Resolve a named tab to its session id, if open. */
	findTabByTitle(title: string): { sessionId: string } | undefined;
	/** Current model of a named open tab, used to validate same-name implicit requests. */
	resolveModelByTitle(title: string): BatchResolvedModel | undefined;
	/** Whether a named tab exists (used for systemPrompt reuse checks). */
	tabExists(name: string): boolean;
	createNewTab(request: BatchTabRequest): Promise<string>;
	configureTab(sessionId: string, config: BatchTabConfig): Promise<void>;
	/** Reset a session to its root, preserving id, file, and title. */
	clearTab(sessionId: string): Promise<void>;
	/** Delete an existing tab and its session file. */
	deleteTab(sessionId: string): Promise<void>;
	/** Submit one input through the host's normal dispatch pipeline. */
	submitInput(sessionId: string, input: string): Promise<void>;
	/** Append validated prompts as exclusive follow-up steps without awaiting execution. */
	queuePrompts(sessionId: string, prompts: readonly string[]): Promise<void>;
	resolveModel(query: string): BatchResolvedModel;
}
