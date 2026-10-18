import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { handleNewTab } from "../../src/modes/interactive/mixcode/multi-tab/tab-lifecycle.ts";
import { createHarness, type Harness } from "../suite/harness.ts";
import { createTabClient } from "./helpers/tab-runtime.ts";

let root: string;
let workdir: string;
let sessionDir: string;
let harness: Harness;
const clients: Awaited<ReturnType<typeof createTabClient>>[] = [];

beforeEach(async () => {
	root = mkdtempSync(join(tmpdir(), "pi-tab-lifecycle-"));
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

async function client() {
	const result = await createTabClient({ harness, workdir, sessionDir, agentDir: join(root, "agent") });
	clients.push(result);
	return result;
}

/**
 * `/new-session --no-focus` creates a tab without moving the screen, so the tab in front
 * keeps focus. Restoring that focus is not a focus change for the user: the badge
 * `/mark-done` set has to survive it, or it is gone from the bar and from the layout
 * published on disk.
 */
describe("create a background tab", () => {
	it("keeps the done badge of the tab it restores focus to", async () => {
		const a = await client();
		const marked = a.manager.getActive();
		a.manager.markLoaded(marked.id);
		a.manager.markDone(marked.id);
		expect(marked.status).toBe("done");
		expect(marked.unread).toBe(true);

		const created = await handleNewTab(a.host, "B", false);

		expect(created).toBeDefined();
		expect(a.manager.list()).toHaveLength(2);
		// Focus stays on the tab that was on screen before the creation.
		expect(a.manager.getActive().id).toBe(marked.id);
		// Its badge survives the restored focus.
		expect(marked.status).toBe("done");
		expect(marked.unread).toBe(true);
	});
});
