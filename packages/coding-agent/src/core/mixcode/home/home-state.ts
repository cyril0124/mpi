/**
 * MixCode Home surface state: the Home pseudo-tab's selection in the Agent View
 * roster, its non-idle filter, and the tab cycle that includes Home.
 *
 * Home is not a real agent tab: it has no session and no runtime. The roster
 * lists the open agent tabs in tab-manager order, and the selection is an index
 * into that list.
 */

import type { TabStatus } from "../multi-tab/types.ts";

/** Sentinel id of the Home surface in the tab cycle; never a session id. */
export const HOME_TAB_ID = "home";

/** Minimal tab shape the roster logic needs. */
export interface HomeRosterTab {
	id: string;
	status: TabStatus;
	unread: boolean;
}

/** Mutable Home surface state, owned by the interactive mode. */
export interface HomeSelectionState {
	/** True while Home is the rendered surface. */
	active: boolean;
	/** Index into the agent tab list; see {@link clampHomeSelectedTabIndex}. */
	selectedIndex: number;
	/** When true the roster hides idle tabs. */
	nonIdleOnly: boolean;
}

/** Initial Home selection: inactive, on the first tab, filter off. */
export function createHomeSelection(): HomeSelectionState {
	return { active: false, selectedIndex: 0, nonIdleOnly: false };
}

/**
 * A tab the roster keeps visible under the non-idle filter: working, failed,
 * finished, or holding output the user has not viewed.
 */
export function isTabNonIdle(tab: HomeRosterTab): boolean {
	return tab.status !== "idle" || tab.unread;
}

/** Roster indices to render: every tab, or only non-idle ones with the filter on. */
export function visibleRosterIndices(nonIdleOnly: boolean, tabs: readonly HomeRosterTab[]): number[] {
	if (!nonIdleOnly) return tabs.map((_, index) => index);
	return tabs.flatMap((tab, index) => (isTabNonIdle(tab) ? [index] : []));
}

/**
 * Clamp the selection to a valid index after a tab mutation. With the filter on
 * a hidden selection snaps forward to the next visible tab, or back to the last
 * one when none follows.
 */
export function clampHomeSelectedTabIndex(state: HomeSelectionState, tabs: readonly HomeRosterTab[]): void {
	if (tabs.length === 0) {
		state.selectedIndex = 0;
		return;
	}
	state.selectedIndex = Math.max(0, Math.min(state.selectedIndex, tabs.length - 1));
	const visible = visibleRosterIndices(state.nonIdleOnly, tabs);
	if (visible.length === 0 || visible.includes(state.selectedIndex)) return;
	state.selectedIndex = visible.find((index) => index >= state.selectedIndex) ?? visible[visible.length - 1]!;
}

/** Move the selection by `delta` within the visible roster, wrapping around. */
export function moveHomeSelection(state: HomeSelectionState, tabs: readonly HomeRosterTab[], delta: number): void {
	const visible = visibleRosterIndices(state.nonIdleOnly, tabs);
	if (visible.length === 0) return;
	const position = Math.max(0, visible.indexOf(state.selectedIndex));
	// `%` keeps the dividend's sign, so a delta larger than the list would index backwards.
	const step = ((delta % visible.length) + visible.length) % visible.length;
	state.selectedIndex = visible[(position + step) % visible.length]!;
}

/** Flip the non-idle filter and re-clamp the selection to a tab it still shows. */
export function toggleHomeNonIdleOnly(state: HomeSelectionState, tabs: readonly HomeRosterTab[]): void {
	state.nonIdleOnly = !state.nonIdleOnly;
	clampHomeSelectedTabIndex(state, tabs);
}

/** The tab the roster highlights, or undefined with no tabs. */
export function homeSelectedTab<T extends HomeRosterTab>(state: HomeSelectionState, tabs: readonly T[]): T | undefined {
	return tabs[state.selectedIndex];
}

/**
 * Keep the selection on the same agent after a tab was removed. Closing a tab
 * before the selection shifts it down; closing the selected tab itself leaves
 * the index for {@link clampHomeSelectedTabIndex} to fix.
 */
export function adjustHomeSelectionAfterClose(
	state: HomeSelectionState,
	tabs: readonly HomeRosterTab[],
	removedIndex: number,
): void {
	if (removedIndex < state.selectedIndex) state.selectedIndex -= 1;
	clampHomeSelectedTabIndex(state, tabs);
}

/**
 * Point the selection at `tabId` (or keep it when the id is gone) and clamp it,
 * for callers that must follow the same agent across a reorder or a rebuild.
 */
export function selectHomeTabById(
	state: HomeSelectionState,
	tabs: readonly HomeRosterTab[],
	tabId: string | undefined,
): void {
	const index = tabId === undefined ? -1 : tabs.findIndex((tab) => tab.id === tabId);
	if (index >= 0) state.selectedIndex = index;
	clampHomeSelectedTabIndex(state, tabs);
}

/** Ids in tab-cycle order: Home first, then the agent tabs. */
export function homeTabCycleIds(tabs: readonly HomeRosterTab[]): string[] {
	return [HOME_TAB_ID, ...tabs.map((tab) => tab.id)];
}

/** Tab id `delta` positions away in the cycle order, wrapping in both directions. */
export function nextTabId(activeId: string, tabs: readonly HomeRosterTab[], delta: number): string {
	const ids = homeTabCycleIds(tabs);
	const current = Math.max(0, ids.indexOf(activeId));
	const step = ((delta % ids.length) + ids.length) % ids.length;
	return ids[(current + step) % ids.length]!;
}

/**
 * Point the roster at the focused agent when Home becomes active, so Home
 * highlights the agent the user just left. No-op when the focus is elsewhere or
 * the id is unknown.
 */
export function syncHomeSelectionToTab(
	state: HomeSelectionState,
	tabs: readonly HomeRosterTab[],
	activeId: string,
): void {
	if (activeId === HOME_TAB_ID) return;
	const index = tabs.findIndex((tab) => tab.id === activeId);
	if (index >= 0) state.selectedIndex = index;
}
