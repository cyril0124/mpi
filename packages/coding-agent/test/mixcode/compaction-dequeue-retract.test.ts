/**
 * Regression: a message submitted while `/compact` runs must leave both queues when the dequeue key
 * pulls it back into the editor, so the compaction-end flush does not send it as a turn.
 */
import { describe, expect, test, vi } from "vitest";
import { createFollowUpQueueState } from "../../src/core/mixcode/follow-up/runtime-follow-up-queue.ts";
import { InteractiveMode } from "../../src/modes/interactive/interactive-mode.ts";

describe("dequeue of a message parked by compaction", () => {
	test("the compaction flush after the dequeue sends nothing", async () => {
		const setText = vi.fn();
		const state = createFollowUpQueueState();
		// The shape queueCompactionMessage leaves: a parked steer text, no SDK-mirrored tail.
		state.pendingSteer.push("retract-me");
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
			followUpState: state,
			followUpHost: { session },
			session,
			compactionQueuedMessages: [{ text: "retract-me", mode: "steer" }],
			isExtensionCommand: () => false,
			editorText: () => "",
			stashEditorInput: vi.fn(),
			editor: { setText },
			updatePendingMessagesDisplay: vi.fn(),
			ui: { requestRender: vi.fn() },
			showWarning: vi.fn(),
			showError: vi.fn(),
		};
		// Route the dequeue through the real pop, so the mirror and the compaction queue are the ones
		// under test rather than a stub.
		fakeThis.popQueuedIntoEditor = Reflect.get(InteractiveMode.prototype, "popQueuedIntoEditor");
		fakeThis.discardCompactionQueuedMessage = Reflect.get(
			InteractiveMode.prototype,
			"discardCompactionQueuedMessage",
		);

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
	});
});
