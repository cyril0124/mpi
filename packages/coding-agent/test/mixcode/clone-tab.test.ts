import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fauxAssistantMessage } from "@earendil-works/pi-ai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentTab, TabManager } from "../../src/core/mixcode/multi-tab/tab-manager.ts";
import type { SessionManager } from "../../src/core/session-manager.ts";
import { InteractiveMode } from "../../src/modes/interactive/interactive-mode.ts";
import { createHarness, getMessageText, type Harness } from "../suite/harness.ts";
import { userMsg } from "../utilities.ts";
import { createTabClient } from "./helpers/tab-runtime.ts";

type CloneCommandContext = {
	sessionManager: SessionManager;
	tabManager: TabManager;
	enqueueTabSwitch: (run: () => Promise<void>) => Promise<void>;
	switchActiveTab: (tab: AgentTab) => Promise<void>;
	showStatus: (message: string) => void;
	showError: (message: string) => void;
	ui: { requestRender: () => void };
};

const handleCloneCommand = (
	InteractiveMode.prototype as unknown as {
		handleCloneCommand(this: CloneCommandContext): Promise<void>;
	}
).handleCloneCommand;

let root: string;
let workdir: string;
let sessionDir: string;
let harness: Harness;
const clients: Awaited<ReturnType<typeof createTabClient>>[] = [];

beforeEach(async () => {
	root = mkdtempSync(join(tmpdir(), "pi-clone-tab-"));
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

/** Every message the session holds, in order, so two sessions can be compared by content. */
function messageTexts(manager: SessionManager): string[] {
	return manager.getEntries().flatMap((entry) => (entry.type === "message" ? [getMessageText(entry.message)] : []));
}

/**
 * `/clone` with tabs open duplicates the active branch into a sibling tab titled
 * `<source>-cloned`. The source tab keeps its session file, so both tabs continue
 * from the same conversation independently.
 */
describe("clone into a new tab", () => {
	it("opens the source branch in a tab titled <source>-cloned and leaves the source file alone", async () => {
		const a = await client();
		harness.setResponses([fauxAssistantMessage("first"), fauxAssistantMessage("second")]);
		const sourceSession = a.manager.getActive().runtime.session;
		await sourceSession.prompt("one");
		await sourceSession.prompt("two");
		const sourceManager = sourceSession.sessionManager;
		const sourceFile = sourceManager.getSessionFile()!;
		const sourceBefore = readFileSync(sourceFile, "utf8");
		const sourceTexts = messageTexts(sourceManager);
		// A tab after the source, so the clone's place in the bar is observable.
		const sourceTab = a.manager.getActive();
		await a.manager.createTab();
		a.manager.activate(sourceTab.id);

		await handleCloneCommand.call({
			sessionManager: sourceManager,
			tabManager: a.manager,
			enqueueTabSwitch: a.host.enqueueTabSwitch,
			switchActiveTab: a.host.switchActiveTab,
			showStatus: (message) => a.status.push(message),
			showError: (message) => a.errors.push(message),
			ui: { requestRender: () => {} },
		});

		expect(a.errors).toEqual([]);
		expect(a.status).toEqual(["Cloned to new tab"]);
		expect(a.manager.list().map((tab) => tab.title)).toEqual(["Agent-01", "Agent-01-cloned", "Agent-02"]);

		const clone = a.manager.list()[1]!;
		const cloneManager = clone.runtime.session.sessionManager;
		expect(cloneManager.getSessionFile()).not.toBe(sourceFile);
		expect(existsSync(cloneManager.getSessionFile()!)).toBe(true);
		expect(cloneManager.getSessionName()).toBe("Agent-01-cloned");
		// The clone carries the conversation; the source keeps its file and its entries.
		expect(messageTexts(cloneManager)).toEqual(sourceTexts);
		expect(readFileSync(sourceFile, "utf8")).toBe(sourceBefore);
		expect(messageTexts(sourceManager)).toEqual(sourceTexts);
		// The clone is a child session of the file it was branched from.
		const header = JSON.parse(readFileSync(cloneManager.getSessionFile()!, "utf8").split("\n")[0]!) as {
			parentSession?: string;
		};
		expect(header.parentSession).toBe(sourceFile);
		expect(a.displayedTabId).toBe(clone.id);

		// The clone continues on its own; the source file stays as it was.
		harness.setResponses([fauxAssistantMessage("third")]);
		await clone.runtime.session.prompt("three");
		expect(messageTexts(cloneManager)).toEqual([...sourceTexts, "three", "third"]);
		expect(readFileSync(sourceFile, "utf8")).toBe(sourceBefore);
	});

	it("reports nothing to clone once the session has no leaf", async () => {
		const a = await client();
		const sourceSession = a.manager.getActive().runtime.session;
		sourceSession.sessionManager.appendMessage(userMsg("only message"));
		await sourceSession.resetLeafToRoot();
		expect(sourceSession.sessionManager.getLeafId()).toBeNull();

		await handleCloneCommand.call({
			sessionManager: sourceSession.sessionManager,
			tabManager: a.manager,
			enqueueTabSwitch: a.host.enqueueTabSwitch,
			switchActiveTab: a.host.switchActiveTab,
			showStatus: (message) => a.status.push(message),
			showError: (message) => a.errors.push(message),
			ui: { requestRender: () => {} },
		});

		expect(a.status).toEqual(["Nothing to clone yet"]);
		expect(a.errors).toEqual([]);
		expect(a.manager.list()).toHaveLength(1);
		await expect(a.manager.cloneTab(a.manager.getActive().id)).rejects.toThrow("Nothing to clone yet");
	});
});
