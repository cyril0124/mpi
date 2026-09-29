import { describe, expect, it } from "vitest";
import {
	type FollowUpHost,
	type FollowUpSession,
	flushSteerQueue,
	popQueuedMessage,
	resumeFollowUps,
	submitFollowUps,
} from "../../src/core/mixcode/follow-up/runtime-follow-up.ts";
import { createFollowUpQueueState } from "../../src/core/mixcode/follow-up/runtime-follow-up-queue.ts";

interface FakeSessionOptions {
	/** Texts already mirrored in the SDK steering queue. */
	steering?: string[];
	/** Texts already mirrored in the SDK follow-up queue. */
	followUp?: string[];
}

type FakeSession = Omit<FollowUpSession, "isStreaming"> & {
	isStreaming: boolean;
	setIdle(idle: boolean): void;
};

/**
 * Minimal AgentSession stand-in. waitForIdle parks until idle turns true, like
 * the real session; a busy session must not let the drain spin microtasks.
 */
function makeSession(options: FakeSessionOptions = {}): FakeSession {
	const listeners = new Set<(event: { type: string }) => void>();
	const idleWaiters = new Set<() => void>();
	let idle = true;
	return {
		setIdle(next: boolean) {
			idle = next;
			if (next) {
				for (const waiter of idleWaiters) waiter();
				idleWaiters.clear();
			}
		},
		get isIdle() {
			return idle;
		},
		isStreaming: false,
		isCompacting: false,
		waitForIdle: () =>
			new Promise<void>((resolve) => {
				if (idle) resolve();
				else idleWaiters.add(resolve);
			}),
		subscribe: (listener) => {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		getSteeringMessages: () => [...(options.steering ?? [])],
		getFollowUpMessages: () => [...(options.followUp ?? [])],
		removeQueuedMessages: (kind, texts) =>
			texts
				.map((text) => {
					const pool = kind === "steering" ? (options.steering ?? []) : (options.followUp ?? []);
					const index = pool.lastIndexOf(text);
					if (index === -1) return undefined;
					pool.splice(index, 1);
					return { message: { role: "user", content: text }, text };
				})
				.filter((item): item is { message: { role: string; content: string }; text: string } => Boolean(item)),
		restoreQueuedMessages: (kind, removed) => {
			const pool = kind === "steering" ? (options.steering ?? []) : (options.followUp ?? []);
			for (const item of removed) pool.push(item.text);
		},
	};
}

type TestHost = FollowUpHost & {
	prompts: Array<{ text: string; accepted: boolean | undefined }>;
	commands: string[];
};

/** Poll a condition on real timers; fails the caller's test after 2s. */
async function waitUntil(condition: () => boolean): Promise<void> {
	for (let attempt = 0; attempt < 200 && !condition(); attempt += 1) {
		await new Promise((resolve) => setTimeout(resolve, 10));
	}
	expect(condition()).toBe(true);
}

function makeHost(session: FakeSession, overrides: Partial<FollowUpHost> = {}): TestHost {
	const prompts: Array<{ text: string; accepted: boolean | undefined }> = [];
	const commands: string[] = [];
	return {
		get session() {
			return session;
		},
		promptTurn: (text, preflightResult) => {
			prompts.push({ text, accepted: undefined });
			return Promise.resolve(preflightResult(true));
		},
		runQueuedCommand: (text) => {
			commands.push(text);
			return Promise.resolve();
		},
		isQueuedCommandText: () => false,
		isCompactionClaimed: () => false,
		onQueueChanged: () => {},
		onQueueError: () => {},
		isDiscarded: () => false,
		...overrides,
		prompts,
		commands,
	};
}

describe("follow-up drain", () => {
	it("runs each next round as its own prompt turn", async () => {
		const host = makeHost(makeSession());
		await submitFollowUps(createFollowUpQueueState(), host, ["first", "second"], "next");
		expect(host.prompts.map((prompt) => prompt.text)).toEqual(["first", "second"]);
	});

	it("joins adjacent batch entries into one prompt turn", async () => {
		const host = makeHost(makeSession());
		const state = createFollowUpQueueState();
		await submitFollowUps(state, host, ["a", "b"], "batch");
		await submitFollowUps(state, host, ["c"], "batch");
		expect(host.prompts.map((prompt) => prompt.text)).toEqual(["a\n\nb", "c"]);
	});

	it("queues without prompting while the session is busy", async () => {
		const session = makeSession();
		session.setIdle(false);
		const host = makeHost(session);
		const state = createFollowUpQueueState();
		const drained = submitFollowUps(state, host, ["hold"], "next");
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(host.prompts).toEqual([]);
		session.setIdle(true);
		// Submitting while busy is fire-and-forget: wait for the parked drain.
		await drained;
		await waitUntil(() => host.prompts.length === 1);
		expect(host.prompts.map((prompt) => prompt.text)).toEqual(["hold"]);
	});

	it("re-queues an unaccepted batch and pauses when the dispatch fails", async () => {
		const host = makeHost(makeSession(), {
			// Preflight rejected: text was never delivered.
			promptTurn: (_text, preflightResult) => {
				preflightResult(false);
				return Promise.reject(new Error("turn lock conflict"));
			},
		});
		const state = createFollowUpQueueState();
		await submitFollowUps(state, host, ["a", "b"], "batch").catch(() => {});
		expect(state.followUpQueue).toEqual([
			{ text: "a", kind: "batch" },
			{ text: "b", kind: "batch" },
		]);
		expect(state.followUpsPaused).toBe(true);
	});

	it("pauses when the dispatched run fails, and resume empties the queue", async () => {
		const session = makeSession();
		const host = makeHost(session);
		const state = createFollowUpQueueState();
		// First round's run fails (stopReason error); second round waits.
		let round = 0;
		host.promptTurn = (text, preflightResult) => {
			host.prompts.push({ text, accepted: undefined });
			round += 1;
			if (round === 1) {
				// Delivered, then the run fails after settling.
				preflightResult(true);
				state.followUpRunFailed = true;
			}
			return Promise.resolve();
		};
		await submitFollowUps(state, host, ["runs", "waits"], "next");
		// First round dispatched and its failure paused the queue before round two.
		expect(host.prompts.map((prompt) => prompt.text)).toEqual(["runs"]);
		expect(state.followUpsPaused).toBe(true);
		expect(state.followUpQueue).toEqual([{ text: "waits", kind: "next" }]);

		await resumeFollowUps(state, host);
		expect(host.prompts.map((prompt) => prompt.text)).toEqual(["runs", "waits"]);
		expect(state.followUpQueue).toEqual([]);
	});

	it("resume errors on an empty queue", async () => {
		const host = makeHost(makeSession());
		await expect(resumeFollowUps(createFollowUpQueueState(), host)).rejects.toThrow(
			"No follow-up messages to resume",
		);
	});

	it("executes queued command texts host-side without a model turn", async () => {
		const session = makeSession();
		const host = makeHost(session, { isQueuedCommandText: () => true });
		await submitFollowUps(createFollowUpQueueState(), host, ["/model x"], "next");
		expect(host.commands).toEqual(["/model x"]);
		expect(host.prompts).toEqual([]);
	});

	it("runs object-input executors directly, host hooks for strings", async () => {
		const host = makeHost(makeSession(), { isQueuedCommandText: () => true });
		let ran = false;
		const objectInput = {
			text: "batch script entry",
			execute: () => {
				ran = true;
				return Promise.resolve();
			},
		};
		await submitFollowUps(createFollowUpQueueState(), host, ["plain", objectInput], "batch");
		expect(host.commands).toEqual(["plain"]);
		expect(ran).toBe(true);
		expect(host.prompts).toEqual([]);
	});

	it("flushes only the steer queue and never promotes follow-up rounds", async () => {
		const session = makeSession({ steering: ["queued steer"] });
		session.setIdle(false); // mid-run: the flush waits for idle
		const host = makeHost(session);
		const state = createFollowUpQueueState();
		state.followUpQueue = [{ text: "follow-up round", kind: "next" }];
		state.pendingFollowUps = ["follow-up round"];
		state.pendingSteer = ["queued steer"];
		state.queuedSteerCount = 1;
		session.isStreaming = true;

		const flushed = flushSteerQueue(state, host);
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(host.prompts).toEqual([]);
		session.setIdle(true);
		await flushed;
		expect(host.prompts.map((prompt) => prompt.text)).toEqual(["queued steer"]);
		expect(state.followUpQueue).toEqual([{ text: "follow-up round", kind: "next" }]);
		expect(session.getSteeringMessages()).toEqual([]);
	});

	it("restores the steer queue when the flush dispatch fails", async () => {
		const session = makeSession({ steering: ["queued steer"] });
		const host = makeHost(session, {
			promptTurn: () => Promise.reject(new Error("dispatch refused")),
		});
		const state = createFollowUpQueueState();
		state.pendingSteer = ["queued steer"];
		state.queuedSteerCount = 1;
		await expect(flushSteerQueue(state, host)).rejects.toThrow("dispatch refused");
		expect(state.pendingSteer).toEqual(["queued steer"]);
		expect(state.queuedSteerCount).toBe(1);
		expect(session.getSteeringMessages()).toEqual(["queued steer"]);
	});

	it("pops follow-up entries back in their command form", () => {
		const host = makeHost(makeSession());
		const state = createFollowUpQueueState();
		state.followUpQueue = [
			{ text: "batch plain", kind: "batch" },
			{ text: "batch cmd", kind: "batch", command: true },
			{ text: "exclusive", kind: "next" },
		];
		expect(popQueuedMessage(state, host, "followUp")).toBe("/follow-up exclusive");
		expect(popQueuedMessage(state, host, "followUp")).toBe("/follow-up --batch batch cmd");
		expect(popQueuedMessage(state, host, "followUp")).toBe("batch plain");
	});

	it("pops a mirrored steer text out of the SDK queue", () => {
		const session = makeSession({ steering: ["sdk text"] });
		const host = makeHost(session);
		const state = createFollowUpQueueState();
		state.pendingSteer = ["parked-only", "sdk text"];
		state.queuedSteerCount = 1;
		expect(popQueuedMessage(state, host, "steering")).toBe("sdk text");
		expect(state.pendingSteer).toEqual(["parked-only"]);
		expect(state.queuedSteerCount).toBe(0);
		expect(session.getSteeringMessages()).toEqual([]);
	});
});
