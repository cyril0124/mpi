/**
 * `/reset` transcript work belongs to the tab that ran the command. The reset awaits the
 * `session_tree` handlers and keys keep arriving, so a tab switch can land while it runs; the
 * transcript rebuild, the notice and the compaction flush must stay on the tab that asked
 * instead of acting on whichever tab is mounted when the handlers return.
 */
import { describe, expect, it, vi } from "vitest";
import { InteractiveMode } from "../../src/modes/interactive/interactive-mode.ts";

type ResetSession = {
	isBashRunning: boolean;
	resetLeafToRoot: () => Promise<{ noop: boolean }>;
};

type ResetTab = { id: string; runtime: { session: ResetSession } };

type ResetContext = {
	session: ResetSession;
	tabManager: { activeTab: () => ResetTab | undefined; get: (id: string) => ResetTab | undefined };
	activeTabIdForUi: string;
	homeSelection: { active: boolean };
	chatContainer: { clear: () => void };
	renderInitialMessages: () => void;
	showStatus: (message: string) => void;
	showWarning: (message: string) => void;
	showError: (message: string) => void;
	flushCompactionQueue: (options?: { willRetry?: boolean; tabId?: string }) => void;
};

const handleResetCommand = Reflect.get(InteractiveMode.prototype, "handleResetCommand") as (
	this: ResetContext,
) => Promise<void>;

function createTab(id: string): ResetTab {
	return {
		id,
		runtime: { session: { isBashRunning: false, resetLeafToRoot: async () => ({ noop: false }) } },
	};
}

interface Scenario {
	context: ResetContext;
	mountedTab: () => ResetTab;
	renderInitialMessages: ReturnType<typeof vi.fn>;
	clear: ReturnType<typeof vi.fn>;
	showStatus: ReturnType<typeof vi.fn>;
	flushCompactionQueue: ReturnType<typeof vi.fn>;
}

/**
 * Two tabs. `resetLeafToRoot` flips the mounted surface the way a `tab` submitted while the
 * `session_tree` handlers run would: by the time it resolves, the other tab is in front.
 */
function createScenario(options: { switchDuringReset: boolean; noop?: boolean }): Scenario {
	const requestingTab = createTab("a");
	const otherTab = createTab("b");
	let mounted = requestingTab;
	const renderInitialMessages = vi.fn();
	const clear = vi.fn();
	const showStatus = vi.fn();
	const flushCompactionQueue = vi.fn();
	requestingTab.runtime.session.resetLeafToRoot = async () => {
		if (options.switchDuringReset) mounted = otherTab;
		return { noop: options.noop ?? false };
	};
	const context: ResetContext = {
		get session() {
			return mounted.runtime.session;
		},
		tabManager: {
			activeTab: () => mounted,
			get: (id) => (id === requestingTab.id ? requestingTab : id === otherTab.id ? otherTab : undefined),
		},
		get activeTabIdForUi() {
			return mounted.id;
		},
		homeSelection: { active: false },
		chatContainer: { clear },
		renderInitialMessages,
		showStatus,
		showWarning: vi.fn(),
		showError: vi.fn(),
		flushCompactionQueue,
	};
	return {
		context,
		mountedTab: () => mounted,
		renderInitialMessages,
		clear,
		showStatus,
		flushCompactionQueue,
	};
}

describe("reset keeps its transcript work on the tab that ran it", () => {
	it("rebuilds the transcript and reports on the tab that asked", async () => {
		const scenario = createScenario({ switchDuringReset: false });

		await handleResetCommand.call(scenario.context);

		expect(scenario.clear).toHaveBeenCalledTimes(1);
		expect(scenario.renderInitialMessages).toHaveBeenCalledTimes(1);
		expect(scenario.showStatus).toHaveBeenCalledWith("Reset to session root. Earlier branches are in /tree.");
		expect(scenario.flushCompactionQueue).toHaveBeenCalledWith({ willRetry: false, tabId: "a" });
	});

	it("leaves the tab that came to the front alone when the reset outlives a tab switch", async () => {
		const scenario = createScenario({ switchDuringReset: true });

		await handleResetCommand.call(scenario.context);

		expect(scenario.mountedTab().id).toBe("b");
		// The tab that came to the front keeps its own transcript; the reset tab rebuilds from
		// the new branch when it is shown again.
		expect(scenario.clear).not.toHaveBeenCalled();
		expect(scenario.renderInitialMessages).not.toHaveBeenCalled();
		expect(scenario.showStatus).not.toHaveBeenCalled();
		// The queued rounds belong to the tab that reset, not to the tab in front.
		expect(scenario.flushCompactionQueue).toHaveBeenCalledWith({ willRetry: false, tabId: "a" });
	});

	it("reports a no-op only while its tab is still the one on screen", async () => {
		const mounted = createScenario({ switchDuringReset: false, noop: true });
		await handleResetCommand.call(mounted.context);
		expect(mounted.showStatus).toHaveBeenCalledWith("Already at session root (nothing to reset).");
		expect(mounted.flushCompactionQueue).not.toHaveBeenCalled();

		const parked = createScenario({ switchDuringReset: true, noop: true });
		await handleResetCommand.call(parked.context);
		expect(parked.showStatus).not.toHaveBeenCalled();
		expect(parked.renderInitialMessages).not.toHaveBeenCalled();
	});
});
