/**
 * Batch tab lifecycle and owner-scoped prompt queue.
 *
 * `applyBatchRequests` calls `createNewTab` and then `configureTab` for a new
 * tab. In the TUI a tab's extensions bind `session_start` asynchronously, so the
 * requested model/thinking/context must be applied before the bind, the bind
 * must succeed before the requested name is persisted or the tab is shown, and
 * the visible focus must follow the runtime the commands dispatch into. This
 * module owns that order so the CLI host and the TUI host cannot drift.
 *
 * The same ownership rule applies to the queued `prompts` sequence: rounds and
 * host commands dispatch into the tab that queued them, through that tab's
 * session, not whichever tab is focused when the drain runs.
 */
import type { AgentSession } from "../../agent-session.ts";
import type { FollowUpHost } from "../follow-up/runtime-follow-up.ts";
import { appendFollowUps, startFollowUpDrain } from "../follow-up/runtime-follow-up.ts";
import type { FollowUpQueueState } from "../follow-up/runtime-follow-up-queue.ts";
import type { BatchTabConfig, BatchTabRequest } from "./types.ts";

/** Minimal tab view the lifecycle needs; `AgentTab` satisfies it. */
export interface BatchLifecycleTab {
	id: string;
	title: string;
	runtime: { session: AgentSession; cwd: string };
}

/** Host primitives for the tab lifecycle; the interactive mode implements each. */
export interface BatchLifecyclePort<TTab extends BatchLifecycleTab = BatchLifecycleTab> {
	/** Create the tab (and its runtime) without configuring, binding, or naming it. */
	createRawTab(request: BatchTabRequest): Promise<TTab>;
	/** Apply the request's model, thinking level, and context limit to the tab. */
	configureTab(tab: TTab, config: BatchTabConfig): Promise<void>;
	/** Bind the tab's extensions, resolving only after the bind settled. */
	bindExtensions(tab: TTab): Promise<void>;
	/** True once the tab's extensions bound successfully. */
	isExtensionsBound(tab: TTab): boolean;
	/** Persist the requested name onto the tab's session. */
	persistSessionName(tab: TTab, name: string): void;
	/** Mark the tab title as explicit, so session renames cannot overwrite it. */
	lockTitle(tab: TTab, name: string): void;
	/** Bring the tab on screen through the host's serialized switch path. */
	showTab(tab: TTab): Promise<void>;
}

/**
 * Create one batch tab in the order the runtime requires: create, configure,
 * bind (and require the bind to succeed), persist the requested name, lock the
 * title, then show the tab. A bind that fails leaves the tab visible in its
 * error state but aborts the request before the name is persisted or the tab is
 * shown, so a failed setup never looks like a ready batch tab.
 */
export async function createBatchTab<TTab extends BatchLifecycleTab>(
	port: BatchLifecyclePort<TTab>,
	request: BatchTabRequest,
	config: BatchTabConfig,
): Promise<TTab> {
	const tab = await port.createRawTab(request);
	await port.configureTab(tab, config);
	await port.bindExtensions(tab);
	if (!port.isExtensionsBound(tab)) {
		throw new Error(`Error: Batch tab '${request.name}' failed to initialize extensions`);
	}
	port.persistSessionName(tab, request.name);
	port.lockTitle(tab, request.name);
	await port.showTab(tab);
	return tab;
}

/**
 * Host primitives for one owner-scoped queue. `tabId` is captured by the host
 * built below, so a drain keeps dispatching into the owning tab even after the
 * visible focus moved elsewhere.
 */
import type { PromptDisposition } from "../../agent-session.ts";

export interface OwnerQueuePort {
	/** Session that owns the queue, or undefined once its tab is gone. */
	ownerSession(tabId: string): AgentSession | undefined;
	/** Run one queued command host-side (local command, extension command, builtin). */
	runOwnerCommand(tabId: string, text: string): Promise<void>;
	/** True when the text must run host-side instead of as a model turn. */
	isOwnerCommandText(tabId: string, text: string): boolean;
	/** Run one idle prompt turn on the owner session. */
	promptOwner(tabId: string, text: string, preflightResult: (disposition: PromptDisposition) => void): Promise<void>;
	/** True while a manual compaction was claimed but has not settled. */
	isCompactionClaimed(): boolean;
	/** Queue display changed; refresh and re-render. */
	onQueueChanged(): void;
	/** Report an asynchronous queue failure. */
	onQueueError(error: unknown): void;
	/** True once the owning conversation is gone. */
	isDiscarded(tabId: string): boolean;
}

/** Build the owner-scoped `FollowUpHost` the follow-up core drains. */
export function createOwnerFollowUpHost(port: OwnerQueuePort, tabId: string): FollowUpHost {
	const requireSession = (): AgentSession => {
		const session = port.ownerSession(tabId);
		if (!session) throw new Error(`Follow-up owner tab is gone: ${tabId}`);
		return session;
	};
	return {
		get session() {
			return requireSession();
		},
		promptTurn: (text, preflightResult) => port.promptOwner(tabId, text, preflightResult),
		runQueuedCommand: (text) => port.runOwnerCommand(tabId, text),
		isQueuedCommandText: (text) => port.isOwnerCommandText(tabId, text),
		isCompactionClaimed: () => port.isCompactionClaimed(),
		onQueueChanged: () => port.onQueueChanged(),
		onQueueError: (error) => port.onQueueError(error),
		isDiscarded: () => port.isDiscarded(tabId),
	};
}

/**
 * Append validated prompts as owner-scoped follow-up rounds and start the drain
 * without awaiting it. The queue is visible before execution starts, and a
 * script's later mutations never wait on a model turn.
 */
export async function enqueueOwnerPrompts(
	state: FollowUpQueueState,
	host: FollowUpHost,
	prompts: readonly string[],
): Promise<void> {
	const inputs: string[] = prompts.filter((text) => text.trim().length > 0);
	if (inputs.length === 0) return;
	appendFollowUps(state, host, inputs, "batch");
	await startFollowUpDrain(state, host, false);
}
