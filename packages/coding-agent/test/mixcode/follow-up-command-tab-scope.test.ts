import { describe, expect, it, vi } from "vitest";
import type { AgentSessionRuntime } from "../../src/core/agent-session-runtime.ts";
import { submitFollowUps } from "../../src/core/mixcode/follow-up/runtime-follow-up.ts";
import { TabManager } from "../../src/core/mixcode/multi-tab/tab-manager.ts";
import { SessionManager } from "../../src/core/session-manager.ts";
import { InteractiveMode } from "../../src/modes/interactive/interactive-mode.ts";

/**
 * A queued follow-up round belongs to the tab it was queued on: the round holds
 * that tab's id, while submit routing and the shared composer's `up` history
 * follow the tab in front. Both a plain message and a local command must
 * therefore still reach their own tab after the visible focus moved, and the
 * command text must never be recorded while another tab is mounted.
 */

interface SessionStub {
	isIdle: boolean;
	isStreaming: boolean;
	isCompacting: boolean;
	isBashRunning: boolean;
	prompt: ReturnType<typeof vi.fn>;
	waitForIdle: () => Promise<void>;
	settle: () => void;
	getFollowUpMessages: () => string[];
	getSteeringMessages: () => string[];
	removeQueuedMessages: () => never[];
	restoreQueuedMessages: () => void;
	subscribe: () => () => void;
	sessionManager: SessionManager;
	extensionRunner: { getCommand: (name: string) => { name: string } | undefined };
	promptTemplates: never[];
}

/** A session whose only idle transition is `settle()`, plus the fields submit routing reads. */
function stubSession(firstPrompt: string): SessionStub {
	const sessionManager = SessionManager.inMemory("/tmp");
	sessionManager.appendMessage({ role: "user", content: firstPrompt, timestamp: Date.now() });
	let settle: () => void = () => {};
	const session: SessionStub = {
		isIdle: false,
		isStreaming: false,
		isCompacting: false,
		isBashRunning: false,
		prompt: vi.fn(async () => {}),
		waitForIdle: () => {
			if (session.isIdle) return Promise.resolve();
			return new Promise<void>((resolve) => {
				settle = resolve;
			});
		},
		settle: () => {
			session.isIdle = true;
			settle();
		},
		getFollowUpMessages: () => [],
		getSteeringMessages: () => [],
		removeQueuedMessages: () => [],
		restoreQueuedMessages: () => {},
		subscribe: () => () => {},
		sessionManager,
		extensionRunner: { getCommand: (command) => (command === "demo-command" ? { name: command } : undefined) },
		promptTemplates: [],
	};
	return session;
}

/** The runtime shape a tab holds: a cwd and one session. */
function stubRuntime(session: SessionStub): AgentSessionRuntime {
	return { cwd: "/tmp", session } as unknown as AgentSessionRuntime;
}

/**
 * The composer surface `up`/`down` read. A real `setHistory` replaces the list
 * and `addToHistory` prepends, so the list is what a recalled entry would be.
 * `mountedTab` reports the tab the UI is showing, so every write is recorded
 * against the surface it landed on.
 */
function stubEditor(mountedTab: () => string | undefined): EditorStub {
	const editor: EditorStub = {
		history: [],
		historyWrites: [],
		text: "",
		getText: () => editor.text,
		setText: (text) => {
			editor.text = text;
		},
		addToHistory(text) {
			editor.historyWrites.push({ text, mountedTab: mountedTab() });
			if (editor.history[0] !== text) editor.history.unshift(text);
		},
		setHistory(texts) {
			editor.history = [...texts].reverse();
		},
	};
	return editor;
}

/** One `up` history write, with the tab the composer belonged to at the time. */
interface HistoryWrite {
	text: string;
	mountedTab: string | undefined;
}

/** The composer fields the history seeding and the submit path touch. */
interface EditorStub {
	history: string[];
	historyWrites: HistoryWrite[];
	text: string;
	onSubmit?: (text: string) => void | Promise<void>;
	getText(): string;
	setText(text: string): void;
	addToHistory(text: string): void;
	setHistory(texts: readonly string[]): void;
}

interface FollowUpQueueStateStub {
	followUpDrain?: Promise<void>;
}

type ScopedHost = {
	tabManager: TabManager;
	runtimeHost: AgentSessionRuntime;
	activeTabIdForUi: string | undefined;
	editor: EditorStub;
	defaultEditor: EditorStub;
};

const proto = InteractiveMode.prototype as unknown as Record<string, unknown>;
const setupEditorSubmitHandler = proto.setupEditorSubmitHandler as (this: ScopedHost) => void;
const syncEditorHistory = proto.syncEditorHistory as (this: ScopedHost) => void;
const followUpHostGetter = Object.getOwnPropertyDescriptor(proto, "followUpHost")!.get as (this: ScopedHost) => {
	runQueuedCommand(text: string): Promise<void>;
};
const followUpStateGetter = Object.getOwnPropertyDescriptor(proto, "followUpState")!.get as (this: ScopedHost) => never;

/**
 * The two tabs, a mounted composer and the follow-up host a running instance
 * would have. The render stack the real `activateTab` also drives is not part of
 * this routing, so the mount below performs only the fields that decide it: the
 * manager's focus, the mounted tab, and the composer history reseed.
 */
async function createTwoTabHost(): Promise<{
	context: ScopedHost & Record<string, unknown>;
	editor: EditorStub;
	sessionA: SessionStub;
	sessionB: SessionStub;
	tabA: ReturnType<TabManager["getActive"]>;
	tabB: ReturnType<TabManager["getActive"]>;
	mount: (tab: { id: string; runtime: AgentSessionRuntime }) => void;
}> {
	const sessionA = stubSession("first prompt on A");
	const sessionB = stubSession("first prompt on B");
	const runtimeA = stubRuntime(sessionA);
	const runtimeB = stubRuntime(sessionB);
	const manager = new TabManager({
		initialRuntime: runtimeA,
		initialTitle: "Agent-01",
		createRuntime: (async () => runtimeB) as never,
		agentDir: "/tmp",
		onTabsChanged: () => {},
		configureRuntime: () => {},
	});
	const tabA = manager.getActive();
	const tabB = await manager.createTab({ title: "Agent-02" });
	// Queuing happens on Agent-01, so that is the tab in front and in focus.
	manager.activate(tabA.id);

	const context = Object.create(InteractiveMode.prototype) as ScopedHost & Record<string, unknown>;
	const editor = stubEditor(() => context.activeTabIdForUi);
	Object.assign(context, {
		tabManager: manager,
		runtimeHost: runtimeA,
		activeTabIdForUi: tabA.id,
		editor,
		defaultEditor: editor,
		stashedPrompts: new Map(),
		followUpStates: new Map(),
		compactionQueues: new Map(),
		compactionClaimed: false,
		homeSelection: { active: false },
		ui: { requestRender: () => {} },
		showError: () => {},
		showWarning: () => {},
		showStatus: () => {},
		// UI-only surfaces the routing does not depend on.
		updatePendingMessagesDisplay: () => {},
		flushPendingBashComponents: () => {},
		ensureSessionBoundForSubmit: async () => {},
	});
	const mount = (tab: { id: string; runtime: AgentSessionRuntime }): void => {
		context.tabManager.activate(tab.id);
		context.runtimeHost = tab.runtime;
		context.activeTabIdForUi = tab.id;
		// `switchActiveTab` hands the incoming tab's parked draft to the composer.
		editor.setText(context.tabManager.get(tab.id)?.draftInput ?? "");
		syncEditorHistory.call(context as ScopedHost);
	};
	// The host mounts the queued round's own tab before submitting, exactly as the
	// built-in `activateTab` does through `switchActiveTab`.
	(context as Record<string, unknown>).activateTab = async (tab: { id: string }) => {
		if (tab.id === context.activeTabIdForUi) return;
		const target = manager.get(tab.id);
		if (target) mount(target);
	};
	// An extension command queues as a host round; the dispatch below is the real
	// submit pipeline, which is what runs it when the round arrives.
	(context as Record<string, unknown>).isQueuedFollowUpCommand = (text: string) => text.startsWith("/demo-command");
	setupEditorSubmitHandler.call(context as ScopedHost);
	// The real `Editor.submitValue()` empties the composer before it calls `onSubmit`; the stub has to
	// clear too, or a round that runs through the composer would not be exercised.
	const submit = editor.onSubmit;
	editor.onSubmit = (text) => {
		editor.setText("");
		return submit?.(text);
	};
	return { context, editor, sessionA, sessionB, tabA, tabB, mount };
}

describe("a queued follow-up round stays with its tab", () => {
	it("runs a queued command on its own tab, out of the focused tab's history", async () => {
		const { context, editor, sessionA, sessionB, tabA, tabB, mount } = await createTwoTabHost();
		const host = followUpHostGetter.call(context as ScopedHost);
		const state = followUpStateGetter.call(context as ScopedHost) as FollowUpQueueStateStub;
		// Agent-01 is mid-turn, so the round waits for it to settle.
		await submitFollowUps(state as never, host as never, ["/demo-command tighten this"], "batch");
		expect(state.followUpDrain).toBeDefined();

		// Focus moves to Agent-02 while Agent-01 is still running, which parks A's draft.
		mount(tabB);
		expect(editor.history).toEqual(["first prompt on B"]);
		context.tabManager.setDraft(tabA.id, "draft typed on A");

		// Agent-01 settles, so its queued round executes now.
		sessionA.settle();
		await state.followUpDrain;
		// The submit pipeline hands the prompt off through a promise chain.
		await new Promise((resolve) => setImmediate(resolve));

		// The command ran on the tab that queued it, not on the tab in front.
		expect(sessionA.prompt).toHaveBeenCalledWith("/demo-command tighten this");
		expect(sessionB.prompt).not.toHaveBeenCalled();
		// Nothing was recorded while Agent-02 was the tab on screen.
		expect(editor.historyWrites).toEqual([{ text: "/demo-command tighten this", mountedTab: tabA.id }]);
		// The round put the mounted tab's draft back after the command cleared the composer.
		expect(editor.getText()).toBe("draft typed on A");
	});

	it("keeps dispatching a plain queued message to its own tab", async () => {
		const { context, editor, sessionA, sessionB, tabB, mount } = await createTwoTabHost();
		const host = followUpHostGetter.call(context as ScopedHost);
		const state = followUpStateGetter.call(context as ScopedHost) as FollowUpQueueStateStub;
		await submitFollowUps(state as never, host as never, ["a plain queued message"], "batch");
		mount(tabB);

		sessionA.settle();
		await state.followUpDrain;
		await new Promise((resolve) => setImmediate(resolve));

		expect(sessionA.prompt).toHaveBeenCalledWith("a plain queued message", { preflightResult: expect.any(Function) });
		expect(sessionB.prompt).not.toHaveBeenCalled();
		// A plain round adds nothing to any composer history.
		expect(editor.historyWrites).toEqual([]);
	});
});
