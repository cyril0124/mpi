/**
 * Settle-time steer flush.
 *
 * The SDK drains the steering queue only at an agent turn boundary, so a steer
 * text still queued when the agent settles has no run left to pick it up: it
 * waits in the queue until the user submits something else. Send it now as one
 * turn instead.
 *
 * A settle can be followed by a post-abort compaction or a resume that claims
 * the session right after. That owner's own turn drains the queue, so this
 * watches for the handoff and leaves the queue alone when one appears.
 */

import { type FollowUpHost, flushSteerQueue, nextMacrotask, waitForCompactionIdle } from "./runtime-follow-up.ts";
import type { FollowUpQueueState } from "./runtime-follow-up-queue.ts";

/** Macrotask ticks spent watching for a post-settle compaction or resume. */
const SETTLE_HANDOFF_TICKS = 8;

/** One settle at a time per queue; an in-flight flush already covers this one. */
const flushInFlight = new WeakSet<FollowUpQueueState>();

/** True while a run, a compaction, or a claimed manual compaction owns the session. */
function sessionClaimed(host: FollowUpHost): boolean {
	return host.session.isStreaming || host.session.isCompacting || host.isCompactionClaimed();
}

/** True while the queue holds a text and no other owner has taken the session. */
function canFlush(state: FollowUpQueueState, host: FollowUpHost): boolean {
	return !host.isDiscarded() && state.pendingSteer.length > 0 && !sessionClaimed(host);
}

/** Poll a short window for a compaction or resume that starts after the settle. */
async function waitForSettleHandoff(host: FollowUpHost): Promise<void> {
	for (let tick = 0; tick < SETTLE_HANDOFF_TICKS; tick += 1) {
		if (sessionClaimed(host)) return;
		await nextMacrotask();
	}
}

/**
 * Send queued steer texts as one turn when the settled session is still idle.
 * The settle that triggered this never polls the queue again, so without it the
 * texts wait for the next user submission.
 */
export function scheduleSteerSettleFlush(state: FollowUpQueueState, host: FollowUpHost): void {
	if (state.pendingSteer.length === 0 || flushInFlight.has(state)) return;
	flushInFlight.add(state);
	void runSteerSettleFlush(state, host)
		.catch((error: unknown) => host.onQueueError(error))
		.finally(() => flushInFlight.delete(state));
}

async function runSteerSettleFlush(state: FollowUpQueueState, host: FollowUpHost): Promise<void> {
	await host.session.waitForIdle();
	await waitForSettleHandoff(host);
	if (!canFlush(state, host)) return;
	// A compaction starting now would refuse the prompt. Wait it out and re-check:
	// its end can hand the session to a resume.
	await waitForCompactionIdle(host.session);
	if (!canFlush(state, host)) return;
	await flushSteerQueue(state, host);
}
