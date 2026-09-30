import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readOpenTabs, readTabMeta, readWorkspaces } from "../../src/core/mixcode/multi-tab/mixcode-state.ts";
import {
	deleteWorkspaceCommand,
	restoreWorkspaceCommand,
	saveWorkspaceCommand,
} from "../../src/modes/interactive/mixcode/multi-tab/tab-workspace.ts";
import { createHarness, type Harness } from "../suite/harness.ts";
import { createTabClient } from "./helpers/tab-runtime.ts";

let root: string;
let workdir: string;
let sessionDir: string;
let harness: Harness;
const clients: Awaited<ReturnType<typeof createTabClient>>[] = [];

beforeEach(async () => {
	root = mkdtempSync(join(tmpdir(), "pi-workspace-flow-"));
	workdir = join(root, "project");
	sessionDir = join(root, "sessions");
	mkdirSync(workdir);
	vi.stubEnv("PI_CODING_AGENT_DIR", join(root, "agent"));
	harness = await createHarness();
});

afterEach(async () => {
	for (const client of clients.splice(0)) {
		client.shared.dispose();
		await client.manager.dispose();
	}
	harness?.cleanup();
	vi.unstubAllEnvs();
	rmSync(root, { recursive: true, force: true });
});

async function client(start = true) {
	const result = await createTabClient({ harness, workdir, sessionDir, agentDir: join(root, "agent"), start });
	clients.push(result);
	return result;
}

/**
 * The fields a named workspace records, per docs/tabs.md: the saved layout store
 * holds session ids and titles; colors live only in the live shared metadata.
 */
function layout(a: Awaited<ReturnType<typeof client>>) {
	return a.manager.list().map((tab) => ({ id: tab.runtime.session.sessionManager.getSessionId(), title: tab.title }));
}

describe("named workspace command integration", () => {
	it("restores saved order, titles and active session, then startup recovers the same layout", async () => {
		const a = await client();
		a.manager.rename(a.manager.getActive().id, "Alpha");
		const beta = await a.manager.createTab();
		a.manager.rename(beta.id, "Beta");
		a.manager.setColor(beta.id, "blue");
		const gamma = await a.manager.createTab();
		a.manager.rename(gamma.id, "Gamma");
		a.manager.activate(beta.id);
		const expected = layout(a);
		const activeId = beta.runtime.session.sessionManager.getSessionId();
		const oldUiIds = a.manager.list().map((tab) => tab.id);
		saveWorkspaceCommand(a.host, "review");
		const persisted = readWorkspaces(workdir)[0]!;
		expect(persisted.active_session_id).toBe(activeId);
		expect(persisted.tabs.map((tab) => tab.title)).toEqual(["Alpha", "Beta", "Gamma"]);
		const scratch = await a.manager.createTab();
		a.manager.rename(scratch.id, "Scratch");
		const scratchPath = scratch.runtime.session.sessionFile!;
		a.manager.rename(beta.id, "Temporary Beta");
		await restoreWorkspaceCommand(a.host, "review");
		expect(layout(a)).toEqual(expected);
		expect(a.manager.getActive().runtime.session.sessionManager.getSessionId()).toBe(activeId);
		expect(a.displayedTabId).toBe(a.manager.getActive().id);
		expect(a.closedUi).toEqual(expect.arrayContaining([...oldUiIds, scratch.id]));
		expect(existsSync(scratchPath)).toBe(true);
		const snapshot = readOpenTabs(workdir);
		expect(snapshot.kind === "ok" && snapshot.snapshot.activeSessionId).toBe(activeId);
		expect(readTabMeta(workdir).get(activeId)?.title).toBe("Beta");
		expect(a.errors).toEqual([]);
		deleteWorkspaceCommand(a.host, "review");
		expect(readWorkspaces(workdir)).toEqual([]);
	});

	it("does not report success or change membership if a tab starts streaming while confirmation is open", async () => {
		const a = await client();
		const extra = await a.manager.createTab();
		a.manager.rename(extra.id, "Saved");
		saveWorkspaceCommand(a.host, "busy");
		const before = layout(a);
		let busy: ReturnType<typeof vi.spyOn> | undefined;
		const host = {
			...a.host,
			showExtensionConfirm: async () => {
				busy = vi.spyOn(extra.runtime.session, "isStreaming", "get").mockReturnValue(true);
				return true;
			},
		};
		try {
			await restoreWorkspaceCommand(host, "busy");
			expect(layout(a)).toEqual(before);
			expect(a.errors).toHaveLength(1);
			expect(a.status.some((message) => message.startsWith("Restored workspace"))).toBe(false);
		} finally {
			busy?.mockRestore();
		}
	});
});
