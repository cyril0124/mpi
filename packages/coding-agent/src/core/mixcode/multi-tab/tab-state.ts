/**
 * Tab status mutation seam.
 *
 * Funnels the status/timer invariant (entering work stamps a start time, leaving
 * work records a duration) into one place so event handlers do not each
 * re-derive it.
 */
import { isWorkingStatus, type TabStatus } from "./types.ts";

export interface TabTimerState {
	status: TabStatus;
	/** ISO stamp of the run in progress, cleared when it stops. */
	workingStartedAt?: string;
	/** Length of the run that just stopped, in seconds. */
	lastWorkedDurationSeconds?: number;
	/** ISO stamp of the last transition out of a working status; drives relative ages. */
	lastWorkedAt?: string;
}

export interface SetTabStatusOptions {
	/** Clock injection point; defaults to now. Tests pass a fixed Date. */
	now?: Date;
	/** Restart the timer even when one is already running. */
	restart?: boolean;
}

/**
 * Set the tab status and maintain the timer invariant: entering a working
 * status stamps `workingStartedAt` (unless one is already running), leaving a
 * working status measures `lastWorkedDurationSeconds` and clears the stamp.
 */
export function setTabStatus(tab: TabTimerState, status: TabStatus, options: SetTabStatusOptions = {}): void {
	const now = options.now ?? new Date();
	tab.status = status;

	if (isWorkingStatus(status)) {
		if (options.restart) tab.workingStartedAt = now.toISOString();
		else tab.workingStartedAt ??= now.toISOString();
		tab.lastWorkedDurationSeconds = undefined;
		return;
	}

	tab.lastWorkedDurationSeconds = elapsedSeconds(tab.workingStartedAt, now);
	tab.workingStartedAt = undefined;
	tab.lastWorkedAt = now.toISOString();
}

/** Seconds between an ISO start stamp and now, floored; undefined if no/invalid stamp. */
function elapsedSeconds(startedAt: string | undefined, now: Date): number | undefined {
	const start = startedAt ? Date.parse(startedAt) : Number.NaN;
	if (!Number.isFinite(start)) return undefined;
	return Math.max(0, Math.floor((now.getTime() - start) / 1000));
}
