/**
 * Follow-up drain, steer flush, and queue pop.
 *
 * Rounds dispatch FIFO once the session is idle: each round is one prompt turn
 * (batch entries joined with a blank line), a failed run pauses the queue, and
 * the steer queue can be flushed into an immediate turn without promoting
 * follow-up rounds.
 */

import {
	attachFollowUpCommand,
	FOLLOW_UP_BATCH_FLAG,
	type FollowUpInput,
	type FollowUpQueueEntry,
	type FollowUpQueueState,
	followUpCommand,
	pauseFollowUps,
	type QueueKind,
	syncFollowUpPreview,
	takeFollowUpBatch,
} from "./runtime-follow-up-queue.ts";

/** Session surface the follow-up queue needs; AgentSession satisfies it. */
export interface FollowUpSession {
	readonly isIdle: boolean;
	readonly isStreaming: boolean;
	readonly isCompacting: boolean;
	waitForIdle(): Promise<void>;
	subscribe(listener: (event: { type: string }) => void): () => void;
	getSteeringMessages(): readonly string[];
	getFollowUpMessages(): readonly string[];
	removeQueuedMessages(kind: QueueKind, texts: readonly string[]): Array<{ message: unknown; text: string }>;
	restoreQueuedMessages(kind: QueueKind, removed: ReadonlyArray<{ message: unknown; text: string }>): void;
}

/** Removed SDK queue entry, kept for restore when a flush fails. */
export type RemovedQueuedMessage = ReturnType<FollowUpSession["removeQueuedMessages"]>[number];

/** Host integration surface: session access plus UI effects. */
export interface FollowUpHost {
	/** Session to dispatch against; re-read each turn so a rebound session is picked up. */
	readonly session: FollowUpSession;
	/** Run one idle prompt turn; preflightResult reports whether text was delivered. */
	promptTurn(text: string, preflightResult: (accepted: boolean) => void): Promise<void>;
	/** Execute a queued command text host-side (resubmit through the input pipeline). */
	runQueuedCommand(text: string): Promise<void>;
	/** True when a queued slash/skill/template text should run host-side. */
	isQueuedCommandText(text: string): boolean;
	/** True while a manual compaction was claimed but has not settled yet. */
	isCompactionClaimed(): boolean;
	/** Queue display changed; refresh and re-render. */
	onQueueChanged(): void;
	/** Report an asynchronous queue failure to the user. */
	onQueueError(error: unknown): void;
	/** True once the owning conversation is gone (shutdown); ends any drain. */
	isDiscarded(): boolean;
}

/**
 * Serialize prompt dispatch decisions at idle→active transitions. Acquires the
 * state gate, executes send(), releases the gate when preflightResult fires.
 * Prevents concurrent session.prompt() calls from racing through isStreaming checks.
 */
export async function dispatchTurn(
	state: FollowUpQueueState,
	send: (signalRegistered: () => void) => Promise<void>,
): Promise<void> {
	const prev = state.promptDispatchGate ?? Promise.resolve();
	let releaseGate: () => void = () => {};
	const promise = new Promise<void>((resolve) => {
		releaseGate = resolve;
	});
	state.promptDispatchGate = promise;
	await prev.catch(() => {}); // Wait for previous dispatch to register
	try {
		let done = false;
		const signalRegistered = () => {
			if (!done) {
				done = true;
				releaseGate();
			}
		};
		try {
			await send(signalRegistered);
		} finally {
			signalRegistered(); // Ensure release on steer/early-exit paths
		}
	} catch (error) {
		releaseGate(); // Release on exception
		throw error;
	}
}

const COMPACTION_CLAIM_TICKS = 8;

function nextMacrotask(): Promise<void> {
	return new Promise((resolve) => setImmediate(resolve));
}

/**
 * Let a claimed manual compaction take the session before dispatching. The SDK
 * sets isCompacting only after an internal await, so the claim flag bridges the
 * gap; a claim that settles without compaction releases after a few ticks.
 */
async function waitForClaimSettle(session: FollowUpSession, host: FollowUpHost): Promise<void> {
	for (let tick = 0; tick < COMPACTION_CLAIM_TICKS; tick += 1) {
		if (session.isCompacting) break;
		if (!host.isCompactionClaimed()) return;
		await nextMacrotask();
	}
	if (session.isCompacting) await waitForCompactionIdle(session);
}

/** Wait out an in-flight compaction; queued rounds never dispatch mid-compaction. */
export async function waitForCompactionIdle(session: FollowUpSession): Promise<void> {
	if (!session.isCompacting) return;
	await new Promise<void>((resolve) => {
		const unsubscribe = session.subscribe((event) => {
			if (event.type !== "compaction_end") return;
			unsubscribe();
			resolve();
		});
		if (!session.isCompacting) {
			unsubscribe();
			resolve();
		}
	});
}

/**
 * Append validated nonempty inputs as follow-up rounds. The whole sequence is
 * visible before dispatch starts; command entries carry host executors.
 */
export function appendFollowUps(
	state: FollowUpQueueState,
	host: FollowUpHost,
	prompts: readonly FollowUpInput[],
	kind: "batch" | "next",
): void {
	for (const prompt of prompts) {
		if (typeof prompt !== "string") {
			const entry: FollowUpQueueEntry = { text: prompt.text.trim(), kind, command: true };
			attachFollowUpCommand(entry, prompt.execute);
			state.followUpQueue.push(entry);
			continue;
		}
		const text = prompt.trim();
		if (!text) continue;
		if (host.isQueuedCommandText(text)) {
			const entry: FollowUpQueueEntry = { text, kind, command: true };
			attachFollowUpCommand(entry, () => host.runQueuedCommand(text));
			state.followUpQueue.push(entry);
			continue;
		}
		state.followUpQueue.push({ text, kind });
	}
	syncFollowUpPreview(state, host.session.getFollowUpMessages());
	host.onQueueChanged();
}

/** Queue follow-up rounds and (when idle) await their drain. */
export async function submitFollowUps(
	state: FollowUpQueueState,
	host: FollowUpHost,
	prompts: readonly FollowUpInput[],
	kind: "batch" | "next",
): Promise<void> {
	appendFollowUps(state, host, prompts, kind);
	await startFollowUpDrain(state, host, true);
}

/** Interactive submissions await idle execution; appended sequences only enqueue. */
export async function startFollowUpDrain(
	state: FollowUpQueueState,
	host: FollowUpHost,
	waitWhenIdle: boolean,
): Promise<void> {
	const alreadyDraining = state.followUpDrain !== undefined;
	const busy = !host.session.isIdle || host.session.isCompacting || host.isCompactionClaimed() || alreadyDraining;
	const drain = drainFollowUps(state, host);
	if (waitWhenIdle && !busy) await drain;
	else if (!alreadyDraining) {
		void drain.catch((error: unknown) => host.onQueueError(error));
	}
}

/** Un-pause and resume a drained queue; errors when nothing is queued. */
export async function resumeFollowUps(state: FollowUpQueueState, host: FollowUpHost): Promise<void> {
	if (state.followUpQueue.length === 0) {
		throw new Error("No follow-up messages to resume");
	}
	state.followUpsPaused = false;
	// Resume can arrive from a settled notification before the previous drain
	// unwinds. Acknowledge that failure now so its completion cannot pause this
	// queue again.
	state.followUpRunFailed = false;
	host.onQueueChanged();
	await startFollowUpDrain(state, host, true);
}

export function drainFollowUps(state: FollowUpQueueState, host: FollowUpHost): Promise<void> {
	if (state.followUpDrain) return state.followUpDrain;
	if (state.followUpsPaused || state.followUpQueue.length === 0) return Promise.resolve();
	const queue = state.followUpQueue;
	const ownsQueue = () => !host.isDiscarded() && state.followUpQueue === queue;
	// Defer entry so ownership is installed before preflight or lifecycle callbacks run.
	const drain = Promise.resolve()
		.then(async () => {
			while (ownsQueue() && queue.length > 0 && !state.followUpsPaused) {
				// A conversation reset or workdir change may rebind the session
				// while retaining this logical queue. Capture per iteration; a
				// discarded queue ends ownership.
				const session = host.session;
				await session.waitForIdle();
				await waitForCompactionIdle(session);
				await waitForClaimSettle(session, host);
				if (!ownsQueue()) return;
				if (host.session !== session) continue;
				await dispatchTurn(state, async (signalRegistered) => {
					// A concurrent ordinary prompt may claim the session while this dispatch waits.
					if (!session.isIdle || state.followUpsPaused || host.session !== session || !ownsQueue()) {
						return;
					}
					const batch = takeFollowUpBatch(state, session.getFollowUpMessages());
					if (batch.length === 0) return;
					let accepted = false;
					host.onQueueChanged();
					try {
						const executeCommand = followUpCommand(batch[0]!);
						if (executeCommand) {
							// Commands may start their own prompt or compaction. Release preflight
							// ownership before calling the host so nested dispatch cannot deadlock.
							accepted = true;
							signalRegistered();
							await executeCommand();
							return;
						}
						await host.promptTurn(batch.map((entry) => entry.text).join("\n\n"), (value) => {
							accepted = value;
							signalRegistered();
						});
						await session.waitForIdle();
						if (state.followUpRunFailed) pauseFollowUps(state);
					} catch (error) {
						// Failed preflight has not delivered user text; preserve it for explicit retry.
						if (!accepted && ownsQueue()) queue.unshift(...batch);
						if (ownsQueue()) pauseFollowUps(state);
						throw error;
					} finally {
						if (ownsQueue()) {
							syncFollowUpPreview(state, host.session.getFollowUpMessages());
							host.onQueueChanged();
						}
					}
				});
			}
		})
		.finally(() => {
			if (state.followUpDrain === drain) state.followUpDrain = undefined;
			// Manual compaction may finish while the old drain is returning from its guard.
			if (
				ownsQueue() &&
				host.session.isIdle &&
				!host.session.isCompacting &&
				!state.followUpsPaused &&
				state.followUpQueue.length > 0
			) {
				void drainFollowUps(state, host).catch((error: unknown) => host.onQueueError(error));
			}
		});
	state.followUpDrain = drain;
	return drain;
}

/**
 * Flush the steer queue (send now). Follow-up rounds must survive: this must
 * not promote a "wait until idle" round into an immediate prompt.
 *
 * Steer texts live in `state.pendingSteer` (parked texts first, SDK-mirrored
 * texts last, `queuedSteerCount` counting the mirrored tail). The flush drains
 * the requested tail, removes mirrored texts from the SDK steering queue before
 * awaiting idle, and restores everything if dispatch fails.
 */
export async function flushSteerQueue(state: FollowUpQueueState, host: FollowUpHost, count?: number): Promise<void> {
	const session = host.session;
	const total = state.pendingSteer.length;
	const start = count === undefined ? 0 : Math.max(0, total - count);
	const items = state.pendingSteer.splice(start, total - start);
	// Remove mirrored texts from the SDK queue BEFORE awaiting idle. On the
	// abort path the run is still parked on a tool call; awaiting first lets the
	// aborting loop drain these into the dying turn, so the flush would find
	// nothing and the agent would just stop. Parked texts never entered the SDK
	// queue and are skipped by the exact-text match.
	let removedSteering: RemovedQueuedMessage[] = [];
	try {
		removedSteering = session.removeQueuedMessages("steering", items);
		state.queuedSteerCount = Math.max(0, state.queuedSteerCount - removedSteering.length);
		host.onQueueChanged();
		if (session.isStreaming) {
			await session.waitForIdle();
		}
		const text = items.filter((item) => item.trim()).join("\n\n");
		if (!text) return;
		await dispatchTurn(state, async (signalRegistered) => {
			await host.promptTurn(text, signalRegistered);
		});
	} catch (error) {
		state.pendingSteer.splice(start, 0, ...items);
		state.queuedSteerCount += removedSteering.length;
		session.restoreQueuedMessages("steering", removedSteering);
		host.onQueueChanged();
		throw error;
	}
}

/** Pop one queued message of the requested kind for editor revision. */
export function popQueuedMessage(state: FollowUpQueueState, host: FollowUpHost, kind: QueueKind): string | undefined {
	const session = host.session;
	if (kind === "followUp" && session.getFollowUpMessages().length === 0) {
		const entry = state.followUpQueue.pop();
		if (entry) {
			syncFollowUpPreview(state, session.getFollowUpMessages());
			host.onQueueChanged();
			if (entry.kind === "next") return `/follow-up ${entry.text}`;
			return entry.command ? `/follow-up ${FOLLOW_UP_BATCH_FLAG} ${entry.text}` : entry.text;
		}
	}
	const messages = kind === "followUp" ? state.pendingFollowUps : state.pendingSteer;
	const wasMirrored = kind === "followUp" ? state.queuedFollowUpCount > 0 : state.queuedSteerCount > 0;
	const message = messages.pop();
	if (message === undefined || !wasMirrored) return message;

	if (kind === "followUp") {
		state.queuedFollowUpCount = Math.max(0, state.queuedFollowUpCount - 1);
	} else {
		state.queuedSteerCount = Math.max(0, state.queuedSteerCount - 1);
	}
	// Parked (compaction) texts never entered the SDK queue. removeQueuedMessages
	// would skip them anyway; calling it only when the text is mirrored keeps the
	// queue_update event from announcing an unchanged queue.
	const sdkQueue = kind === "followUp" ? session.getFollowUpMessages() : session.getSteeringMessages();
	if (sdkQueue.includes(message)) {
		session.removeQueuedMessages(kind, [message]);
	}
	return message;
}
