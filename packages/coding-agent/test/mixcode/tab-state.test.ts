import { describe, expect, it } from "vitest";
import { setTabStatus, type TabTimerState } from "../../src/core/mixcode/multi-tab/tab-state.ts";

const START = new Date("2026-01-01T00:00:00.000Z");

/**
 * The status drives the chip glyph and the work timer at once, so the two must
 * never disagree: a working status carries a start stamp, leaving work records
 * a whole number of seconds and clears it.
 */
describe("tab status timer", () => {
	it("stamps a start time when work begins and measures it when work ends", () => {
		const tab: TabTimerState = { status: "idle" };
		setTabStatus(tab, "running", { now: START });
		expect(tab.workingStartedAt).toBe(START.toISOString());
		expect(tab.lastWorkedDurationSeconds).toBeUndefined();

		setTabStatus(tab, "idle", { now: new Date(START.getTime() + 12_400) });
		expect(tab.workingStartedAt).toBeUndefined();
		expect(tab.lastWorkedDurationSeconds).toBe(12);
	});

	it("keeps the original start across a phase change and restarts only when asked", () => {
		const tab: TabTimerState = { status: "idle" };
		setTabStatus(tab, "running", { now: START });
		setTabStatus(tab, "thinking", { now: new Date(START.getTime() + 5_000) });
		expect(tab.workingStartedAt).toBe(START.toISOString());

		setTabStatus(tab, "running", { now: new Date(START.getTime() + 9_000), restart: true });
		expect(tab.workingStartedAt).toBe(new Date(START.getTime() + 9_000).toISOString());
	});

	it("records no duration when work ends without a start stamp", () => {
		const tab: TabTimerState = { status: "running" };
		setTabStatus(tab, "idle", { now: START });
		expect(tab.lastWorkedDurationSeconds).toBeUndefined();
		expect(tab.workingStartedAt).toBeUndefined();
	});

	it("keeps the status and timer consistent across every transition", () => {
		const targets = ["idle", "running", "thinking", "error", "done"] as const;
		const start = START.getTime();
		for (const target of targets) {
			const tab: TabTimerState = { status: "idle" };
			setTabStatus(tab, "running", { now: new Date(start) });
			setTabStatus(tab, target, { now: new Date(start + 3_000) });

			const working = target === "running" || target === "thinking";
			expect(tab.status).toBe(target);
			expect(tab.workingStartedAt !== undefined).toBe(working);
			if (working) {
				expect(tab.lastWorkedDurationSeconds).toBeUndefined();
			} else {
				expect(tab.lastWorkedDurationSeconds).toBe(3);
				expect(tab.workingStartedAt).toBeUndefined();
			}
		}
	});
});
