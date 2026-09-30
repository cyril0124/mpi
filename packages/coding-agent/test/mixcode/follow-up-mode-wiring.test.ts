import { describe, expect, it, vi } from "vitest";
import { KeybindingsManager } from "../../src/core/keybindings.ts";
import { createFollowUpQueueState } from "../../src/core/mixcode/follow-up/runtime-follow-up-queue.ts";
import { InteractiveMode } from "../../src/modes/interactive/interactive-mode.ts";

/** The InteractiveMode fields the agent_settled branch of `handleEvent` reads. */
function makeAgentSettledContext(state: ReturnType<typeof createFollowUpQueueState>) {
	return {
		isInitialized: true,
		footer: { invalidate: vi.fn() },
		followUpStates: new Map([["session", state]]),
		tabManager: undefined,
		followUpState: state,
		checkShutdownRequested: vi.fn().mockResolvedValue(undefined),
	};
}

type AgentSettledContext = ReturnType<typeof makeAgentSettledContext>;

const handleEvent = Reflect.get(InteractiveMode.prototype, "handleEvent") as (
	this: AgentSettledContext,
	event: { type: "agent_settled" },
) => Promise<void>;

describe("follow-up wiring in interactive mode", () => {
	it("agent_settled pauses the queue after a run the drain did not start", async () => {
		const state = createFollowUpQueueState();
		state.followUpQueue = [{ text: "waiting round", kind: "next" }];
		state.followUpRunFailed = true;
		const fakeThis = makeAgentSettledContext(state);

		await handleEvent.call(fakeThis, { type: "agent_settled" });

		// The failed run's marker pauses the rounds it never owned.
		expect(state.followUpsPaused).toBe(true);
		expect(fakeThis.checkShutdownRequested).toHaveBeenCalledOnce();
	});

	it("agent_settled leaves an unpaused queue alone when the run succeeded", async () => {
		const state = createFollowUpQueueState();
		state.followUpQueue = [{ text: "waiting round", kind: "next" }];
		const fakeThis = makeAgentSettledContext(state);

		await handleEvent.call(fakeThis, { type: "agent_settled" });

		expect(state.followUpsPaused).toBe(false);
	});

	it("an armed choice resolves s/f to its queue, Esc cancels, expiry declines", () => {
		const endQueueEditArm = vi.fn();
		const fakeThis = {
			queueEditArmDeadline: Date.now() + 1_000,
			popQueuedIntoEditor: vi.fn(),
			showStatus: vi.fn(),
			endQueueEditArm,
			keybindings: new KeybindingsManager(),
		};
		const handleQueueEditArmKey = Reflect.get(InteractiveMode.prototype, "handleQueueEditArmKey") as (
			this: typeof fakeThis,
			data: string,
		) => boolean;

		expect(handleQueueEditArmKey.call(fakeThis, "f")).toBe(true);
		expect(fakeThis.popQueuedIntoEditor).toHaveBeenCalledWith("followUp");
		expect(endQueueEditArm).toHaveBeenCalledTimes(1);

		fakeThis.queueEditArmDeadline = Date.now() + 1_000;
		expect(handleQueueEditArmKey.call(fakeThis, "S")).toBe(true);
		expect(fakeThis.popQueuedIntoEditor).toHaveBeenCalledWith("steering");

		fakeThis.queueEditArmDeadline = Date.now() + 1_000;
		expect(handleQueueEditArmKey.call(fakeThis, "\x1b")).toBe(true);
		expect(fakeThis.showStatus).toHaveBeenCalledWith("Queue edit canceled");

		// Every resolution and an expired window drop the choice toast.
		expect(endQueueEditArm).toHaveBeenCalledTimes(3);
		fakeThis.queueEditArmDeadline = Date.now() - 1;
		expect(handleQueueEditArmKey.call(fakeThis, "f")).toBe(false);
		expect(endQueueEditArm).toHaveBeenCalledTimes(4);
	});
});
