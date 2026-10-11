/**
 * `/batch` and the CLI `--batch` flag for the interactive TUI.
 *
 * The script lifecycle itself lives in `core/mixcode/batch/`; this module is the
 * TUI adapter. It reads the tab fleet, builds the host the executor drives, and
 * runs the tab-scoped commands the owner queue dispatches. Every entry point takes
 * a {@link BatchCommandHost} so the interactive mode keeps only thin wrappers and
 * no batch logic of its own.
 *
 * Ownership rule: a request, and any command it queues, dispatches into the tab
 * that owns it. Nothing here reads the focused tab except where the invocation
 * workdir is resolved.
 */

import * as path from "node:path";
import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import type { Api, Model } from "@earendil-works/pi-ai";
import type { AgentSession } from "../../../../core/agent-session.ts";
import { THINKING_LEVEL_OPTIONS } from "../../../../core/defaults.ts";
import {
	type BatchLifecyclePort,
	createBatchTab,
	createOwnerFollowUpHost,
	enqueueOwnerPrompts,
	type OwnerQueuePort,
} from "../../../../core/mixcode/batch/batch-lifecycle.ts";
import { loadBatchRequests } from "../../../../core/mixcode/batch/batch-loader.ts";
import {
	catalogModelToInfo,
	catalogModelToResolved,
	resolveBatchModel,
} from "../../../../core/mixcode/batch/batch-models.ts";
import { applyBatchRequests, formatBatchPlan } from "../../../../core/mixcode/batch/batch-plan.ts";
import type {
	BatchContext,
	BatchExecutorHost,
	BatchResolvedModel,
	BatchTabConfig,
} from "../../../../core/mixcode/batch/types.ts";
import { applyContextLimitToSession, parseContextLimitValue } from "../../../../core/mixcode/context-limit.ts";
import type { FollowUpHost } from "../../../../core/mixcode/follow-up/runtime-follow-up.ts";
import {
	createFollowUpQueueState,
	type FollowUpQueueState,
} from "../../../../core/mixcode/follow-up/runtime-follow-up-queue.ts";
import type { AgentTab, TabManager } from "../../../../core/mixcode/multi-tab/tab-manager.ts";
import { isTabColorName } from "../../../../core/mixcode/multi-tab/types.ts";
import { findExactModelReferenceMatch } from "../../../../core/model-resolver.ts";
import { BUILTIN_SLASH_COMMANDS } from "../../../../core/slash-commands.ts";

/** One row of the host model catalog, as `getAvailableSnapshot()` reports it. */
type CatalogModel = Model<Api>;

/** The interactive-mode surface the batch adapter needs. */
export interface BatchCommandHost {
	/** Tab fleet, or undefined when this instance runs without multi-tab. */
	readonly tabManager: TabManager | undefined;
	/** True while the Home surface owns the keyboard. */
	readonly homeActive: boolean;
	/** Workdir that scopes an invocation started from Home. */
	readonly homeWorkdir: string;
	/** Per-tab follow-up queues, keyed by tab id. */
	readonly followUpStates: Map<string, FollowUpQueueState>;
	/** Sessions whose extensions bound successfully, or undefined before the first bind. */
	readonly boundSessions: WeakSet<AgentSession> | undefined;
	/** True while a manual compaction was claimed but has not settled. */
	readonly compactionClaimed: boolean;
	/** Bind a tab's extensions, resolving only after the bind settled. */
	bindTabExtensions(tab: AgentTab): Promise<void>;
	/** Bring a tab on screen through the host's serialized switch path. */
	showTab(tab: AgentTab): Promise<void>;
	/** Rebuild a tab's transcript after a batch request emptied its session in place. */
	resyncTabTranscript(tab: AgentTab): void;
	/** Run `run` inside the owning tab's console scope. */
	withTabConsole<T>(tab: AgentTab | undefined, run: () => Promise<T>): Promise<T>;
	/** Repaint the frame after a queue or status change. */
	requestRender(): void;
	showError(message: string): void;
	showStatus(message: string): void;
}

/**
 * Split a `/batch` argument string into the script path and its arguments.
 *
 * Quotes group literal arguments and a backslash escapes outside single quotes;
 * empty quoted arguments survive. A leading `@` on the script is the editor's
 * file-autocomplete prefix, not part of the path. Unclosed quotes, a trailing
 * escape, and a missing `--` separator fail before any script loads.
 */
export function parseBatchArguments(input: string): { file: string; args: string[] } {
	const tokens: string[] = [];
	let token = "";
	let started = false;
	let quote: "'" | '"' | undefined;
	for (let index = 0; index < input.length; index += 1) {
		const char = input[index]!;
		if (char === "\\" && quote !== "'") {
			index += 1;
			if (index >= input.length) throw new Error("Error: Invalid batch arguments: trailing escape");
			token += input[index];
			started = true;
		} else if (quote) {
			if (char === quote) quote = undefined;
			else token += char;
		} else if (char === "'" || char === '"') {
			quote = char;
			started = true;
		} else if (/\s/.test(char)) {
			if (started) tokens.push(token);
			token = "";
			started = false;
		} else {
			token += char;
			started = true;
		}
	}
	if (quote) throw new Error("Error: Invalid batch arguments: unclosed quote");
	if (started) tokens.push(token);
	const [fileToken, separator, ...args] = tokens;
	const file = fileToken?.startsWith("@") ? fileToken.slice(1) : fileToken;
	if (!file || file === "--" || (separator !== undefined && separator !== "--")) {
		throw new Error("Error: Usage: /batch <script> [-- <args...>]");
	}
	return { file, args };
}

/** Handle a `/batch` submission: parse the arguments, then run the script. */
export async function handleBatchCommand(host: BatchCommandHost, rawArgs: string): Promise<void> {
	let parsed: { file: string; args: string[] };
	try {
		parsed = parseBatchArguments(rawArgs);
	} catch (error) {
		host.showError(error instanceof Error ? error.message : String(error));
		return;
	}
	await runBatchFile(host, parsed.file, parsed.args);
}

/** Queue state for one tab; every tab owns its own queue. */
export function followUpStateFor(host: BatchCommandHost, tabId: string): FollowUpQueueState {
	let state = host.followUpStates.get(tabId);
	if (!state) {
		state = createFollowUpQueueState();
		host.followUpStates.set(tabId, state);
	}
	return state;
}

/** Owner-scoped follow-up host: rounds dispatch into `tabId`, not the focused tab. */
export function batchFollowUpHostFor(host: BatchCommandHost, tabId: string): FollowUpHost {
	const requireTab = (id: string): AgentTab => {
		const tab = host.tabManager?.get(id);
		if (!tab) throw new Error(`Error: Batch tab is closed: ${id}`);
		return tab;
	};
	const port: OwnerQueuePort = {
		ownerSession: (id) => host.tabManager?.get(id)?.runtime.session,
		promptOwner: (id, text, preflightResult) => {
			const tab = requireTab(id);
			return host.withTabConsole(tab, () => tab.runtime.session.prompt(text, { preflightResult }));
		},
		runOwnerCommand: (id, text) => dispatchBatchOwnerInput(host, requireTab(id), text),
		isOwnerCommandText: (id, text) => {
			const session = host.tabManager?.get(id)?.runtime.session;
			return session ? isQueuedFollowUpCommandFor(session, text) : false;
		},
		isCompactionClaimed: () => host.compactionClaimed,
		onQueueChanged: () => host.requestRender(),
		onQueueError: (error) => {
			host.showError(error instanceof Error ? error.message : `Batch queue failed: ${String(error)}`);
		},
		isDiscarded: (id) => host.followUpStates.get(id) === undefined,
	};
	return createOwnerFollowUpHost(port, tabId);
}

/** Bind a tab's extensions if needed, then require the bind to have succeeded. */
async function ensureTabExtensionsBound(host: BatchCommandHost, tab: AgentTab): Promise<void> {
	if (host.boundSessions?.has(tab.runtime.session)) return;
	await host.bindTabExtensions(tab);
	if (!host.boundSessions?.has(tab.runtime.session)) {
		throw new Error(`Error: Batch tab '${tab.title}' failed to initialize extensions`);
	}
}

/** Queue a tab's prompts as owner-scoped rounds that do not block the script. */
export async function enqueueBatchPrompts(
	host: BatchCommandHost,
	tab: AgentTab,
	prompts: readonly string[],
): Promise<void> {
	await ensureTabExtensionsBound(host, tab);
	await enqueueOwnerPrompts(followUpStateFor(host, tab.id), batchFollowUpHostFor(host, tab.id), prompts);
}

/**
 * Dispatch one batch input through its owner tab. A tab-scoped local command runs
 * on that tab; a nested `/batch` is rejected; a skill, template, extension
 * command, or unmatched text runs through the owner session, which executes
 * registered extension commands itself and treats unmatched slash input as
 * message text.
 */
export async function dispatchBatchOwnerInput(host: BatchCommandHost, tab: AgentTab, input: string): Promise<void> {
	const trimmed = input.trim();
	if (trimmed === "/batch" || trimmed.startsWith("/batch ")) {
		throw new Error("Error: Nested /batch is not supported");
	}
	if (await runOwnerLocalCommand(host, tab, trimmed)) return;
	await ensureTabExtensionsBound(host, tab);
	await host.withTabConsole(tab, async () => {
		const streamingBehavior = tab.runtime.session.isStreaming ? "followUp" : undefined;
		await tab.runtime.session.prompt(input, streamingBehavior ? { streamingBehavior } : undefined);
	});
}

/**
 * Run a tab-scoped local command on its owner tab, returning true when handled.
 * Only commands whose whole effect lives on one tab are handled: the ones that
 * open a selector, replace the session, or drive the visible chrome stay out,
 * because a background tab has no interactive surface to run them on. A builtin
 * outside both sets fails loudly instead of being sent to the model as text.
 */
export async function runOwnerLocalCommand(host: BatchCommandHost, tab: AgentTab, text: string): Promise<boolean> {
	if (!text.startsWith("/")) return false;
	const match = /^\/(\S+)(?:\s+([\s\S]*))?$/.exec(text);
	const name = match?.[1];
	if (!name) return false;
	const args = (match?.[2] ?? "").trim();
	const session = tab.runtime.session;
	switch (name) {
		case "color": {
			const manager = host.tabManager;
			if (!manager) throw new Error("Error: /color requires multi-tab runtime support");
			if (args === "clear") manager.setColor(tab.id, undefined);
			else if (isTabColorName(args)) manager.setColor(tab.id, args);
			else throw new Error(`Error: Unknown tab color: ${args}`);
			return true;
		}
		case "name":
		case "rename": {
			if (!args) throw new Error(`Error: Usage: /${name} <name>`);
			session.setSessionName(args);
			host.tabManager?.rename(tab.id, session.sessionManager.getSessionName() ?? args);
			return true;
		}
		case "reset": {
			await session.resetLeafToRoot();
			host.resyncTabTranscript(tab);
			return true;
		}
		case "model": {
			const model = findExactModelReferenceMatch(args, [...session.modelRuntime.getAvailableSnapshot()]);
			if (!model) throw new Error(`Error: Unknown model: ${args}`);
			await session.setModel(model, { persist: false });
			return true;
		}
		case "thinking": {
			if (!THINKING_LEVEL_OPTIONS.includes(args as ThinkingLevel)) {
				throw new Error(`Error: Unknown thinking level: ${args}`);
			}
			session.setThinkingLevel(args as ThinkingLevel, { persist: false });
			return true;
		}
		case "context-limit": {
			const value = parseContextLimitValue(args);
			if (value === undefined) throw new Error("Error: Usage: /context-limit <tokens|reset>");
			applyContextLimitToSession(tab, value, session);
			return true;
		}
		case "compact": {
			await session.compact(args || undefined);
			return true;
		}
		default:
			break;
	}
	if (BUILTIN_SLASH_COMMANDS.some((command) => command.name === name)) {
		throw new Error(`Error: /${name} is not supported on a background batch tab`);
	}
	return false;
}

/** True when a slash/skill/template/builtin text must run host-side, for this session. */
export function isQueuedFollowUpCommandFor(session: AgentSession, text: string): boolean {
	if (!text.startsWith("/")) return false;
	const commandName = /^\/(\S+)/.exec(text)?.[1];
	if (commandName === undefined) return false;
	if (commandName.startsWith("skill:")) return true;
	if (BUILTIN_SLASH_COMMANDS.some((command) => command.name === commandName)) return true;
	if (session.extensionRunner.getCommand(commandName)) return true;
	return session.promptTemplates.some((template) => template.name === commandName);
}

/** The invocation snapshot a script reads: the tab fleet and the model catalog. */
function buildSnapshot(input: {
	manager: TabManager;
	workdir: string;
	args: string[];
	catalog: readonly CatalogModel[];
	defaultProvider: string;
}): BatchContext {
	return {
		workdir: input.workdir,
		tabs: input.manager.list().map((tab) => ({
			name: tab.title,
			sessionId: tab.id,
			workdir: tab.runtime.cwd,
			model: `${tab.runtime.session.model?.provider ?? ""}/${tab.runtime.session.model?.id ?? ""}`,
			thinking: tab.runtime.session.thinkingLevel,
			status: tab.status,
		})),
		models: input.catalog.map(catalogModelToInfo),
		defaultProvider: input.defaultProvider,
		args: input.args,
	};
}

/** Resolve a script's model reference against the invocation catalog. */
function resolveModelReference(
	query: string,
	context: BatchContext,
	catalog: readonly CatalogModel[],
): BatchResolvedModel {
	const resolved = resolveBatchModel(query, context);
	const model = catalog.find(
		(candidate) => candidate.provider === resolved.provider && candidate.id === resolved.modelId,
	);
	if (!model) throw new Error(`Error: Batch model is unavailable: ${query}`);
	return catalogModelToResolved(model);
}

/**
 * Apply a request's model, thinking level, and context limit to a tab.
 *
 * A workdir is only accepted when it matches the tab's own: moving an existing
 * session to another directory is not supported by the batch path.
 */
async function applyTabConfig(tab: AgentTab, config: BatchTabConfig, catalog: readonly CatalogModel[]): Promise<void> {
	if (config.workdir !== undefined && path.resolve(tab.runtime.cwd) !== path.resolve(config.workdir)) {
		throw new Error("Error: changing an existing batch tab workdir is not supported");
	}
	if (config.model) {
		const model = catalog.find(
			(candidate) => candidate.provider === config.model!.provider && candidate.id === config.model!.modelId,
		);
		if (!model) throw new Error(`Error: Batch model is unavailable: ${config.model.id}`);
		await tab.runtime.session.setModel(model, { persist: false });
	}
	if (config.thinking) tab.runtime.session.setThinkingLevel(config.thinking, { persist: false });
	if (config.contextLimit !== undefined) applyContextLimitToSession(tab, config.contextLimit, tab.runtime.session);
}

/** The tab the invocation is anchored on: its model resolves bare ids and its workdir the script path. */
function anchorTab(manager: TabManager): { tab: AgentTab; model: BatchResolvedModel } | undefined {
	const tab = manager.getActive();
	const model = tab.runtime.session.model;
	return model ? { tab, model: catalogModelToResolved(model) } : undefined;
}

/** Build the executor host: the tab operations a batch plan needs, bound to one invocation. */
function createExecutorHost(input: {
	host: BatchCommandHost;
	manager: TabManager;
	context: BatchContext;
	catalog: readonly CatalogModel[];
	anchorModel: BatchResolvedModel;
}): BatchExecutorHost {
	const { host, manager, context, catalog, anchorModel } = input;
	const findTab = (title: string): AgentTab | undefined =>
		manager.list().find((candidate) => candidate.title === title);
	const requireTab = (sessionId: string): AgentTab => {
		const tab = manager.get(sessionId);
		if (!tab) throw new Error(`Error: Batch tab is closed: ${sessionId}`);
		return tab;
	};
	// A new tab is configured before its extensions bind, so `session_start` sees the
	// requested model/thinking; the bind must settle before the name is persisted and
	// the tab is shown, so a failed setup never looks like a ready batch tab.
	const lifecyclePort: BatchLifecyclePort<AgentTab> = {
		createRawTab: (request) => manager.createTab({ title: request.name, workdir: request.workdir }),
		configureTab: (tab, config) => applyTabConfig(tab, config, catalog),
		bindExtensions: (tab) => host.bindTabExtensions(tab),
		isExtensionsBound: (tab) => host.boundSessions?.has(tab.runtime.session) ?? false,
		persistSessionName: (tab, name) => tab.runtime.session.setSessionName(name),
		lockTitle: (tab, name) => manager.lockTitle(tab.id, name),
		showTab: (tab) => host.showTab(tab),
	};
	return {
		defaultModel: anchorModel,
		findTabByTitle: (title) => {
			const tab = findTab(title);
			return tab ? { sessionId: tab.id } : undefined;
		},
		resolveModelByTitle: (title) => {
			const model = findTab(title)?.runtime.session.model;
			return model ? catalogModelToResolved(model) : undefined;
		},
		tabExists: (title) => Boolean(findTab(title)),
		createNewTab: async (request) => {
			if (request.systemPrompt !== undefined) {
				throw new Error("Error: systemPrompt is not supported for TUI batch tabs yet");
			}
			const config: BatchTabConfig = {};
			if (request.model) config.model = resolveModelReference(request.model, context, catalog);
			if (request.thinking) config.thinking = request.thinking as ThinkingLevel;
			if (request.contextLimit !== undefined) config.contextLimit = request.contextLimit;
			const tab = await createBatchTab(lifecyclePort, request, config);
			return tab.id;
		},
		configureTab: (sessionId, config) => applyTabConfig(requireTab(sessionId), config, catalog),
		clearTab: async (sessionId) => {
			const tab = requireTab(sessionId);
			await tab.runtime.session.resetLeafToRoot();
			// `resetLeafToRoot()` empties the session in place, so a transcript mounted on
			// this tab is now stale.
			host.resyncTabTranscript(tab);
		},
		deleteTab: async (sessionId) => {
			const result = await manager.deleteTab(sessionId);
			if (!result.ok) throw new Error(`Error: ${result.error ?? "Could not delete batch tab"}`);
		},
		submitInput: (sessionId, text) => dispatchBatchOwnerInput(host, requireTab(sessionId), text),
		queuePrompts: (sessionId, prompts) => enqueueBatchPrompts(host, requireTab(sessionId), prompts),
		resolveModel: (query) => resolveModelReference(query, context, catalog),
	};
}

/**
 * Execute one batch script against the current tab fleet. `/batch` and the CLI
 * `--batch` flag both land here, so a script never round-trips through a
 * reconstructed command string and its arguments keep their exact text.
 */
export async function runBatchFile(host: BatchCommandHost, file: string, args: string[]): Promise<void> {
	const manager = host.tabManager;
	if (!manager) {
		host.showError("Error: /batch requires multi-tab runtime support");
		return;
	}
	const anchor = anchorTab(manager);
	if (!anchor) {
		host.showError("Error: /batch requires an active model");
		return;
	}
	const workdir = host.homeActive ? host.homeWorkdir : anchor.tab.runtime.cwd;
	const catalog = anchor.tab.runtime.session.modelRuntime.getAvailableSnapshot();
	const context = buildSnapshot({ manager, workdir, args, catalog, defaultProvider: anchor.model.provider });
	const executorHost = createExecutorHost({
		host,
		manager,
		context,
		catalog,
		anchorModel: anchor.model,
	});

	try {
		const plan = await loadBatchRequests(path.resolve(workdir, file), context);
		// Script workdirs are relative to the invocation directory, so the tab opens where the script asked.
		const requests = plan.requests.map((request) => ({
			...request,
			...(request.workdir ? { workdir: path.resolve(workdir, request.workdir) } : {}),
		}));
		await applyBatchRequests(requests, executorHost);
		host.requestRender();
		host.showStatus(formatBatchPlan({ requests }));
	} catch (error) {
		host.showError(error instanceof Error ? error.message : String(error));
	}
}
