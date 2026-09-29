import { beforeAll, describe, expect, it } from "vitest";
import {
	followUpPreviewMessages,
	type QueuePreviewData,
	type QueuePreviewHints,
	renderQueuePreview,
} from "../../src/modes/interactive/components/mixcode/follow-up/queue-preview.ts";
import { initTheme } from "../../src/modes/interactive/theme/theme.ts";

beforeAll(() => {
	initTheme("dark");
});

const HINTS: QueuePreviewHints = { dequeue: "Ctrl+U", sendNow: "Esc" };

function data(overrides: Partial<QueuePreviewData> = {}): QueuePreviewData {
	return {
		steer: [],
		followUpRounds: [],
		sdkFollowUps: [],
		followUpsPaused: false,
		compacting: false,
		...overrides,
	};
}

function plain(lines: string[]): string[] {
	// Strip ANSI escapes so assertions read the raw text.
	return lines.map((line) => line.replace(/\u001b\[[0-9;]*m/g, ""));
}

describe("followUpPreviewMessages", () => {
	it("numbers rounds so a next entry ends adjacent batches", () => {
		const messages = followUpPreviewMessages(
			data({
				followUpRounds: [
					{ text: "a", kind: "batch" },
					{ text: "b", kind: "batch" },
					{ text: "c", kind: "next" },
					{ text: "d", kind: "batch" },
				],
			}),
		);
		expect(messages).toEqual(["Round 1 · a", "Round 1 · b", "Round 2 · next · c", "Round 3 · d"]);
	});

	it("labels command entries and appends SDK companions after the rounds", () => {
		const messages = followUpPreviewMessages(
			data({
				followUpRounds: [
					{ text: "/models x", kind: "batch", command: true },
					{ text: "plain", kind: "batch" },
				],
				sdkFollowUps: ["sdk retry"],
			}),
		);
		expect(messages).toEqual(["Round 1 · command · /models x", "Round 2 · plain", "SDK · sdk retry"]);
	});
});

describe("renderQueuePreview", () => {
	it("renders nothing when both queues are empty", () => {
		expect(renderQueuePreview(data(), 80, HINTS)).toEqual([]);
	});

	it("renders a steer box with the send-now hint and count", () => {
		const lines = plain(renderQueuePreview(data({ steer: ["fix this"] }), 60, HINTS));
		expect(lines[0]).toContain("Steer");
		expect(lines[1]).toContain("Steer (1)  Ctrl+U->edit  Esc->send now");
		expect(lines[2]).toContain("↳ fix this");
		expect(lines).toHaveLength(4);
	});

	it("drops the send-now hint while compaction owns the queue", () => {
		const lines = plain(renderQueuePreview(data({ steer: ["x"], compacting: true }), 40, HINTS));
		expect(lines[1]).not.toContain("Esc->send now");
	});

	it("shows the pause hint on the follow-up box", () => {
		const lines = plain(
			renderQueuePreview(
				data({ followUpRounds: [{ text: "later", kind: "next" }], followUpsPaused: true }),
				40,
				HINTS,
			),
		);
		expect(lines[1]).toContain("Follow-up (1)  Ctrl+U->edit");
		expect(lines[2]).toContain("Paused · /follow-up to resume");
	});

	it("uses per-queue edit hints when both boxes are visible", () => {
		const lines = plain(
			renderQueuePreview(data({ steer: ["s1"], followUpRounds: [{ text: "f1", kind: "batch" }] }), 60, HINTS),
		);
		expect(lines[1]).toContain("Ctrl+U,S->edit");
		expect(lines[5]).toContain("Ctrl+U,F->edit");
	});

	it("reports the total and shows only the latest five entries", () => {
		const steer = ["one", "two", "three", "four", "five", "six"];
		const lines = plain(renderQueuePreview(data({ steer }), 40, HINTS));
		expect(lines[1]).toContain("Steer (6, latest 5)");
		expect(lines.some((line) => line.includes("↳ one"))).toBe(false);
		expect(lines.some((line) => line.includes("↳ two"))).toBe(true);
		expect(lines.some((line) => line.includes("↳ six"))).toBe(true);
	});

	it("collapses whitespace and truncates long entries to the box width", () => {
		const long = `line1\n\tline2   with   spaces ${"x".repeat(80)}`;
		const lines = plain(renderQueuePreview(data({ steer: [long] }), 40, HINTS));
		const entry = lines.find((line) => line.includes("↳"));
		expect(entry).toBeDefined();
		expect(entry).not.toContain("\n");
		expect(entry).not.toContain("\t");
		expect(entry!.length).toBeLessThanOrEqual(40);
	});
});
