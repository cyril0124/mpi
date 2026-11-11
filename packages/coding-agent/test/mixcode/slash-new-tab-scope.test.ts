/**
 * `/new` side effects belong to the tab that ran the command. The session replacement awaits and
 * keys keep arriving, so a tab switch can land while it runs; the chip color reset, the discarded
 * follow-up rounds and the "New session started" line must stay on the tab that asked.
 */
import { describe, expect, it, vi } from "vitest";
import { createFollowUpQueueState } from "../../src/core/mixcode/follow-up/runtime-follow-up-queue.ts";
import { InteractiveMode } from "../../src/modes/interactive/interactive-mode.ts";

type ClearSession = {
	isBashRunning: boolean;
	isStreaming: boolean;
	sessionManager: { getHeader: () => { parentSession?: string } | undefined };
};

type ClearTab = { id: string; runtime: { session: ClearSession } };

type ClearContext = {
	session: ClearSession;
	runtimeHost: { newSession: (options?: unknown) => Promise<{ cancelled: boolean }> };
	tabManager: {
		activeTab: () => ClearTab | undefined;
		get: (id: string) => ClearTab | undefined;
		setColor: (id: string, color: string | undefined) => void;
	};
	activeTabIdForUi: string;
	homeSelection: { active: boolean };
	/** Live view of the mounted tab's queue, the way the mode's getter reads it. */
	followUpState: ReturnType<typeof createFollowUpQueueState>;
	followUpStates: Map<string, ReturnType<typeof createFollowUpQueueState>>;
	chatContainer: { addChild: (child: unknown) => void };
	clearStatusIndicator: () => void;
	showWarning: (message: string) => void;
	updatePendingMessagesDisplay: () => void;
	handleFatalRuntimeError: (prefix: string, error: unknown) => Promise<void>;
	ui: { requestRender: () => void };
};

const handleClearCommand = Reflect.get(InteractiveMode.prototype, "handleClearCommand") as (
	this: ClearContext,
) => Promise<void>;

function createSession(): ClearSession {
	return {
		isBashRunning: false,
		isStreaming: false,
		sessionManager: { getHeader: () => ({ parentSession: "parent" }) },
	};
}

function createTab(id: string, session: ClearSession): ClearTab {
	return { id, runtime: { session } };
}

/**
 * Two tabs, with `newSession` switching the UI the way a `/tab` submitted during the replacement
 * would: by the time it resolves, the other tab is the mounted one.
 */
function createContext(options: { switchDuringReplace: boolean }): {
	context: ClearContext;
	requestingTab: ClearTab;
	otherTab: ClearTab;
	requestingState: ReturnType<typeof createFollowUpQueueState>;
	otherState: ReturnType<typeof createFollowUpQueueState>;
} {
	const requestingTab = createTab("a", createSession());
	const otherTab = createTab("b", createSession());
	const requestingState = createFollowUpQueueState();
	requestingState.followUpQueue.push({ text: "queued round", kind: "next" });
	requestingState.pendingFollowUps = ["queued round"];
	requestingState.pendingSteer = ["queued steer"];
	const otherState = createFollowUpQueueState();
	otherState.followUpQueue.push({ text: "other round", kind: "next" });
	otherState.pendingFollowUps = ["other round"];

	let activeId = requestingTab.id;
	const context: ClearContext = {
		get session() {
			return (activeId === requestingTab.id ? requestingTab : otherTab).runtime.session;
		},
		runtimeHost: {
			newSession: async () => {
				if (options.switchDuringReplace) {
					activeId = otherTab.id;
					context.activeTabIdForUi = otherTab.id;
				}
				return { cancelled: false };
			},
		},
		tabManager: {
			activeTab: () => (activeId === requestingTab.id ? requestingTab : otherTab),
			get: (id) => [requestingTab, otherTab].find((tab) => tab.id === id),
			setColor: vi.fn(() => {}),
		},
		activeTabIdForUi: requestingTab.id,
		homeSelection: { active: false },
		get followUpState() {
			return activeId === requestingTab.id ? requestingState : otherState;
		},
		followUpStates: new Map([
			[requestingTab.id, requestingState],
			[otherTab.id, otherState],
		]),
		chatContainer: { addChild: vi.fn(() => {}) },
		clearStatusIndicator: vi.fn(() => {}),
		showWarning: vi.fn(() => {}),
		updatePendingMessagesDisplay: vi.fn(() => {}),
		handleFatalRuntimeError: async (prefix, error) => {
			throw new Error(`${prefix}: ${String(error)}`);
		},
		ui: { requestRender: vi.fn(() => {}) },
	};
	return { context, requestingTab, otherTab, requestingState, otherState };
}

describe("/new tab scope", () => {
	it("resets the chip color and drops the queues of the tab that ran it", async () => {
		const { context, requestingTab, otherTab, requestingState, otherState } = createContext({
			switchDuringReplace: true,
		});

		await handleClearCommand.call(context);

		expect(context.tabManager.setColor).toHaveBeenCalledTimes(1);
		expect(context.tabManager.setColor).toHaveBeenCalledWith(requestingTab.id, undefined);
		expect(context.tabManager.setColor).not.toHaveBeenCalledWith(otherTab.id, undefined);
		expect(requestingState.followUpQueue).toEqual([]);
		expect(requestingState.pendingFollowUps).toEqual([]);
		expect(requestingState.pendingSteer).toEqual([]);
		// The tab in front owns its own conversation and keeps its own queue.
		expect(otherState.followUpQueue).toEqual([{ text: "other round", kind: "next" }]);
		expect(otherState.pendingFollowUps).toEqual(["other round"]);
	});

	it("writes the completion line only while the requesting tab is on screen", async () => {
		const switched = createContext({ switchDuringReplace: true });
		await handleClearCommand.call(switched.context);
		expect(switched.context.chatContainer.addChild).not.toHaveBeenCalled();

		const stayed = createContext({ switchDuringReplace: false });
		await handleClearCommand.call(stayed.context);
		expect(stayed.context.chatContainer.addChild).toHaveBeenCalled();
		expect(stayed.context.updatePendingMessagesDisplay).toHaveBeenCalled();
	});

	it("does nothing to the tab state when the extension cancels the replacement", async () => {
		const { context, requestingState } = createContext({ switchDuringReplace: true });
		context.runtimeHost.newSession = async () => ({ cancelled: true });

		await handleClearCommand.call(context);

		expect(context.tabManager.setColor).not.toHaveBeenCalled();
		expect(requestingState.followUpQueue).toHaveLength(1);
		expect(context.chatContainer.addChild).not.toHaveBeenCalled();
	});
});
