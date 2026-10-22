import { stripTerminalSequences } from "@earendil-works/pi-tui";
import { describe, expect, it } from "vitest";
import type { AgentSessionEventListener } from "../../src/core/agent-session.ts";
import type { AgentSessionRuntime, CreateAgentSessionRuntimeFactory } from "../../src/core/agent-session-runtime.ts";
import { TabManager } from "../../src/core/mixcode/multi-tab/tab-manager.ts";
import { TabBar } from "../../src/modes/interactive/components/mixcode/multi-tab/tab-bar.ts";
import { initTheme, theme } from "../../src/modes/interactive/theme/theme.ts";

/** The manager only reads the session name and directory, and subscribes when it attaches a tab. */
function stubRuntime(name?: string): AgentSessionRuntime {
	return {
		cwd: "/tmp",
		session: {
			sessionManager: { getSessionName: () => name, getSessionDir: () => "/tmp" },
			subscribe: () => () => {},
		},
	} as unknown as AgentSessionRuntime;
}

/**
 * A runtime whose session is swapped in place, the way `/clear` does it:
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
 * and lands on the user's agent directory, so a plain focus change must not report
 * one: focusing a tab is not a layout change, and reporting it would cost a write
 * plus a lock. Clearing an unread badge is the exception, because that badge is
 * persisted state.
 */
function createManager(
	initialRuntime: AgentSessionRuntime = stubRuntime(),
	createRuntime: CreateAgentSessionRuntimeFactory = () => Promise.reject(new Error("not used")),
): {
	manager: TabManager;
	counters: { layoutChanges: number; tabsChanges: number };
} {
	const counters = { layoutChanges: 0, tabsChanges: 0 };
	const manager = new TabManager({
		initialRuntime,
		initialTitle: "Agent-01",
		createRuntime,
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

	it("reports a layout change when a focus clears an unread badge", () => {
		const { manager, counters } = createManager();
		const tab = manager.getActive();
		manager.markLoaded(tab.id);
		manager.markDone(tab.id);
		expect(tab.unread).toBe(true);
		const before = counters.layoutChanges;

		manager.activate(tab.id);

		expect(tab.unread).toBe(false);
		// The cleared badge has to reach disk, or the peer layout poll restores it.
		expect(counters.layoutChanges).toBe(before + 1);
	});

	it("reports a layout change when a tab is marked done", () => {
		const { manager, counters } = createManager();
		const tab = manager.getActive();
		manager.markLoaded(tab.id);
		const before = counters.layoutChanges;

		manager.markDone(tab.id);

		expect(tab.unread).toBe(true);
		// The badge is persisted state, so the mark has to reach disk by itself.
		expect(counters.layoutChanges).toBe(before + 1);
	});

	it("reports a layout change when the title or the color changes", () => {
		const { manager, counters } = createManager();
		manager.rename(manager.getActive().id, "renamed");
		manager.setColor(manager.getActive().id, "blue");
		manager.setDraft(manager.getActive().id, "draft");
		expect(counters.layoutChanges).toBe(2);
	});

	it("reports a layout change when a background tab finishes its turn", async () => {
		const firstRuntime = stubRuntime();
		let firstListener: AgentSessionEventListener | undefined;
		firstRuntime.session.subscribe = (next) => {
			firstListener = next;
			return () => {};
		};
		const { manager, counters } = createManager(firstRuntime, (async () => stubRuntime()) as never);
		const tabA = manager.getActive();
		await manager.createTab({ title: "Agent-02" });
		const before = counters.layoutChanges;

		// Agent-01 finishes while Agent-02 holds the focus.
		firstListener?.({ type: "agent_settled" } as never);

		expect(tabA.unread).toBe(true);
		// The peer layout sync re-adopts the badge from disk every couple of seconds, so a
		// badge that only lives in memory is dropped again.
		expect(counters.layoutChanges).toBe(before + 1);
	});

	it("keeps a completion behind MixCode Home unread until the tab is attached", () => {
		const firstRuntime = stubRuntime();
		let listener: AgentSessionEventListener | undefined;
		firstRuntime.session.subscribe = (next) => {
			listener = next;
			return () => {};
		};
		const { manager } = createManager(firstRuntime);
		const tab = manager.getActive();
		manager.markLoaded(tab.id);
		// Home covers every tab, so a run settling here is one the user has not seen.
		manager.setHomeInFront(true);

		listener?.({ type: "agent_settled" } as never);

		expect(tab.status).toBe("done");
		expect(tab.unread).toBe(true);

		// Leaving Home puts the focused tab back in front and attaching clears the badge, so
		// the next completion is one the user watched.
		manager.setHomeInFront(false);
		manager.activate(tab.id);
		expect(tab.unread).toBe(false);
		listener?.({ type: "agent_settled" } as never);
		expect(tab.status).toBe("idle");
		expect(tab.unread).toBe(false);
	});
});

/**
 * A finished background tab can start another run before the user views it.
 * Its current run must replace the check mark, without losing the unread flag.
 */
describe("background completion marker", () => {
	it("shows working, then done, until the tab is viewed", async () => {
		initTheme("dark");
		const firstRuntime = stubRuntime();
		let emitFirst: AgentSessionEventListener | undefined;
		firstRuntime.session.subscribe = (listener) => {
			emitFirst = listener;
			return () => {};
		};
		const { manager } = createManager(firstRuntime, (async () => stubRuntime()) as never);
		const first = manager.getActive();
		await manager.createTab({ title: "Agent-02" });
		const bar = new TabBar(
			() => ({
				tabs: manager.list().map((tab) => ({
					id: tab.id,
					title: tab.title,
					status: tab.status,
					unread: tab.unread,
					recentRank: -1,
				})),
				activeId: manager.getActive().id,
				rulePainter: (text) => text,
			}),
			() => {},
		);
		const renderedChip = () => bar.render(80)[0]!;
		const plainChip = () => stripTerminalSequences(renderedChip());

		expect(emitFirst).toBeDefined();
		emitFirst!({ type: "agent_settled" } as never);
		expect(first.unread).toBe(true);
		expect(plainChip()).toContain("✓ Agent-01");

		emitFirst!({ type: "turn_start" } as never);
		expect(first.status).toBe("running");
		expect(first.unread).toBe(true);
		expect(plainChip()).toContain("● Agent-01");
		expect(renderedChip()).toContain(theme.fg("accent", "●"));

		emitFirst!({ type: "agent_settled" } as never);
		expect(plainChip()).toContain("✓ Agent-01");
		manager.activate(first.id);
		expect(first.unread).toBe(false);
		expect(plainChip()).toContain("- Agent-01");
	});
});

/**
 * A tab title either names the live session or is generated. `/rename` writes the
 * name into the session, so replacing the session with an unnamed one has to drop
 * the title; keeping it leaves the tab announcing a conversation that is gone.
 */
describe("tab titles", () => {
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

	it("keeps a batch-owned title when the session is replaced", () => {
		const { runtime, replaceSession } = replaceableRuntime();
		const { manager } = createManager(runtime);
		manager.lockTitle(manager.getActive().id, "A");

		replaceSession("B");
		manager.rebind(runtime);

		expect(manager.getActive().title).toBe("A");
	});

	it.each(["generated", "renamed", "resumed"] as const)(
		"keeps a %s tab title in sync across successive session renames",
		(titleSource) => {
			const runtime = stubRuntime(titleSource === "resumed" ? "saved-title" : undefined);
			let listener: AgentSessionEventListener | undefined;
			runtime.session.subscribe = (next) => {
				listener = next;
				return () => {};
			};
			const { manager, counters } = createManager(runtime);
			const tab = manager.getActive();
			if (titleSource === "renamed") manager.rename(tab.id, "manual-title");

			for (const name of ["first-generated-title", "second-generated-title"]) {
				const before = { ...counters };
				listener?.({ type: "session_info_changed", name });

				expect(tab.title).toBe(name);
				expect(counters.layoutChanges).toBe(before.layoutChanges + 1);
				expect(counters.tabsChanges).toBe(before.tabsChanges + 1);
			}
		},
	);

	it("keeps a batch-locked title when the session is renamed", () => {
		const runtime = stubRuntime();
		let listener: AgentSessionEventListener | undefined;
		runtime.session.subscribe = (next) => {
			listener = next;
			return () => {};
		};
		const { manager, counters } = createManager(runtime);
		manager.lockTitle(manager.getActive().id, "A");
		const before = { ...counters };

		listener?.({ type: "session_info_changed", name: "B" });

		expect(manager.getActive().title).toBe("A");
		expect(counters).toEqual(before);
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
