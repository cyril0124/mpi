/**
 * Keep the cache-miss notice setting in step across every open tab: each tab is
 * built by its own `createRuntime` and owns a `SettingsManager` whose merged
 * `settings` are read once, at construction, so persisting the setting through the
 * tab that toggled it moves that tab alone. The `/settings` row is global, so the
 * whole roster follows it.
 */
import type { SettingsManager } from "../settings-manager.ts";
import type { AgentTab } from "./multi-tab/tab-manager.ts";

/**
 * Persist the setting through the toggling tab and apply the effective value to
 * every open tab. A tab that names the setting in its project settings keeps that
 * value, since the project layer outranks the global one.
 *
 * Every open tab is written, the toggling one included. The override is what
 * carries the value to a tab that never saw the toggle, so the toggling tab needs
 * one too: an override left from an earlier toggle would otherwise outrank the
 * value just persisted.
 */
export function applyCacheMissNoticeSetting(
	togglingSettings: SettingsManager,
	tabs: readonly AgentTab[],
	shown: boolean,
): void {
	togglingSettings.setShowCacheMissNotices(shown);
	for (const tab of tabs) {
		const tabSettings = tab.runtime.session.settingsManager;
		const projectValue = tabSettings.getProjectSettings().showCacheMissNotices;
		tabSettings.applyOverrides({ showCacheMissNotices: projectValue ?? shown });
	}
}
