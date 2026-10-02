import { fauxAssistantMessage } from "@earendil-works/pi-ai";
import { afterEach, describe, expect, it } from "vitest";
import type { SessionTreeEvent } from "../../src/core/extensions/index.ts";
import { createHarness, getMessageText, getUserTexts, type Harness } from "../suite/harness.ts";
import { userMsg } from "../utilities.ts";

/**
 * `/reset` moves the leaf back to the session root. The transcript keeps every entry, so `/tree`
 * still reaches the abandoned branches, and only the context shrinks.
 */
describe("reset the session branch to root", () => {
	const harnesses: Harness[] = [];

	afterEach(() => {
		while (harnesses.length > 0) {
			harnesses.pop()?.cleanup();
		}
	});

	/** A harness whose extension records the `session_tree` events it receives. */
	async function createHarnessWithTreeEvents(): Promise<{ harness: Harness; treeEvents: SessionTreeEvent[] }> {
		const treeEvents: SessionTreeEvent[] = [];
		const harness = await createHarness({
			extensionFactories: [
				(pi) => {
					pi.on("session_tree", (event) => {
						treeEvents.push(event);
					});
				},
			],
		});
		harnesses.push(harness);
		return { harness, treeEvents };
	}

	it("empties the context, keeps the transcript, and starts the next prompt at a new root", async () => {
		const { harness, treeEvents } = await createHarnessWithTreeEvents();
		harness.setResponses([fauxAssistantMessage("first"), fauxAssistantMessage("second")]);
		await harness.session.prompt("one");
		await harness.session.prompt("two");
		const entriesBefore = harness.sessionManager.getEntries().length;

		expect(await harness.session.resetLeafToRoot()).toEqual({ noop: false });

		expect(harness.sessionManager.getLeafId()).toBeNull();
		expect(harness.session.messages).toEqual([]);
		expect(harness.sessionManager.getEntries()).toHaveLength(entriesBefore);
		expect(treeEvents).toEqual([expect.objectContaining({ oldLeafId: expect.any(String), newLeafId: null })]);

		harness.setResponses([fauxAssistantMessage("third")]);
		await harness.session.prompt("three");

		expect(getUserTexts(harness)).toEqual(["three"]);
		// The reset leaf re-rooted the append, so the file now holds both roots.
		const recordedUserTexts = harness.sessionManager
			.getEntries()
			.flatMap((entry) =>
				entry.type === "message" && entry.message.role === "user" ? [getMessageText(entry.message)] : [],
			);
		expect(recordedUserTexts).toEqual(["one", "two", "three"]);
	});

	it("reports a no-op when the leaf is already the root", async () => {
		const { harness, treeEvents } = await createHarnessWithTreeEvents();

		expect(await harness.session.resetLeafToRoot()).toEqual({ noop: true });
		expect(treeEvents).toEqual([]);
	});

	it("refuses during a running response and leaves the leaf alone", async () => {
		const harness = await createHarness();
		harnesses.push(harness);
		harness.sessionManager.appendMessage(userMsg("first"));
		let resetError: unknown;
		let leafHeld = false;

		harness.setResponses([
			async () => {
				const activeLeafId = harness.sessionManager.getLeafId();
				resetError = await harness.session.resetLeafToRoot().catch((error) => error);
				leafHeld = activeLeafId !== null && harness.sessionManager.getLeafId() === activeLeafId;
				return fauxAssistantMessage("response");
			},
		]);
		await harness.session.prompt("second");

		expect(resetError).toEqual(new Error("Wait for the current response to finish before resetting the session."));
		expect(leafHeld).toBe(true);
	});
});
