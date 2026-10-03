/**
 * Startup restore guard: a tab whose extensions park in a dialog must not hold up the
 * tabs behind it.
 */

import type { TabLoadingPhase } from "./types.ts";

/**
 * How often a parked restore is noticed. Parking is one-time startup work and the
 * check is a string compare, so a short poll is enough.
 */
const PARK_POLL_MS = 25;

/** The part of a tab this guard reads. */
interface RestoringTab {
	loadingPhase?: TabLoadingPhase;
}

/** True while a loading tab waits on an extension dialog instead of finishing. */
function isParked(tab: RestoringTab): boolean {
	return tab.loadingPhase === "waiting for input";
}

/**
 * Resolve once `bind` settles, or once the tab parks in an extension dialog.
 *
 * Tabs restore one at a time, so the caller awaits each tab's bind before building the
 * next session. A `session_start` handler may instead open a dialog and wait for the user,
 * which leaves that bind pending for an unbounded time; waiting for it would leave every
 * later tab unbuilt until a human intervenes. `"parked"` means the tab now waits on a human
 * and the caller should move on: the bind keeps running and still settles on its own, so its
 * result is not lost.
 */
export function waitForTabBindOrPark(tab: RestoringTab, bind: Promise<void>): Promise<"settled" | "parked"> {
	if (isParked(tab)) return Promise.resolve("parked");
	return new Promise((resolve) => {
		const timer = setInterval(() => {
			if (!isParked(tab)) return;
			clearInterval(timer);
			resolve("parked");
		}, PARK_POLL_MS);
		// Both outcomes release the poll; the rejection handler keeps a failing bind from
		// becoming an unhandled rejection.
		const settle = (): void => {
			clearInterval(timer);
			resolve("settled");
		};
		void bind.then(settle, settle);
	});
}
