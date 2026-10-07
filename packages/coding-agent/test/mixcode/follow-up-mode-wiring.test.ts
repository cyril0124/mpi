import { describe, expect, it, vi } from "vitest";
import { KeybindingsManager } from "../../src/core/keybindings.ts";
import {
	createFollowUpQueueState,
	syncFollowUpPreview,
} from "../../src/core/mixcode/follow-up/runtime-follow-up-queue.ts";
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

/** The InteractiveMode fields the dequeue and its stash path read, plus a mutable composer. */
function makeDequeueContext() {
	const state = createFollowUpQueueState();
	const composer = { text: "" };
	const context = {
		followUpState: state,
		followUpHost: {
			session: { getFollowUpMessages: () => [] as string[] },
			isQueuedCommandText: () => false,
			onQueueChanged: vi.fn(),
		},
		editorText: () => composer.text,
		editor: {
			setText: (text: string) => {
				composer.text = text;
			},
			getText: () => composer.text,
		},
		updatePendingMessagesDisplay: vi.fn(),
		ui: { requestRender: vi.fn() },
		showWarning: vi.fn(),
		pendingListFor: (kind: "steering" | "followUp") =>
			kind === "steering" ? state.pendingSteer : state.pendingFollowUps,
		// The real stash path reads this fake instance.
		stashEditorInput: Reflect.get(InteractiveMode.prototype, "stashEditorInput") as (this: unknown) => void,
		// The dequeue also clears a compaction-parked copy; these tests park none.
		compactionQueuedMessages: [] as Array<{ text: string; mode: "steer" | "followUp" }>,
		discardCompactionQueuedMessage: Reflect.get(InteractiveMode.prototype, "discardCompactionQueuedMessage") as (
			this: unknown,
			kind: "steering" | "followUp",
			text: string,
		) => void,
		homeSelection: { active: false },
		activeTabIdForUi: "tab-1",
		stashedPrompts: new Map<string, string[]>(),
		syncEditorHistory: vi.fn(),
	};
	return { state, composer, context };
}

type DequeueContext = ReturnType<typeof makeDequeueContext>["context"];

const popQueuedIntoEditor = Reflect.get(InteractiveMode.prototype, "popQueuedIntoEditor") as (
	this: DequeueContext,
	kind: "steering" | "followUp",
) => void;

describe("follow-up wiring in interactive mode", () => {
	it("parks the composer draft in the prompt history when a dequeue pops a follow-up", () => {
		const { state, composer, context } = makeDequeueContext();
		state.followUpQueue = [{ text: "queued round", kind: "next" }];
		syncFollowUpPreview(state, []);
		composer.text = "DRAFT-KEEP-ME";

		popQueuedIntoEditor.call(context, "followUp");

		expect(composer.text).toBe("/follow-up queued round");
		expect(context.stashedPrompts.get("tab-1")).toEqual(["DRAFT-KEEP-ME"]);
		expect(context.syncEditorHistory).toHaveBeenCalledOnce();
		// Draft text the user has not submitted stays out of every queue a flush reads.
		expect(state.pendingSteer).toEqual([]);
		expect(state.followUpQueue).toEqual([]);
		expect(state.pendingFollowUps).toEqual([]);
	});

	it("parks the composer draft in the prompt history when a dequeue pops a steering message", () => {
		const { state, composer, context } = makeDequeueContext();
		state.pendingSteer = ["steer text"];
		composer.text = "DRAFT-KEEP-ME";

		popQueuedIntoEditor.call(context, "steering");

		expect(composer.text).toBe("steer text");
		expect(context.stashedPrompts.get("tab-1")).toEqual(["DRAFT-KEEP-ME"]);
		expect(state.pendingSteer).toEqual([]);
	});

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
