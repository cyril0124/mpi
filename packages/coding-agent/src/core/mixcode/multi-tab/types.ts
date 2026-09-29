/**
 * Multi-tab domain types: one open agent tab per concurrent `AgentSessionRuntime`.
 */

/** Live status of a tab, driving its glyph in the tab bar. */
export type TabStatus = "idle" | "running" | "thinking" | "error" | "done";

/** Named tab colors offered by `/color`. */
export const TAB_COLOR_NAMES = ["red", "green", "yellow", "blue", "magenta", "cyan", "white", "gray"] as const;

export type TabColorName = (typeof TAB_COLOR_NAMES)[number];

/** True while a tab's agent is working: streaming a reply or compacting. */
export function isWorkingStatus(status: TabStatus): boolean {
	return status === "running" || status === "thinking";
}

/** Default title for the agent tab at 1-based position `index`: `Agent-NN`. */
export function defaultAgentTitle(index: number): string {
	return `Agent-${String(index).padStart(2, "0")}`;
}

const TAB_COLOR_SET: ReadonlySet<string> = new Set(TAB_COLOR_NAMES);

/** True for a known tab color name; validates `/color` arguments. */
export function isTabColorName(value: unknown): value is TabColorName {
	return typeof value === "string" && TAB_COLOR_SET.has(value);
}

/** The next free `Agent-NN` title, skipping titles already in use. */
export function nextAvailableAgentTitle(usedTitles: Iterable<string>): string {
	const used = new Set(usedTitles);
	for (let index = 1; ; index += 1) {
		const title = defaultAgentTitle(index);
		if (!used.has(title)) return title;
	}
}

/**
 * Make `base` unique against `usedTitles` by appending `-1`, `-2`, and so on.
 */
export function uniquifyTitle(base: string, usedTitles: Iterable<string>): string {
	const used = new Set(usedTitles);
	if (!used.has(base)) return base;
	for (let suffix = 1; ; suffix += 1) {
		const candidate = `${base}-${suffix}`;
		if (!used.has(candidate)) return candidate;
	}
}
