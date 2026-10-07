/**
 * Regression: a message submitted while `/compact` runs must leave both queues when the dequeue key
 * pulls it back into the editor, so the compaction-end flush does not send it as a turn. On MixCode
 * Home, whose composer is ephemeral and addresses the roster's selection, the same key must leave the
 * parked message in its queue instead of handing it to a composer that discards it.
 */
import { describe, expect, test, vi } from "vitest";
import { createFollowUpQueueState } from "../../src/core/mixcode/follow-up/runtime-follow-up-queue.ts";
import { InteractiveMode } from "../../src/modes/interactive/interactive-mode.ts";

/** The parts of `InteractiveMode` the dequeue path reads, plus the real pop it routes through. */
function createDequeueContext(options: { homeActive: boolean; parked: string }) {
	const setText = vi.fn();
	const state = createFollowUpQueueState();
	// The shape queueCompactionMessage leaves: a parked steer text, no SDK-mirrored tail.
	state.pendingSteer.push(options.parked);
	const session = {
		clearQueue: vi.fn(),
		getSteeringMessages: () => [],
		getFollowUpMessages: () => [],
		removeQueuedMessages: vi.fn(() => []),
		prompt: vi.fn(async () => {}),
		steer: vi.fn(async () => {}),
		followUp: vi.fn(async () => {}),
	};
	const fakeThis: Record<string, unknown> = {
		homeSelection: { active: options.homeActive },
		followUpState: state,
		followUpHost: { session },
		session,
		compactionQueuedMessages: [{ text: options.parked, mode: "steer" }],
		isExtensionCommand: () => false,
		editorText: () => "",
		stashEditorInput: vi.fn(),
		editor: { setText },
		updatePendingMessagesDisplay: vi.fn(),
		ui: { requestRender: vi.fn() },
		showWarning: vi.fn(),
		showError: vi.fn(),
		showStatus: vi.fn(),
	};
	// Route the dequeue through the real pop, so the mirror and the compaction queue are the ones
	// under test rather than a stub.
	fakeThis.popQueuedIntoEditor = Reflect.get(InteractiveMode.prototype, "popQueuedIntoEditor");
	fakeThis.discardCompactionQueuedMessage = Reflect.get(InteractiveMode.prototype, "discardCompactionQueuedMessage");
	return { fakeThis, setText, state, session };
}

describe("dequeue of a message parked by compaction", () => {
	test("the compaction flush after the dequeue sends nothing", async () => {
		const { fakeThis, setText, state, session } = createDequeueContext({
			homeActive: false,
			parked: "retract-me",
		});

		const handleDequeue = Reflect.get(InteractiveMode.prototype, "handleDequeue") as (
			this: Record<string, unknown>,
		) => void;
		const flushCompactionQueue = Reflect.get(InteractiveMode.prototype, "flushCompactionQueue") as (
			this: Record<string, unknown>,
			options?: { willRetry?: boolean },
		) => Promise<void>;

		handleDequeue.call(fakeThis);
		expect(setText).toHaveBeenCalledWith("retract-me");

		await flushCompactionQueue.call(fakeThis, { willRetry: false });
		expect(session.prompt).not.toHaveBeenCalled();
		expect(session.steer).not.toHaveBeenCalled();
		expect(state.pendingSteer).toEqual([]);
	});

	/**
	 * Home has no tab of its own: the dequeue key resolves one from the mounted tab, so acting on it
	 * here would empty that tab's queue into a composer whose text is dropped on the next `tab`.
	 */
	test("on MixCode Home the dequeue key leaves the parked message queued", () => {
		const { fakeThis, setText, state } = createDequeueContext({ homeActive: true, parked: "keep-me" });

		const handleDequeue = Reflect.get(InteractiveMode.prototype, "handleDequeue") as (
			this: Record<string, unknown>,
		) => void;
		handleDequeue.call(fakeThis);

		expect(setText).not.toHaveBeenCalled();
		expect(state.pendingSteer).toEqual(["keep-me"]);
		expect(fakeThis.compactionQueuedMessages).toEqual([{ text: "keep-me", mode: "steer" }]);
	});
});
