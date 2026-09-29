/**
 * Host-side follow-up queue state and helpers.
 *
 * User follow-ups queue here as rounds (a "next" entry runs as its own turn,
 * adjacent "batch" entries merge into one) instead of the SDK follow-up queue,
 * which only carries SDK-owned continuation companions (retry/compaction) and is
 * shown appended after the local rounds.
 */

/** Queued follow-up entry. `kind` groups entries into dispatch rounds. */
export interface FollowUpQueueEntry {
	text: string;
	kind: "batch" | "next";
	/** Host-owned local command entry; executes without a model turn. */
	command?: true;
}

export type QueueKind = "steering" | "followUp";

/**
 * Queue bookkeeping state. Mirrors the follow-up fields of the host runtime:
 * the local follow-up rounds, their public preview, pause state, the SDK queue
 * mirror counts, and the single in-flight drain promise.
 */
export interface FollowUpQueueState {
	/** Local rounds awaiting dispatch, in submission order. */
	followUpQueue: FollowUpQueueEntry[];
	/** Display list: local queue texts first, then SDK companion texts. */
	pendingFollowUps: string[];
	/** Steer preview: parked texts first, then SDK-mirrored steering texts. */
	pendingSteer: string[];
	/** Paused rounds stay queued until an explicit /follow-up resumes them. */
	followUpsPaused: boolean;
	/** Number of steering texts mirrored from the SDK steering queue. */
	queuedSteerCount: number;
	/** Number of follow-up texts mirrored from the SDK follow-up queue. */
	queuedFollowUpCount: number;
	/** In-flight drain promise; a new drain joins or defers to it. */
	followUpDrain?: Promise<void>;
	/** Set when the latest run failed; pauses the queue when it settles. */
	followUpRunFailed?: boolean;
	/** Serializes prompt dispatches (drain, flush, queued commands). */
	promptDispatchGate?: Promise<void>;
}

export function createFollowUpQueueState(): FollowUpQueueState {
	return {
		followUpQueue: [],
		pendingFollowUps: [],
		pendingSteer: [],
		followUpsPaused: false,
		queuedSteerCount: 0,
		queuedFollowUpCount: 0,
	};
}

/** Text enters the prompt pipeline; command callbacks execute through the host UI. */
export type FollowUpInput = string | { text: string; execute: () => Promise<void> };

// Execution belongs to the live host, never to serialized queue state. Weak keys
// release command closures when entries are consumed, popped, or discarded.
const commandExecutors = new WeakMap<FollowUpQueueEntry, () => Promise<void>>();

export function attachFollowUpCommand(entry: FollowUpQueueEntry, execute: () => Promise<void>): void {
	commandExecutors.set(entry, execute);
}

export function followUpCommand(entry: FollowUpQueueEntry): (() => Promise<void>) | undefined {
	return commandExecutors.get(entry);
}

/** Refresh the public preview without mixing deferred user rounds into SDK continuations. */
export function syncFollowUpPreview(state: FollowUpQueueState, sdkFollowUp: readonly string[]): void {
	state.pendingFollowUps = [...state.followUpQueue.map((entry) => entry.text), ...sdkFollowUp];
	state.queuedFollowUpCount = sdkFollowUp.length;
}

/** Drop rounds owned by a reset conversation; a resumed drain must not revive them. */
export function discardFollowUps(state: FollowUpQueueState): void {
	state.followUpQueue = [];
	state.pendingFollowUps = [];
	state.pendingSteer = [];
	state.followUpsPaused = false;
	state.queuedSteerCount = 0;
	state.queuedFollowUpCount = 0;
}

/** Pauses deferred rounds only. SDK-owned retry/compaction companions remain untouched. */
export function pauseFollowUps(state: FollowUpQueueState): void {
	if (state.followUpQueue.length > 0 || state.followUpDrain) {
		state.followUpsPaused = true;
	}
}

/** Remove a single next round or the leading contiguous batch, preserving submission order. */
export function takeFollowUpBatch(state: FollowUpQueueState, sdkFollowUp: readonly string[]): FollowUpQueueEntry[] {
	const queue = state.followUpQueue;
	const first = queue[0];
	if (!first) return [];
	let count = 1;
	if (first.kind === "batch" && !first.command) {
		while (queue[count]?.kind === "batch" && !queue[count]?.command) count += 1;
	}
	const batch = queue.splice(0, count);
	syncFollowUpPreview(state, sdkFollowUp);
	return batch;
}

/**
 * `--batch` groups a follow-up with adjacent batch entries into one round.
 * `/follow-up` with text otherwise queues an exclusive round.
 */
export const FOLLOW_UP_BATCH_FLAG = "--batch";

/**
 * Split a leading `--batch` flag from the follow-up payload. Only the first
 * token counts: a later occurrence stays in the message, and the flag must be
 * followed by whitespace so `--batchfile` remains message text.
 */
export function parseFollowUpArgs(rawArgs: string): { batch: boolean; message: string } {
	const trimmed = rawArgs.trim();
	if (trimmed === FOLLOW_UP_BATCH_FLAG) return { batch: true, message: "" };
	if (!trimmed.startsWith(FOLLOW_UP_BATCH_FLAG)) return { batch: false, message: trimmed };
	const remainder = trimmed.slice(FOLLOW_UP_BATCH_FLAG.length);
	if (!/^\s/.test(remainder)) return { batch: false, message: trimmed };
	return { batch: true, message: remainder.trim() };
}
