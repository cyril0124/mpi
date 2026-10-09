import type { AgentTool } from "@earendil-works/pi-agent-core";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { Container } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { describe, expect, it } from "vitest";
import type { AgentSession } from "../../src/core/agent-session.ts";
import {
	createFollowUpQueueState,
	type FollowUpQueueState,
} from "../../src/core/mixcode/follow-up/runtime-follow-up-queue.ts";
import type { AgentTab } from "../../src/core/mixcode/multi-tab/tab-manager.ts";
import { InteractiveMode } from "../../src/modes/interactive/interactive-mode.ts";
import { initTheme } from "../../src/modes/interactive/theme/theme.ts";
import { stripAnsi } from "../../src/utils/ansi.ts";
import { createHarness, type Harness } from "../suite/harness.ts";

const QUEUE_PREVIEW_HEADING = "Steer";

/** Everything `restoreTranscript` and `updatePendingMessagesDisplay` read off the mode. */
function makeModeContext(session: AgentSession, tabId: string, state: FollowUpQueueState) {
	const context = {
		session,
		activeTabIdForUi: tabId,
		tabManager: { activeTab: () => ({ id: tabId }) },
		followUpStates: new Map([[tabId, state]]),
		followUpState: state,
		compactionQueues: new Map<string, never[]>(),
		compactionQueuedMessages: [] as Array<{ text: string; mode: string }>,
		tabTranscript: new Map([[tabId, { signature: "sig", chat: [], loaded: [] }]]),
		chatContainer: new Container(),
		loadedResourcesContainer: new Container(),
		pendingMessagesContainer: new Container(),
		pendingTools: new Map(),
		streamingComponent: undefined,
		streamingMessage: undefined,
		transcriptSignature: () => "sig",
		getAppKeyDisplay: () => "Ctrl+U",
		ui: { requestRender: () => {} },
		updatePendingMessagesDisplay: Reflect.get(InteractiveMode.prototype, "updatePendingMessagesDisplay"),
		syncQueuedMessageMirrors: Reflect.get(InteractiveMode.prototype, "syncQueuedMessageMirrors"),
		resyncQueuedMessageMirrors: Reflect.get(InteractiveMode.prototype, "resyncQueuedMessageMirrors"),
	};
	return context;
}

async function createWaitingHarness(): Promise<{
	harness: Harness;
	releaseToolExecution: () => void;
	promptPromise: Promise<void>;
	waitForToolStart: Promise<void>;
}> {
	let releaseToolExecution: (() => void) | undefined;
	const toolRelease = new Promise<void>((resolve) => {
		releaseToolExecution = resolve;
	});
	const waitTool: AgentTool = {
		name: "wait",
		label: "Wait",
		description: "Wait for release",
		parameters: Type.Object({}),
		execute: async () => {
			await toolRelease;
			return { content: [{ type: "text", text: "released" }], details: {} };
		},
	};
	const harness = await createHarness({ tools: [waitTool] });
	const waitForToolStart = new Promise<void>((resolve) => {
		const unsubscribe = harness.session.subscribe((event) => {
			if (event.type === "tool_execution_start" && event.toolName === "wait") {
				unsubscribe();
				resolve();
			}
		});
	});
	return {
		harness,
		releaseToolExecution: () => releaseToolExecution?.(),
		promptPromise: harness.session.prompt("start"),
		waitForToolStart,
	};
}

describe("steer queue mirror on tab activation", () => {
	it("drops a steer delivered while the tab was inactive", async () => {
		initTheme("dark");
		const { harness, releaseToolExecution, promptPromise, waitForToolStart } = await createWaitingHarness();
		try {
			harness.setResponses([
				fauxAssistantMessage(fauxToolCall("wait", {}), { stopReason: "toolUse" }),
				fauxAssistantMessage("done"),
			]);
			const tabId = "tab-a";
			const state = createFollowUpQueueState();

			await waitForToolStart;
			// The tab is backgrounded: its queue_update events are not subscribed, and the
			// mirror is left as it was when the steer was queued.
			await harness.session.steer("STEER-A");
			state.pendingSteer = ["STEER-A"];
			state.queuedSteerCount = 1;

			releaseToolExecution();
			await promptPromise;
			expect(harness.session.getSteeringMessages()).toEqual([]);

			const context = makeModeContext(harness.session, tabId, state);
			const restoreTranscript = Reflect.get(InteractiveMode.prototype, "restoreTranscript") as (
				this: typeof context,
				id: string,
			) => boolean;
			restoreTranscript.call(context, tabId);

			const rendered = stripAnsi(context.pendingMessagesContainer.render(80).join("\n"));
			expect(rendered).not.toContain("STEER-A");
			expect(rendered).not.toContain(QUEUE_PREVIEW_HEADING);
		} finally {
			harness.cleanup();
		}
	});

	it("keeps a compaction-parked steer ahead of the mirrored one across a resync", () => {
		initTheme("dark");
		const session = {
			getSteeringMessages: () => ["MIRRORED"],
			getFollowUpMessages: () => [],
			isCompacting: false,
		} as unknown as AgentSession;
		const tabId = "tab-a";
		const state = createFollowUpQueueState();
		state.pendingSteer = ["MIRRORED"];
		state.queuedSteerCount = 1;
		const context = {
			...makeModeContext(session, tabId, state),
			homeSelection: { active: false },
			promptHistory: new Map<string, string[]>(),
			recordPromptHistory: Reflect.get(InteractiveMode.prototype, "recordPromptHistory") as (
				text: string,
				tab: AgentTab | undefined,
			) => void,
			editor: { addToHistory: () => {}, setText: () => {} },
			showStatus: () => {},
		};

		const queueCompactionMessage = Reflect.get(InteractiveMode.prototype, "queueCompactionMessage") as (
			this: typeof context,
			text: string,
			mode: "steer" | "followUp",
		) => void;
		queueCompactionMessage.call(context, "PARKED", "steer");
		context.resyncQueuedMessageMirrors.call(context);

		expect(state.pendingSteer).toEqual(["PARKED", "MIRRORED"]);
		expect(state.queuedSteerCount).toBe(1);
	});
});
