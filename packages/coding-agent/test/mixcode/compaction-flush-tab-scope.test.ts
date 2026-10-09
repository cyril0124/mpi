/**
 * A message parked during `/compact` belongs to the tab that queued it. The parked queue is
 * keyed by tab, and that tab's compaction can end while another tab is on screen, so the flush
 * has to send into the queue's own session and that compaction end has to reach the flush.
 * Resolving either one from the focused tab leaves the text parked on its own tab.
 */
import { describe, expect, it, vi } from "vitest";
import type { AgentSessionRuntime } from "../../src/core/agent-session-runtime.ts";
import { TabManager } from "../../src/core/mixcode/multi-tab/tab-manager.ts";
import { SessionManager } from "../../src/core/session-manager.ts";
import { InteractiveMode } from "../../src/modes/interactive/interactive-mode.ts";

/** The session fields the compaction flush, the tab manager and the tab bar read. */
interface SessionStub {
	prompt: ReturnType<typeof vi.fn>;
	steer: ReturnType<typeof vi.fn>;
	followUp: ReturnType<typeof vi.fn>;
	clearQueue: ReturnType<typeof vi.fn>;
	getSteeringMessages: () => string[];
	getFollowUpMessages: () => string[];
	extensionRunner: { getCommand: () => undefined };
	sessionManager: SessionManager;
	subscribe: (handler: (event: unknown) => void) => () => void;
	emit: (event: unknown) => void;
}

/** A session that records its prompts and replays tab events on demand. */
function stubSession(): { session: SessionStub; runtime: AgentSessionRuntime } {
	let handler: ((event: unknown) => void) | undefined;
	const session = {
		prompt: vi.fn(async () => {}),
		steer: vi.fn(async () => {}),
		followUp: vi.fn(async () => {}),
		clearQueue: vi.fn(),
		getSteeringMessages: () => [],
		getFollowUpMessages: () => [],
		extensionRunner: { getCommand: () => undefined },
		sessionManager: SessionManager.inMemory("/tmp"),
		subscribe: (next: (event: unknown) => void) => {
			handler = next;
			return () => {};
		},
		emit: (event: unknown) => handler?.(event),
	} satisfies SessionStub;
	const runtime = { cwd: "/tmp", session } as unknown as AgentSessionRuntime;
	return { session, runtime };
}

type Tab = ReturnType<TabManager["getActive"]>;
type ModeContext = Record<string, unknown> & {
	tabManager: TabManager;
	runtimeHost: AgentSessionRuntime;
	activeTabIdForUi: string | undefined;
	showError: ReturnType<typeof vi.fn>;
};

const proto = InteractiveMode.prototype as unknown as Record<string, unknown>;
const flushCompactionQueue = proto.flushCompactionQueue as (
	this: ModeContext,
	options?: { willRetry?: boolean; tabId?: string },
) => Promise<void>;
const queueCompactionMessage = proto.queueCompactionMessage as (
	this: ModeContext,
	text: string,
	mode: "steer" | "followUp",
) => void;

/**
 * Two tabs in a real `TabManager`, plus the mode surface the flush reads. `focus`
 * performs the focus move a tab switch makes, so the test can tell which tab the
 * flush treats as the one on screen.
 */
async function createTwoTabContext(options: {
	onCompactionEnd?: (tabId: string, willRetry: boolean) => void;
}): Promise<{
	context: ModeContext;
	sessionA: SessionStub;
	sessionB: SessionStub;
	tabA: Tab;
	tabB: Tab;
	focus: (tab: Tab) => void;
}> {
	const { session: sessionA, runtime: runtimeA } = stubSession();
	const { session: sessionB, runtime: runtimeB } = stubSession();
	const manager = new TabManager({
		initialRuntime: runtimeA,
		initialTitle: "Agent-01",
		createRuntime: (async () => runtimeB) as never,
		agentDir: "/tmp",
		onTabsChanged: () => {},
		onCompactionEnd: options.onCompactionEnd,
		configureRuntime: () => {},
	});
	const tabA = manager.getActive();
	const tabB = await manager.createTab({ title: "Agent-02" });

	const context = Object.create(InteractiveMode.prototype) as ModeContext;
	Object.assign(context, {
		tabManager: manager,
		runtimeHost: runtimeA,
		activeTabIdForUi: tabA.id,
		followUpStates: new Map(),
		compactionQueues: new Map(),
		promptHistory: new Map<string, string[]>(),
		homeSelection: { active: false },
		showError: vi.fn(),
		showStatus: vi.fn(),
		editor: { addToHistory: vi.fn(), setText: vi.fn() },
		updatePendingMessagesDisplay: vi.fn(),
	});
	const focus = (tab: Tab): void => {
		manager.activate(tab.id);
		context.runtimeHost = tab.runtime;
		context.activeTabIdForUi = tab.id;
	};
	// `createTab` focuses the new tab; start with Agent-01 in front, which is where the
	// parked message is queued.
	focus(tabA);
	return { context, sessionA, sessionB, tabA, tabB, focus };
}

describe("a message parked during compaction", () => {
	it("is flushed into the session that queued it, not the focused one", async () => {
		const { context, sessionA, sessionB, tabA, tabB, focus } = await createTwoTabContext({});
		// The real parking path: the user submits while Agent-01 compacts, which puts the
		// text in that tab's queue and its preview.
		queueCompactionMessage.call(context, "park-me", "steer");

		// Agent-02 is the tab on screen when Agent-01's compaction ends.
		focus(tabB);
		await flushCompactionQueue.call(context, { willRetry: false, tabId: tabA.id });

		expect(sessionA.prompt).toHaveBeenCalledWith("park-me", { streamingBehavior: "steer" });
		expect(sessionB.prompt).not.toHaveBeenCalled();
		expect(context.showError).not.toHaveBeenCalled();
	});

	it("reports a background tab's compaction end, and leaves the focused tab's to its own handler", async () => {
		const onCompactionEnd = vi.fn();
		const { tabA, tabB, sessionA, focus } = await createTwoTabContext({ onCompactionEnd });

		// Agent-01 is focused: the mode's own event handler flushes this one.
		sessionA.emit({ type: "compaction_end", willRetry: false });
		expect(onCompactionEnd).not.toHaveBeenCalled();

		focus(tabB);
		sessionA.emit({ type: "compaction_end", willRetry: true });
		expect(onCompactionEnd).toHaveBeenCalledWith(tabA.id, true);
	});
});
