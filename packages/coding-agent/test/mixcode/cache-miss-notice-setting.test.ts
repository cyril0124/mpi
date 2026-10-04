import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { applyCacheMissNoticeSetting } from "../../src/core/mixcode/cache-miss-notice-setting.ts";
import type { AgentTab } from "../../src/core/mixcode/multi-tab/tab-manager.ts";
import { SettingsManager } from "../../src/core/settings-manager.ts";

/**
 * Cache-miss notices are a global `/settings` row, but every tab owns a
 * `SettingsManager` with its own merged settings, so the row has to reach the whole
 * roster instead of the tab it was toggled in.
 */

const tempDirs: string[] = [];

afterEach(() => {
	for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tempDir(): string {
	const dir = mkdtempSync(join(tmpdir(), "mixcode-cache-notice-"));
	tempDirs.push(dir);
	return dir;
}

/** A tab is read for its session's settings manager and nothing else here. */
function tab(settingsManager: SettingsManager): AgentTab {
	return { runtime: { session: { settingsManager } } } as unknown as AgentTab;
}

describe("applying the cache-miss notice setting to every open tab", () => {
	it("turns the setting on for a tab that never saw the toggle", async () => {
		const agentDir = join(tempDir(), "agent");
		const cwd = tempDir();
		const active = SettingsManager.create(cwd, agentDir, { projectTrusted: true });
		const other = SettingsManager.create(cwd, agentDir, { projectTrusted: true });
		expect(other.getShowCacheMissNotices()).toBe(false);

		applyCacheMissNoticeSetting(active, [tab(active), tab(other)], true);
		await active.flush();

		expect(active.getShowCacheMissNotices()).toBe(true);
		expect(other.getShowCacheMissNotices()).toBe(true);
		const persisted = JSON.parse(readFileSync(join(agentDir, "settings.json"), "utf8"));
		expect(persisted.showCacheMissNotices).toBe(true);
	});

	it("turns the setting back on after another tab turned it off", () => {
		const agentDir = join(tempDir(), "agent");
		const cwd = tempDir();
		const toggling = SettingsManager.create(cwd, agentDir, { projectTrusted: true });
		const background = SettingsManager.create(cwd, agentDir, { projectTrusted: true });

		applyCacheMissNoticeSetting(toggling, [tab(toggling), tab(background)], true);
		// `background` carries an override from then on, and toggles next: the value
		// that override holds must not survive the new one.
		applyCacheMissNoticeSetting(toggling, [tab(toggling), tab(background)], false);
		applyCacheMissNoticeSetting(background, [tab(toggling), tab(background)], true);

		expect(background.getShowCacheMissNotices()).toBe(true);
		expect(toggling.getShowCacheMissNotices()).toBe(true);
	});

	it("leaves a tab that overrides the setting in its project settings on that value", () => {
		const agentDir = join(tempDir(), "agent");
		const overriddenCwd = tempDir();
		mkdirSync(join(overriddenCwd, ".pi"), { recursive: true });
		writeFileSync(join(overriddenCwd, ".pi", "settings.json"), JSON.stringify({ showCacheMissNotices: false }));
		const active = SettingsManager.create(tempDir(), agentDir, { projectTrusted: true });
		const other = SettingsManager.create(overriddenCwd, agentDir, { projectTrusted: true });
		expect(other.getProjectSettings().showCacheMissNotices).toBe(false);

		applyCacheMissNoticeSetting(active, [tab(active), tab(other)], true);

		expect(active.getShowCacheMissNotices()).toBe(true);
		expect(other.getShowCacheMissNotices()).toBe(false);
	});
});
