import { describe, expect, it } from "vitest";
import {
	createFollowUpQueueState,
	discardFollowUps,
	FOLLOW_UP_BATCH_FLAG,
	parseFollowUpArgs,
	pauseFollowUps,
	syncFollowUpPreview,
	takeFollowUpBatch,
} from "../../src/core/mixcode/follow-up/runtime-follow-up-queue.ts";

describe("parseFollowUpArgs", () => {
	it("returns the message without a flag", () => {
		expect(parseFollowUpArgs("hello world")).toEqual({ batch: false, message: "hello world" });
	});

	it("splits a leading batch flag", () => {
		expect(parseFollowUpArgs(`--batch hello`)).toEqual({ batch: true, message: "hello" });
		expect(parseFollowUpArgs(`  ${FOLLOW_UP_BATCH_FLAG}   x  `)).toEqual({
			batch: true,
			message: "x",
		});
	});

	it("treats a lone flag as batch with no message", () => {
		expect(parseFollowUpArgs("--batch")).toEqual({ batch: true, message: "" });
	});

	it("keeps a non-whitespace-suffixed flag as message text", () => {
		expect(parseFollowUpArgs("--batchfile x")).toEqual({ batch: false, message: "--batchfile x" });
	});

	it("keeps an embedded flag as message text", () => {
		expect(parseFollowUpArgs("x --batch")).toEqual({ batch: false, message: "x --batch" });
	});
});

describe("takeFollowUpBatch", () => {
	it("groups only the leading contiguous non-command batch entries", () => {
		const state = createFollowUpQueueState();
		state.followUpQueue = [
			{ text: "a", kind: "batch" },
			{ text: "b", kind: "batch" },
			{ text: "c", kind: "next" },
			{ text: "d", kind: "batch" },
		];
		expect(takeFollowUpBatch(state, [])).toEqual([
			{ text: "a", kind: "batch" },
			{ text: "b", kind: "batch" },
		]);
		expect(state.followUpQueue).toEqual([
			{ text: "c", kind: "next" },
			{ text: "d", kind: "batch" },
		]);
	});

	it("takes a single next entry alone", () => {
		const state = createFollowUpQueueState();
		state.followUpQueue = [
			{ text: "a", kind: "next" },
			{ text: "b", kind: "batch" },
		];
		expect(takeFollowUpBatch(state, [])).toEqual([{ text: "a", kind: "next" }]);
	});

	it("splits a batch group at a command entry", () => {
		const state = createFollowUpQueueState();
		state.followUpQueue = [
			{ text: "a", kind: "batch" },
			{ text: "/models x", kind: "batch", command: true },
			{ text: "b", kind: "batch" },
		];
		expect(takeFollowUpBatch(state, [])).toEqual([{ text: "a", kind: "batch" }]);
	});

	it("refreshes the preview from the SDK mirror", () => {
		const state = createFollowUpQueueState();
		state.followUpQueue = [{ text: "a", kind: "batch" }];
		takeFollowUpBatch(state, ["sdk companion"]);
		expect(state.pendingFollowUps).toEqual(["sdk companion"]);
		expect(state.queuedFollowUpCount).toBe(1);
	});

	it("returns empty for an empty queue", () => {
		expect(takeFollowUpBatch(createFollowUpQueueState(), [])).toEqual([]);
	});
});

describe("syncFollowUpPreview", () => {
	it("keeps local rounds ahead of SDK companions", () => {
		const state = createFollowUpQueueState();
		state.followUpQueue = [
			{ text: "a", kind: "next" },
			{ text: "b", kind: "batch" },
		];
		syncFollowUpPreview(state, ["sdk"]);
		expect(state.pendingFollowUps).toEqual(["a", "b", "sdk"]);
		expect(state.queuedFollowUpCount).toBe(1);
	});
});

describe("pause and discard", () => {
	it("pauses only while entries or a drain remain", () => {
		const state = createFollowUpQueueState();
		pauseFollowUps(state);
		expect(state.followUpsPaused).toBe(false);
		state.followUpQueue = [{ text: "a", kind: "next" }];
		pauseFollowUps(state);
		expect(state.followUpsPaused).toBe(true);
	});

	it("discard clears rounds, preview, pause state, and counts", () => {
		const state = createFollowUpQueueState();
		state.followUpQueue = [{ text: "a", kind: "next" }];
		state.pendingFollowUps = ["a", "sdk"];
		state.followUpsPaused = true;
		state.queuedFollowUpCount = 1;
		state.queuedSteerCount = 2;
		const oldQueue = state.followUpQueue;
		discardFollowUps(state);
		expect(state.followUpQueue).toEqual([]);
		expect(state.pendingFollowUps).toEqual([]);
		expect(state.followUpsPaused).toBe(false);
		expect(state.queuedFollowUpCount).toBe(0);
		// A discarded queue is a new array identity: an in-flight drain stops.
		expect(state.followUpQueue).not.toBe(oldQueue);
	});
});
