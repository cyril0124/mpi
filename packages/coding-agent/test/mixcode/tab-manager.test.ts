import { describe, expect, it } from "vitest";
import type { AgentSessionRuntime } from "../../src/core/agent-session-runtime.ts";
import { TabManager } from "../../src/core/mixcode/multi-tab/tab-manager.ts";

/** The manager only reads the session name and subscribes when it attaches a tab. */
function stubRuntime(name?: string): AgentSessionRuntime {
	return {
		cwd: "/tmp",
		session: {
			sessionManager: { getSessionName: () => name },
			subscribe: () => () => {},
		},
	} as unknown as AgentSessionRuntime;
}

/**
 * A runtime whose session is swapped in place, the way `/new` and `/resume` do it:
 * the tab keeps the same runtime object and only `session` changes.
 */
function replaceableRuntime(): {
	runtime: AgentSessionRuntime;
	replaceSession: (name?: string) => void;
} {
	const runtime = stubRuntime();
	return {
		runtime,
		replaceSession: (name) => {
			(runtime as unknown as { session: unknown }).session = stubRuntime(name).session;
		},
	};
}

/**
 * `onLayoutChanged` is what writes `open_tabs.json`. That writer is synchronous
 * and lands on the user's agent directory, so a focus change must not report one:
 * focusing a tab is not a layout change, and every switch used to pay for a write
 * plus a lock it did not need.
 */
function createManager(initialRuntime: AgentSessionRuntime = stubRuntime()): {
	manager: TabManager;
	counters: { layoutChanges: number; tabsChanges: number };
} {
	const counters = { layoutChanges: 0, tabsChanges: 0 };
	const manager = new TabManager({
		initialRuntime,
		initialTitle: "Agent-01",
		createRuntime: (() => Promise.reject(new Error("not used"))) as never,
		agentDir: "/tmp",
		onTabsChanged: () => {
			counters.tabsChanges += 1;
		},
		onLayoutChanged: () => {
			counters.layoutChanges += 1;
		},
		configureRuntime: () => {},
	});
	return { manager, counters };
}

describe("tab layout persistence", () => {
	it("does not report a layout change when a tab takes focus", () => {
		const { manager, counters } = createManager();
		manager.activate(manager.getActive().id);
		expect(counters.layoutChanges).toBe(0);
		expect(counters.tabsChanges).toBe(1);
	});

	it("reports a layout change when the title or the color changes", () => {
		const { manager, counters } = createManager();
		manager.rename(manager.getActive().id, "renamed");
		manager.setColor(manager.getActive().id, "blue");
		manager.setDraft(manager.getActive().id, "draft");
		expect(counters.layoutChanges).toBe(2);
	});
});

/**
 * A tab title either names the live session or is generated. `/rename` writes the
 * name into the session, so replacing the session with an unnamed one has to drop
 * the title; keeping it leaves the tab announcing a conversation that is gone.
 */
describe("tab title after a session replacement", () => {
	it("drops a custom title when the replacement session has no name", () => {
		const { runtime, replaceSession } = replaceableRuntime();
		const { manager, counters } = createManager(runtime);
		manager.rename(manager.getActive().id, "renamed");
		const before = counters.layoutChanges;

		replaceSession(undefined);
		manager.rebind(runtime);

		const tab = manager.getActive();
		expect(tab.title).toBe("Agent-01");
		expect(tab.autoTitle).toBe(true);
		// The persisted title has to change too, or the drop is lost on restart.
		expect(counters.layoutChanges).toBe(before + 1);
	});

	it("keeps a generated title and its number", () => {
		const { runtime, replaceSession } = replaceableRuntime();
		const { manager, counters } = createManager(runtime);
		const before = counters.layoutChanges;

		replaceSession(undefined);
		manager.rebind(runtime);

		expect(manager.getActive().title).toBe("Agent-01");
		expect(counters.layoutChanges).toBe(before);
	});

	it("follows the session name when the replacement carries one", () => {
		const { runtime, replaceSession } = replaceableRuntime();
		const { manager } = createManager(runtime);
		manager.rename(manager.getActive().id, "renamed");

		replaceSession("resumed");
		manager.rebind(runtime);

		const tab = manager.getActive();
		expect(tab.title).toBe("resumed");
		expect(tab.autoTitle).toBe(false);
	});
});

/**
 * A tab carries the loading state until its runtime is bound, which is what puts a
 * spinner on its chip; `/mark-done` must not be able to mark a tab that is not usable
 * yet, and clearing the state must be idempotent.
 */
describe("tab loading state", () => {
	it("starts loading and clears once, when the tab is marked loaded", () => {
		const { manager } = createManager();
		const tab = manager.getActive();
		expect(tab.loading).toBe(true);
		expect(manager.markLoaded(tab.id)).toBe(true);
		expect(tab.loading).toBe(false);
		expect(manager.markLoaded(tab.id)).toBe(false);
	});

	it("refuses /mark-done while the tab is loading", () => {
		const { manager } = createManager();
		expect(() => manager.markDone(manager.getActive().id)).toThrow(/still loading/);
	});
});
