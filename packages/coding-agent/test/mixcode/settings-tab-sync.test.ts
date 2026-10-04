import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentTab } from "../../src/core/mixcode/multi-tab/tab-manager.ts";
import { reloadSettingsAcrossTabs } from "../../src/core/mixcode/settings-tab-sync.ts";
import { SettingsManager } from "../../src/core/settings-manager.ts";

/**
 * Two `SettingsManager` instances sharing one settings file stand in for two tabs of
 * one workdir: a write through one has to be re-read by the other.
 */

const tempDirs: string[] = [];

afterEach(() => {
	for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tempDir(): string {
	const dir = mkdtempSync(join(tmpdir(), "mixcode-settings-tab-sync-"));
	tempDirs.push(dir);
	return dir;
}

/** A tab with the session fields the sync touches, plus a spy for the warming reconcile. */
function tab(settingsManager: SettingsManager): {
	tab: AgentTab;
	agent: { transport: string; steeringMode: string; followUpMode: string };
	syncCacheWarmingMode: ReturnType<typeof vi.fn>;
} {
	const agent = { transport: "auto", steeringMode: "one-at-a-time", followUpMode: "one-at-a-time" };
	const syncCacheWarmingMode = vi.fn();
	const session = { settingsManager, agent, syncCacheWarmingMode };
	return { tab: { runtime: { session } } as unknown as AgentTab, agent, syncCacheWarmingMode };
}

describe("re-reading a settings change across every open tab", () => {
	it("reads a write that is still queued on the toggling tab", async () => {
		const agentDir = join(tempDir(), "agent");
		const cwd = tempDir();
		const active = SettingsManager.create(cwd, agentDir, { projectTrusted: true });
		const background = SettingsManager.create(cwd, agentDir, { projectTrusted: true });
		expect(background.getHideThinkingBlock()).toBe(false);

		active.setHideThinkingBlock(true);
		// No await between the queued write and the sync: the sync has to flush the
		// toggling tab first, or the reload would read the file before that write lands.
		await reloadSettingsAcrossTabs(active, [tab(active).tab, tab(background).tab]);

		expect(background.getHideThinkingBlock()).toBe(true);
		const persisted = JSON.parse(readFileSync(join(agentDir, "settings.json"), "utf8"));
		expect(persisted.hideThinkingBlock).toBe(true);
	});

	it("re-applies the values a session copies out of its manager", async () => {
		const agentDir = join(tempDir(), "agent");
		const cwd = tempDir();
		const active = SettingsManager.create(cwd, agentDir, { projectTrusted: true });
		const background = tab(SettingsManager.create(cwd, agentDir, { projectTrusted: true }));

		active.setTransport("websocket");
		active.setSteeringMode("all");
		active.setFollowUpMode("all");
		active.setCacheWarmingMode("off");
		await reloadSettingsAcrossTabs(active, [background.tab]);

		expect(background.agent.transport).toBe("websocket");
		expect(background.agent.steeringMode).toBe("all");
		expect(background.agent.followUpMode).toBe("all");
		expect(background.syncCacheWarmingMode).toHaveBeenCalledTimes(1);
	});

	it("keeps a tab whose project settings pin the value", async () => {
		const agentDir = join(tempDir(), "agent");
		const overriddenCwd = tempDir();
		mkdirSync(join(overriddenCwd, ".pi"), { recursive: true });
		writeFileSync(join(overriddenCwd, ".pi", "settings.json"), JSON.stringify({ hideThinkingBlock: false }));
		const active = SettingsManager.create(tempDir(), agentDir, { projectTrusted: true });
		const background = SettingsManager.create(overriddenCwd, agentDir, { projectTrusted: true });
		active.setHideThinkingBlock(true);

		await reloadSettingsAcrossTabs(active, [tab(active).tab, tab(background).tab]);

		expect(active.getHideThinkingBlock()).toBe(true);
		expect(background.getHideThinkingBlock()).toBe(false);
	});
});
