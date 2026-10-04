/**
 * Keep a `/settings` change in step across every open tab.
 *
 * Each tab owns a `SettingsManager` loaded once when the tab is built, so a value
 * persisted through the tab that toggled it reaches that tab alone. The rows are
 * global, so the whole roster has to follow one edit.
 */
import type { AgentSession } from "../agent-session.ts";
import type { SettingsManager } from "../settings-manager.ts";
import type { AgentTab } from "./multi-tab/tab-manager.ts";

/**
 * Re-read the settings file in every open tab and re-apply the values a session
 * copies out of its own manager, so a change made in one tab reaches the rest.
 *
 * The write is queued on the toggling tab, so its queue is flushed first: every
 * reload below then reads the value that was just persisted instead of racing it.
 * A reload keeps the override layer (context limits, cache-miss notices), so an
 * override stays in effect across it.
 */
export async function reloadSettingsAcrossTabs(
	togglingSettings: SettingsManager,
	tabs: readonly AgentTab[],
): Promise<void> {
	await togglingSettings.flush();
	for (const tab of tabs) {
		const session = tab.runtime.session;
		await session.settingsManager.reload();
		applySessionCopiedSettings(session);
	}
}

/**
 * Re-apply the values an `AgentSession` copies out of its settings manager instead
 * of reading live: a reload moves the manager, not the copy. Every field here is a
 * global setting, so one value belongs to the whole roster. Assigning the agent
 * fields does not persist, and the warming reconcile reacts to the value the reload
 * already changed.
 */
export function applySessionCopiedSettings(session: AgentSession): void {
	const settings = session.settingsManager;
	session.agent.transport = settings.getTransport();
	session.agent.steeringMode = settings.getSteeringMode();
	session.agent.followUpMode = settings.getFollowUpMode();
	session.syncCacheWarmingMode();
}
