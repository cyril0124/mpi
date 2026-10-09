import { fauxAssistantMessage } from "@earendil-works/pi-ai";
import { describe, expect, it } from "vitest";
import {
	type FollowUpHost,
	resumeFollowUps,
	submitFollowUps,
} from "../../src/core/mixcode/follow-up/runtime-follow-up.ts";
import { createFollowUpQueueState } from "../../src/core/mixcode/follow-up/runtime-follow-up-queue.ts";
import { TurnController, type TurnHost } from "../../src/modes/interactive/mixcode/follow-up/turn-controller.ts";
import { createHarness, getAssistantTexts, getUserTexts, type Harness } from "../suite/harness.ts";

/** Build a controller over a real harness session, moving subscriptions when the session is replaced. */
function createFauxTurnHost(initialHarness: Harness) {
	let harness = initialHarness;
	const state = createFollowUpQueueState();
	const errors: unknown[] = [];
	const trace: string[] = [];
	const settlements: Promise<void>[] = [];
	const followUpHost: FollowUpHost = {
		get session() {
			return harness.session;
		},
		promptTurn: async (text, preflightResult) => harness.session.prompt(text, { preflightResult }),
		runQueuedCommand: async () => {},
		isQueuedCommandText: () => false,
		isCompactionClaimed: () => false,
		onQueueChanged: () => {},
		onQueueError: (error) => errors.push(error),
		isDiscarded: () => false,
	};
	const host: TurnHost = {
		get session() {
			return harness.session;
		},
		followUpState: state,
		followUpHost,
		endInterruptArm: () => {},
		checkShutdownRequested: async () => {},
		flushCompactionQueue: async () => {},
	};
	const controller = new TurnController(host);
	const subscriptions: Array<() => void> = [];
	const bind = (next: Harness) => {
		harness = next;
		subscriptions.push(
			next.session.subscribe((event) => {
				if (event.type === "agent_start") {
					controller.onAgentStart();
					trace.push(`start:failed=${state.followUpRunFailed}:visible=${controller.runVisibleOutput}`);
				} else if (
					(event.type === "message_start" || event.type === "message_update") &&
					event.message.role === "assistant"
				) {
					controller.onAssistantOutput(event.message);
				} else if (event.type === "message_end" && event.message.role === "assistant") {
					controller.onAssistantMessageFinalized(event.message);
				} else if (event.type === "agent_end") {
					controller.onAgentEnd();
				} else if (event.type === "agent_settled") {
					settlements.push(controller.onAgentSettled());
					trace.push(`settled:paused=${state.followUpsPaused}`);
				}
			}),
		);
	};
	bind(initialHarness);
	return {
		controller,
		state,
		followUpHost,
		errors,
		trace,
		settlements,
		replaceSession: (next: Harness) => {
			for (const unsubscribe of subscriptions.splice(0)) unsubscribe();
			controller.resetRunMarkers();
			bind(next);
		},
		dispose: () => {
			for (const unsubscribe of subscriptions) unsubscribe();
		},
	};
}

describe("turn controller with real faux sessions", () => {
	it("pauses remaining rounds on failure, then resets run state and drains on explicit resume", async () => {
		const harness = await createHarness({ settings: { retry: { enabled: false }, compaction: { enabled: false } } });
		const workflow = createFauxTurnHost(harness);
		try {
			harness.setResponses([
				fauxAssistantMessage("", { stopReason: "error", errorMessage: "invalid_api_key" }),
				fauxAssistantMessage("second succeeded"),
				fauxAssistantMessage("third succeeded"),
			]);
			await submitFollowUps(workflow.state, workflow.followUpHost, ["first", "second", "third"], "next");
			await Promise.all(workflow.settlements);
			expect(getUserTexts(harness)).toEqual(["first"]);
			expect(workflow.state.followUpsPaused).toBe(true);
			expect(workflow.state.followUpQueue.map((entry) => entry.text)).toEqual(["second", "third"]);
			await resumeFollowUps(workflow.state, workflow.followUpHost);
			await Promise.all(workflow.settlements);
			expect(getUserTexts(harness)).toEqual(["first", "second", "third"]);
			expect(getAssistantTexts(harness)).toEqual(["", "second succeeded", "third succeeded"]);
			expect(workflow.trace).toEqual([
				"start:failed=false:visible=false",
				"settled:paused=true",
				"start:failed=false:visible=false",
				"settled:paused=false",
				"start:failed=false:visible=false",
				"settled:paused=false",
			]);
			expect(workflow.state.followUpQueue).toEqual([]);
			expect(workflow.state.followUpRunFailed).toBe(false);
			expect(workflow.errors).toEqual([]);
		} finally {
			workflow.dispose();
			harness.cleanup();
		}
	});

	it("reads replacement session leaf and dispatches retained rounds into that live session", async () => {
		const first = await createHarness({ settings: { compaction: { enabled: false } } });
		const second = await createHarness({ settings: { compaction: { enabled: false } } });
		const workflow = createFauxTurnHost(first);
		try {
			first.setResponses([fauxAssistantMessage("old reply")]);
			await first.session.prompt("old session");
			workflow.state.followUpsPaused = true;
			await submitFollowUps(workflow.state, workflow.followUpHost, ["retained A", "retained B"], "next");
			second.setResponses([fauxAssistantMessage("replacement seed reply")]);
			await second.session.prompt("replacement history");
			const replacementLeaf = second.sessionManager.getLeafId();
			workflow.replaceSession(second);
			expect(workflow.controller.runStartLeafId).toBeUndefined();
			expect(workflow.controller.runVisibleOutput).toBe(false);
			workflow.controller.onAgentStart();
			expect(workflow.controller.runStartLeafId).toBe(replacementLeaf);
			second.setResponses([fauxAssistantMessage("new A"), fauxAssistantMessage("new B")]);
			await resumeFollowUps(workflow.state, workflow.followUpHost);
			await Promise.all(workflow.settlements);
			expect(getUserTexts(first)).toEqual(["old session"]);
			expect(getUserTexts(second)).toEqual(["replacement history", "retained A", "retained B"]);
			expect(getAssistantTexts(second)).toEqual(["replacement seed reply", "new A", "new B"]);
			expect(workflow.errors).toEqual([]);
		} finally {
			workflow.dispose();
			first.cleanup();
			second.cleanup();
		}
	});
});
