import { fauxAssistantMessage } from "@earendil-works/pi-ai";
import { describe, expect, it, vi } from "vitest";
import type { FollowUpHost } from "../../src/core/mixcode/follow-up/runtime-follow-up.ts";
import {
	createFollowUpQueueState,
	type FollowUpQueueState,
} from "../../src/core/mixcode/follow-up/runtime-follow-up-queue.ts";
import { scheduleSteerSettleFlush } from "../../src/core/mixcode/follow-up/steer-settle-flush.ts";
import { createHarness, getAssistantTexts, getUserTexts, type Harness } from "../suite/harness.ts";

interface HostOptions {
	isCompactionClaimed?: () => boolean;
	isDiscarded?: () => boolean;
}

/** Mirror the SDK steering queue into the host-side preview, like interactive mode does. */
function syncMirror(harness: Harness, state: FollowUpQueueState): void {
	const steering = [...harness.session.getSteeringMessages()];
	state.pendingSteer = steering;
	state.queuedSteerCount = steering.length;
}

/** Let a scheduled flush run for a case that expects it to do nothing. */
function waitForQuietScheduler(): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, 50));
}

function createHost(
	harness: Harness,
	state: FollowUpQueueState,
	options: HostOptions = {},
): { host: FollowUpHost; errors: unknown[] } {
	const errors: unknown[] = [];
	const host: FollowUpHost = {
		get session() {
			return harness.session;
		},
		promptTurn: async (text, preflightResult) => {
			await harness.session.prompt(text, { preflightResult });
		},
		runQueuedCommand: async () => {},
		isQueuedCommandText: () => false,
		isCompactionClaimed: options.isCompactionClaimed ?? (() => false),
		onQueueChanged: () => syncMirror(harness, state),
		onQueueError: (error) => {
			errors.push(error);
		},
		isDiscarded: options.isDiscarded ?? (() => false),
	};
	return { host, errors };
}

describe("scheduleSteerSettleFlush", () => {
	it("sends a steer text left in the queue once the agent settles", async () => {
		const harness = await createHarness({});
		try {
			const state = createFollowUpQueueState();
			const { host, errors } = createHost(harness, state);
			harness.setResponses([fauxAssistantMessage("first reply"), fauxAssistantMessage("steered reply")]);

			await harness.session.prompt("start");
			await harness.session.steer("STEER-A");
			syncMirror(harness, state);
			expect(harness.session.getSteeringMessages()).toEqual(["STEER-A"]);

			scheduleSteerSettleFlush(state, host);
			await vi.waitFor(() => expect(getUserTexts(harness)).toEqual(["start", "STEER-A"]));

			expect(getAssistantTexts(harness)).toEqual(["first reply", "steered reply"]);
			expect(harness.session.getSteeringMessages()).toEqual([]);
			expect(errors).toEqual([]);
		} finally {
			harness.cleanup();
		}
	});

	it("does nothing when the settle leaves the steer queue empty", async () => {
		const harness = await createHarness({});
		try {
			const state = createFollowUpQueueState();
			const { host, errors } = createHost(harness, state);
			harness.setResponses([fauxAssistantMessage("first reply")]);

			await harness.session.prompt("start");
			scheduleSteerSettleFlush(state, host);
			await waitForQuietScheduler();

			expect(getUserTexts(harness)).toEqual(["start"]);
			expect(errors).toEqual([]);
		} finally {
			harness.cleanup();
		}
	});

	it("leaves the queue to a compaction that owns the session", async () => {
		const harness = await createHarness({});
		try {
			const state = createFollowUpQueueState();
			const { host, errors } = createHost(harness, state, { isCompactionClaimed: () => true });
			harness.setResponses([fauxAssistantMessage("first reply")]);

			await harness.session.prompt("start");
			await harness.session.steer("STEER-A");
			syncMirror(harness, state);

			scheduleSteerSettleFlush(state, host);
			await waitForQuietScheduler();

			expect(getUserTexts(harness)).toEqual(["start"]);
			expect(harness.session.getSteeringMessages()).toEqual(["STEER-A"]);
			expect(state.pendingSteer).toEqual(["STEER-A"]);
			expect(errors).toEqual([]);
		} finally {
			harness.cleanup();
		}
	});

	it("leaves the queue alone when the owning conversation is gone", async () => {
		const harness = await createHarness({});
		try {
			const state = createFollowUpQueueState();
			const { host, errors } = createHost(harness, state, { isDiscarded: () => true });
			harness.setResponses([fauxAssistantMessage("first reply")]);

			await harness.session.prompt("start");
			await harness.session.steer("STEER-A");
			syncMirror(harness, state);

			scheduleSteerSettleFlush(state, host);
			await waitForQuietScheduler();

			expect(getUserTexts(harness)).toEqual(["start"]);
			expect(errors).toEqual([]);
		} finally {
			harness.cleanup();
		}
	});
});

describe("compact() claim", () => {
	it("reports isCompacting while abort() settles the running turn", async () => {
		const harness = await createHarness({});
		try {
			harness.setResponses([fauxAssistantMessage("first reply"), fauxAssistantMessage("summary text")]);
			await harness.session.prompt("start");

			const compacting = harness.session.compact();
			expect(harness.session.isCompacting).toBe(true);

			await compacting.catch(() => {});
			expect(harness.session.isCompacting).toBe(false);
		} finally {
			harness.cleanup();
		}
	});
});
