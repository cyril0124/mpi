import { describe, expect, it, vi } from "vitest";
import { createFollowUpQueueState } from "../../src/core/mixcode/follow-up/runtime-follow-up-queue.ts";
import { InteractiveMode } from "../../src/modes/interactive/interactive-mode.ts";

type AbortSession = { abort: () => Promise<void> };
type AbortTab = { id: string; runtime: { session: AbortSession } };

type AbortContext = {
	session: AbortSession;
	tabManager?: { list: () => AbortTab[] };
	followUpStates: Map<string, ReturnType<typeof createFollowUpQueueState>>;
	restoreQueuedMessagesToEditor: (options?: { abort?: boolean }) => number;
};

const abortTabFromExtension = Reflect.get(InteractiveMode.prototype, "abortTabFromExtension") as (
	this: AbortContext,
	session: AbortSession,
) => void;

function createContext(options: { tabs: AbortTab[]; mounted: AbortSession }): AbortContext {
	return {
		session: options.mounted,
		tabManager: { list: () => options.tabs },
		followUpStates: new Map(),
		// Stands in for the composer restore and the mounted session's own abort.
		restoreQueuedMessagesToEditor: vi.fn(() => 0),
	};
}

describe("extension abort scoping", () => {
	it("aborts a background tab's own run and leaves the tab in front alone", () => {
		const backgroundSession: AbortSession = { abort: vi.fn(async () => {}) };
		const mountedSession: AbortSession = { abort: vi.fn(async () => {}) };
		const backgroundTab: AbortTab = { id: "b", runtime: { session: backgroundSession } };
		const mountedTab: AbortTab = { id: "a", runtime: { session: mountedSession } };
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
	});

	it("keeps the composer restore for the session the tab in front shows", () => {
		const mountedSession: AbortSession = { abort: vi.fn(async () => {}) };
		const mountedTab: AbortTab = { id: "a", runtime: { session: mountedSession } };
		const context = createContext({ tabs: [mountedTab], mounted: mountedSession });

		abortTabFromExtension.call(context, mountedSession);

		expect(context.restoreQueuedMessagesToEditor).toHaveBeenCalledWith({ abort: true });
		expect(mountedSession.abort).not.toHaveBeenCalled();
	});

	it("still aborts a bound session whose tab is already gone", () => {
		const closedSession: AbortSession = { abort: vi.fn(async () => {}) };
		const mountedSession: AbortSession = { abort: vi.fn(async () => {}) };
		const context = createContext({ tabs: [], mounted: mountedSession });

		abortTabFromExtension.call(context, closedSession);

		expect(closedSession.abort).toHaveBeenCalledTimes(1);
		expect(context.restoreQueuedMessagesToEditor).not.toHaveBeenCalled();
	});
});
