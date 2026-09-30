/**
 * Keep this instance's agent tabs aligned with the shared open-tab set.
 *
 * Every live instance polls `open_tabs.json` and opens, closes, and reorders its
 * own tabs to match it. Polling is deliberate: a directory watch misses events on
 * network filesystems and consumes a scarce per-user inotify slot.
 *
 * The shared list is re-read after every await, so a tab a peer adds or removes
 * while another tab is still opening is seen in the same pass, not the next poll.
 */
import { readOpenTabs } from "./mixcode-state.ts";

export interface PeerTabCandidate {
	sessionId: string;
	workdir: string;
}

interface TabReconcilePlan {
	toOpen: PeerTabCandidate[];
	toClose: string[];
	desiredOrder: string[];
}

/** Pure diff between the local tab set and the desired set. No I/O. */
function listTabsToReconcile(options: {
	localSessionIds: Iterable<string>;
	desiredSessionIds: Iterable<string>;
	localWorkdir: string;
}): TabReconcilePlan {
	const local = new Set(options.localSessionIds);
	const desiredOrder = [...new Set([...options.desiredSessionIds].map(String).filter((id) => id.trim()))];
	const desired = new Set(desiredOrder);

	const toOpen: PeerTabCandidate[] = [];
	for (const sessionId of desired) {
		if (!local.has(sessionId)) toOpen.push({ sessionId, workdir: options.localWorkdir });
	}

	const toClose: string[] = [];
	for (const sessionId of local) {
		if (!desired.has(sessionId)) toClose.push(sessionId);
	}

	return { toOpen, toClose, desiredOrder };
}

export interface StartPeerTabSyncOptions {
	workdir: string;
	/** Session ids currently open in this process. */
	getLocalSessionIds: () => Iterable<string>;
	/** Open the session with this id. Throwing leaves it to a later poll. */
	openTab: (candidate: PeerTabCandidate) => Promise<void>;
	/** Close the open tab with this session id. Throwing leaves it to a later poll. */
	closeTab: (sessionId: string) => Promise<void>;
	/** Adopt the shared order after the opens and closes. */
	reorderTabs?: (orderedSessionIds: string[]) => void | Promise<void>;
	/** Report a failed open, close, or read; the next poll retries. */
	onError?: (error: unknown) => void;
	/** Serialize a whole pass with the host's own tab operations. */
	execute?: (operation: () => Promise<void>) => Promise<void>;
	/** Polling cadence in milliseconds. Default: 2000. */
	pollIntervalMs?: number;
}

export interface PeerTabSync {
	dispose(): void;
	reconcileNow(): Promise<void>;
}

const DEFAULT_POLL_INTERVAL_MS = 2_000;

/**
 * Poll `open_tabs.json` and bring the local tabs in line with it. The first pass
 * runs one interval after start; `reconcileNow()` aligns immediately instead.
 *
 * Each id is attempted at most once per pass, so a failure cannot spin inside a
 * pass; it is retried on the next poll.
 */
export function startPeerTabSync(options: StartPeerTabSyncOptions): PeerTabSync {
	const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
	let disposed = false;
	let pollTimer: ReturnType<typeof setInterval> | undefined;
	let reconcileInFlight: Promise<void> | undefined;
	let reconcileAgain = false;

	const reconcile = async (): Promise<void> => {
		if (disposed) return;
		if (reconcileInFlight) {
			reconcileAgain = true;
			return reconcileInFlight;
		}
		reconcileInFlight = (async () => {
			do {
				reconcileAgain = false;
				try {
					if (options.execute) await options.execute(runOnce);
					else await runOnce();
				} catch (error) {
					options.onError?.(error);
				}
			} while (reconcileAgain && !disposed);
		})().finally(() => {
			reconcileInFlight = undefined;
		});
		return reconcileInFlight;
	};

	const runOnce = async (): Promise<void> => {
		const initial = readOpenTabs(options.workdir);
		// No file yet: bootstrap may still be seeding, so local tabs stay.
		if (initial.kind === "missing") return;
		if (initial.kind === "invalid") {
			options.onError?.(new Error(initial.error));
			return;
		}

		const attemptedOpens = new Set<string>();
		const attemptedCloses = new Set<string>();
		let lastDesiredOrder = initial.snapshot.sessionIds;

		for (;;) {
			if (disposed) return;

			const current = readOpenTabs(options.workdir);
			if (current.kind === "missing") return;
			if (current.kind === "invalid") {
				options.onError?.(new Error(current.error));
				return;
			}
			lastDesiredOrder = current.snapshot.sessionIds;

			const plan = listTabsToReconcile({
				localSessionIds: options.getLocalSessionIds(),
				desiredSessionIds: lastDesiredOrder,
				localWorkdir: options.workdir,
			});

			const toOpen = plan.toOpen.find((candidate) => !attemptedOpens.has(candidate.sessionId));
			if (toOpen) {
				attemptedOpens.add(toOpen.sessionId);
				try {
					await options.openTab(toOpen);
				} catch (error) {
					options.onError?.(error);
				}
				continue;
			}

			const toClose = plan.toClose.find((id) => !attemptedCloses.has(id));
			if (toClose === undefined) break;
			attemptedCloses.add(toClose);
			try {
				await options.closeTab(toClose);
			} catch (error) {
				options.onError?.(error);
			}
		}

		await options.reorderTabs?.(lastDesiredOrder);
	};

	pollTimer = setInterval(() => void reconcile(), pollIntervalMs);
	// Do not hold the process open on this timer alone.
	(pollTimer as NodeJS.Timeout).unref();

	return {
		dispose() {
			disposed = true;
			if (pollTimer) clearInterval(pollTimer);
			pollTimer = undefined;
		},
		reconcileNow: reconcile,
	};
}
