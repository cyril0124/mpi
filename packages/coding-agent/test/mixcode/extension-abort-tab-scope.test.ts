import { describe, expect, it, vi } from "vitest";
import { createFollowUpQueueState } from "../../src/core/mixcode/follow-up/runtime-follow-up-queue.ts";
import { InteractiveMode } from "../../src/modes/interactive/interactive-mode.ts";

type AbortSession = {
	abort: () => Promise<void>;
	clearQueue: () => { steering: string[]; followUp: string[] };
};
type AbortTab = { id: string; draftInput: string; runtime: { session: AbortSession } };

type CompactionQueuedMessage = { text: string; mode: "steer" | "followUp" };

type AbortContext = {
	session: AbortSession;
	homeSelection: { active: boolean };
	tabManager?: { list: () => AbortTab[]; setDraft: (id: string, text: string) => void };
	compactionQueues: Map<string, CompactionQueuedMessage[]>;
	compactionQueueFor: (tabId: string) => CompactionQueuedMessage[];
	followUpStates: Map<string, ReturnType<typeof createFollowUpQueueState>>;
	restoreQueuedMessagesToEditor: (options?: { abort?: boolean }) => number;
};

const abortTabFromExtension = Reflect.get(InteractiveMode.prototype, "abortTabFromExtension") as (
	this: AbortContext,
	session: AbortSession,
) => void;

function createSession(options: { steering?: string[]; followUp?: string[] } = {}): AbortSession {
	return {
		abort: vi.fn(async () => {}),
		clearQueue: vi.fn(() => ({ steering: options.steering ?? [], followUp: options.followUp ?? [] })),
	};
}

function createTab(id: string, session: AbortSession, draftInput = ""): AbortTab {
	return { id, draftInput, runtime: { session } };
}

function createContext(options: { tabs: AbortTab[]; mounted: AbortSession; homeActive?: boolean }): AbortContext {
	const compactionQueues = new Map<string, CompactionQueuedMessage[]>();
	return {
		session: options.mounted,
		homeSelection: { active: options.homeActive ?? false },
		tabManager: {
			list: () => options.tabs,
			setDraft: (id, text) => {
				const tab = options.tabs.find((candidate) => candidate.id === id);
				if (tab) tab.draftInput = text;
			},
		},
		compactionQueues,
		compactionQueueFor: (tabId) => {
			let queue = compactionQueues.get(tabId);
			if (!queue) {
				queue = [];
				compactionQueues.set(tabId, queue);
			}
			return queue;
		},
		followUpStates: new Map(),
		// Stands in for the composer restore and the mounted session's own abort.
		restoreQueuedMessagesToEditor: vi.fn(() => 0),
	};
}

describe("extension abort scoping", () => {
	it("aborts a background tab's own run and leaves the tab in front alone", () => {
		const backgroundSession = createSession({ steering: ["queued steer"] });
		const mountedSession = createSession();
		const backgroundTab = createTab("b", backgroundSession);
		const mountedTab = createTab("a", mountedSession);
		const context = createContext({ tabs: [mountedTab, backgroundTab], mounted: mountedSession });
		const state = createFollowUpQueueState();
		state.followUpQueue.push({ text: "queued round", kind: "next" });
		context.followUpStates.set(backgroundTab.id, state);

		abortTabFromExtension.call(context, backgroundSession);

		expect(backgroundSession.abort).toHaveBeenCalledTimes(1);
		expect(mountedSession.abort).not.toHaveBeenCalled();
		expect(context.restoreQueuedMessagesToEditor).not.toHaveBeenCalled();
		// The stopped tab keeps its rounds, paused, instead of dispatching them into a stopped run.
		expect(state.followUpsPaused).toBe(true);
		// Its queued text waits on the tab instead of firing into the aborted session.
		expect(backgroundTab.draftInput).toBe("queued steer");
		expect(mountedTab.draftInput).toBe("");
	});

	it("keeps the composer restore for the session the tab in front shows", () => {
		const mountedSession = createSession();
		const mountedTab = createTab("a", mountedSession);
		const context = createContext({ tabs: [mountedTab], mounted: mountedSession });

		abortTabFromExtension.call(context, mountedSession);

		expect(context.restoreQueuedMessagesToEditor).toHaveBeenCalledWith({ abort: true });
		expect(mountedSession.abort).not.toHaveBeenCalled();
		expect(mountedTab.draftInput).toBe("");
	});

	it("leaves Home's composer alone for the session it still points at", () => {
		const session = createSession({ followUp: ["queued round"] });
		const tab = createTab("a", session);
		const context = createContext({ tabs: [tab], mounted: session, homeActive: true });

		abortTabFromExtension.call(context, session);

		// Home's composer belongs to the roster: a restore there is emptied by leaveHome.
		expect(context.restoreQueuedMessagesToEditor).not.toHaveBeenCalled();
		expect(session.abort).toHaveBeenCalledTimes(1);
		expect(tab.draftInput).toBe("queued round");
	});

	it("still aborts a bound session whose tab is already gone", () => {
		const closedSession = createSession();
		const mountedSession = createSession();
		const context = createContext({ tabs: [], mounted: mountedSession });

		abortTabFromExtension.call(context, closedSession);

		expect(closedSession.abort).toHaveBeenCalledTimes(1);
		expect(context.restoreQueuedMessagesToEditor).not.toHaveBeenCalled();
	});
});
