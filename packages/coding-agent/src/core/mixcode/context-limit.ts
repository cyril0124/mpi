/**
 * `/context-limit`: run a tab with a context window other than the model's own.
 *
 * A limit is a per-tab, session-ephemeral override with three effects: the tab
 * reports the new window, the live session model carries it so `getContextUsage`
 * and extensions reading `ctx.model` agree, and the Pi-native compaction budgets
 * shrink to fit under it. Nothing is written to `models.json`.
 *
 * The session model is replaced by a window copy rather than mutated: the
 * catalog's model objects are shared by every session that selects them, so an
 * in-place write would leak this tab's limit into the others. The copy's
 * identity is what proves the override is still live, so any other writer that
 * swaps the session model (a reload, an extension calling `setModel`) turns the
 * override off instead of leaving a stale flag or a stale model behind.
 */
import type { Model } from "@earendil-works/pi-ai";
import type { AgentSession } from "../agent-session.ts";
import type { SettingsManager } from "../settings-manager.ts";
import type { AgentTab } from "./multi-tab/tab-manager.ts";
import type { ToastRequest } from "./toast/toast.ts";

/** A parsed `/context-limit` argument: a token count, or the reset sentinel. */
export type ContextLimitValue = number | "reset";

/** A live context window override, as recorded on the tab that set it. */
export interface ContextLimitOverride {
	/** The {@link base} model with `contextWindow` replaced by {@link window}. */
	readonly model: Model<any>;
	/** Effective context window, in tokens. */
	readonly window: number;
	/** The catalog model the copy was built from, restored on reset. */
	readonly base: Model<any>;
}

/**
 * Parse a user-provided context limit value string.
 * Accepts formats: "32000", "32k", "32K", "32.5k", "reset".
 * Returns the parsed token count, or "reset" for the reset command.
 * Returns undefined if the input is invalid.
 */
export function parseContextLimitValue(input: string): ContextLimitValue | undefined {
	const trimmed = input.trim().toLowerCase();
	if (!trimmed) return undefined;
	if (trimmed === "reset") return "reset";

	// Match number with optional 'k' suffix
	const match = trimmed.match(/^(\d+(?:\.\d+)?)\s*k?$/);
	if (!match) return undefined;

	const numStr = match[1]!;
	const hasK = trimmed.endsWith("k");
	const value = parseFloat(numStr);

	if (!Number.isFinite(value) || value <= 0) return undefined;

	const tokens = hasK ? Math.round(value * 1000) : Math.round(value);
	if (tokens <= 0) return undefined;

	return tokens;
}

/**
 * One row of the `/context-limit` picker. `id` is the row's value: the token
 * count as a string, or the `reset` / `custom` sentinel.
 */
export interface ContextLimitPickerItem {
	id: string;
	label: string;
	description: string;
}

/**
 * Generate dynamic picker items based on the model's context window.
 * Returns ¼, ½, ¾, Full (reset), and Custom options.
 */
export function contextLimitPickerItems(modelContextWindow: number): ContextLimitPickerItem[] {
	const quarter = Math.round(modelContextWindow / 4);
	const half = Math.round(modelContextWindow / 2);
	const threeQuarter = Math.round((modelContextWindow * 3) / 4);

	return [
		{
			id: String(quarter),
			label: formatCompactTokens(quarter),
			description: "¼ of model capacity",
		},
		{
			id: String(half),
			label: formatCompactTokens(half),
			description: "½ of model capacity",
		},
		{
			id: String(threeQuarter),
			label: formatCompactTokens(threeQuarter),
			description: "¾ of model capacity",
		},
		{
			id: "reset",
			label: formatCompactTokens(modelContextWindow),
			description: "Full (reset to default)",
		},
		{
			id: "custom",
			label: "Custom",
			description: "Enter a custom value...",
		},
	];
}

/**
 * Format a token count in compact form (e.g. "32k", "131k", "32.5k").
 */
export function formatCompactTokens(tokens: number): string {
	const value = tokens / 1_000;
	if (Number.isInteger(value)) return `${value.toFixed(0)}k`;
	return `${value.toFixed(1)}k`;
}

/** The model's own capacity, which the picker's fractions are taken from. */
export function baseContextWindow(tab: AgentTab, session: AgentSession): number {
	return liveOverride(tab, session)?.base.contextWindow ?? session.model?.contextWindow ?? 0;
}

/** True while `/context-limit` is still in force on this tab. */
export function isContextLimitActive(tab: AgentTab, session: AgentSession): boolean {
	return liveOverride(tab, session) !== undefined;
}

/**
 * The recorded override, or undefined when it is gone. A recorded override whose
 * copy is no longer the session's model has been replaced elsewhere, so the
 * session runs the model's own window again and the record is inert.
 */
function liveOverride(tab: AgentTab, session: AgentSession): ContextLimitOverride | undefined {
	const override = tab.contextLimit;
	return override && session.model === override.model ? override : undefined;
}

/**
 * Apply a context limit to a tab and its live session.
 *
 * `reset` puts the session back on the model the copy was built from. When the
 * override has already gone stale, reset only drops the record: the model the
 * session runs now is not ours to replace.
 */
export function applyContextLimitToSession(
	tab: AgentTab,
	value: ContextLimitValue,
	session: AgentSession,
): ToastRequest {
	const current = liveOverride(tab, session);
	const base = current?.base ?? session.model;
	if (!base) throw new Error("Session has no model; cannot set a context limit");
	const modelWindow = base.contextWindow;

	if (value === "reset") {
		session.state.model = base;
		tab.contextLimit = undefined;
		releaseCompactionBudget(session.settingsManager);
		return { type: "success", message: `Context limit reset to ${formatCompactTokens(modelWindow)}` };
	}

	const model = { ...base, contextWindow: value };
	session.state.model = model;
	tab.contextLimit = { model, window: value, base };
	applyCompactionBudgetForLimit(session.settingsManager, value);

	if (value > modelWindow) {
		return {
			type: "warning",
			message: `Context limit set to ${formatCompactTokens(value)} (exceeds model capacity of ${formatCompactTokens(modelWindow)})`,
		};
	}
	return { type: "success", message: `Context limit set to ${formatCompactTokens(value)}` };
}

/**
 * Drop a tab's override after its model changed, restoring the compaction
 * budgets the override had narrowed. The session already runs the new model, so
 * only the recorded override state is cleared, never the model object.
 */
export function clearContextLimitOverride(tab: AgentTab, session: AgentSession): void {
	if (!tab.contextLimit) return;
	tab.contextLimit = undefined;
	releaseCompactionBudget(session.settingsManager);
}

/**
 * Re-establish the override before a turn: the session model may have been
 * swapped by a reload or by an extension, and the compaction shrink may have been
 * recomposed away by another settings writer. Called on `agent_start`, where the
 * budgets are about to matter again.
 */
export function reconcileContextLimit(tab: AgentTab, session: AgentSession): void {
	const override = tab.contextLimit;
	if (!override) return;
	if (session.model !== override.model) {
		clearContextLimitOverride(tab, session);
		return;
	}
	applyCompactionBudgetForLimit(session.settingsManager, override.window);
}

type CompactionSettingsManager = Pick<
	SettingsManager,
	"getGlobalSettings" | "getProjectSettings" | "applyOverrides" | "clearOverrides"
>;

/** Ceiling on the reserve, so a large window cannot reserve an outsized slice of it. */
const MAX_RESERVE_TOKENS = 16_384;
/** Share of the limit reserved for the summary prompt and its response. */
const RESERVE_SHARE = 0.1;
/** Share of the limit compaction keeps verbatim for the next turn. */
const KEEP_RECENT_SHARE = 0.25;

/**
 * Shrink the compaction budgets to match the context limit override.
 *
 * keepRecentTokens controls the cut point; reserveTokens controls when the SDK
 * decides compaction is needed, so both must fit under tiny custom limits. The
 * per-model entries shrink too, because those take precedence over the ordinary
 * budget. Idempotent: it is re-applied on every turn, since another writer may
 * have recomposed the effective settings in between.
 */
function applyCompactionBudgetForLimit(manager: CompactionSettingsManager, contextLimit: number): void {
	const reserveTokens = Math.max(1, Math.min(MAX_RESERVE_TOKENS, Math.round(contextLimit * RESERVE_SHARE)));
	const keepRecentTokens = Math.max(1, Math.round(contextLimit * KEEP_RECENT_SHARE));
	const budget = { reserveTokens, keepRecentTokens };
	// The scope getters keep reporting the user's own overrides: the layer written
	// below is merged into the effective settings, never back into the scopes.
	const scopedModelKeys = [
		...Object.keys(manager.getGlobalSettings().compaction?.modelOverrides ?? {}),
		...Object.keys(manager.getProjectSettings().compaction?.modelOverrides ?? {}),
	];
	const modelOverrides = Object.fromEntries([...new Set(scopedModelKeys)].map((key) => [key, { ...budget }]));
	// A per-model budget takes precedence over the ordinary one, so it shrinks too.
	manager.applyOverrides({
		compaction: { ...budget, ...(scopedModelKeys.length ? { modelOverrides } : {}) },
	});
}

/** Hand the compaction budgets back to the user's settings. */
function releaseCompactionBudget(manager: CompactionSettingsManager): void {
	manager.clearOverrides(["compaction"]);
}
