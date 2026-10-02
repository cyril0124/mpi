import { describe, expect, test } from "vitest";
import { InteractiveMode } from "../../src/modes/interactive/interactive-mode.ts";

/**
 * Startup loading strategy at the roster level: while a restore is running, a
 * persisted tab whose runtime does not exist yet is a placeholder row, so Home
 * lists the whole layout from the first frame. The roster helpers are private;
 * the test reaches them through the prototype, as the other mode tests do.
 */
interface LiveTabStub {
	id: string;
	status: string;
	unread: boolean;
	loading: boolean;
	loadingPhase?: string;
}
type RosterRow = {
	id: string;
	status: string;
	unread: boolean;
	loadingPhase?: string;
	tab?: LiveTabStub;
};
type RosterThis = {
	tabManager: { list(): LiveTabStub[] };
	restoringTabs: Array<{ id: string; title: string; color?: string; phase?: string }>;
	homeRosterEntry(tab: LiveTabStub, phase?: string): RosterRow;
};
const homeRoster = Reflect.get(InteractiveMode.prototype, "homeRoster") as (this: RosterThis) => RosterRow[];
const homeRosterEntry = Reflect.get(InteractiveMode.prototype, "homeRosterEntry") as RosterThis["homeRosterEntry"];

/** A `this` that satisfies both private methods: the entry builder is bound in. */
function rosterThis(tabManager: RosterThis["tabManager"], restoringTabs: RosterThis["restoringTabs"]): RosterThis {
	const self = { tabManager, restoringTabs } as RosterThis;
	self.homeRosterEntry = (tab, phase) => homeRosterEntry.call(self, tab, phase);
	return self;
}

function liveTab(id: string, overrides: Partial<LiveTabStub> = {}): LiveTabStub {
	return { id, status: "idle", unread: false, loading: false, ...overrides };
}

describe("Home roster during a startup restore", () => {
	test("lists an unbuilt persisted tab as a placeholder, in persisted order", () => {
		const restore = rosterThis({ list: () => [liveTab("s2")] }, [
			{ id: "s1", title: "Agent-01", phase: "session" },
			{ id: "s2", title: "Agent-02" },
			{ id: "s3", title: "Agent-03" },
		]);
		const roster = homeRoster.call(restore);
		expect(roster.map((row) => row.id)).toEqual(["s1", "s2", "s3"]);
		// The in-flight tab is a placeholder carrying its phase; the built one is live.
		expect(roster[0]).toMatchObject({ id: "s1", status: "loading", loadingPhase: "session" });
		expect(roster[0]!.tab).toBeUndefined();
		expect(roster[1]!.tab).toEqual(liveTab("s2"));
		expect(roster[2]!.tab).toBeUndefined();
	});

	test("a live loading tab keeps its phase, a ready tab does not", () => {
		const restore = rosterThis(
			{ list: () => [liveTab("s1", { loading: true, loadingPhase: "resources" }), liveTab("s2")] },
			[
				{ id: "s1", title: "Agent-01" },
				{ id: "s2", title: "Agent-02" },
			],
		);
		const roster = homeRoster.call(restore);
		expect(roster[0]).toMatchObject({ status: "loading", loadingPhase: "resources" });
		expect(roster[1]).toMatchObject({ status: "idle", loadingPhase: undefined });
	});

	test("outside a restore, the roster is the tab-manager order", () => {
		const idle = rosterThis({ list: () => [liveTab("a"), liveTab("b")] }, []);
		expect(homeRoster.call(idle).map((row) => row.id)).toEqual(["a", "b"]);
	});
});
