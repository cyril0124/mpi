import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fauxAssistantMessage } from "@earendil-works/pi-ai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProjectTrustContext } from "../../src/core/extensions/index.ts";
import type { MissingSessionCwdError } from "../../src/core/session-cwd.ts";
import type { SessionManager } from "../../src/core/session-manager.ts";
import { InteractiveMode } from "../../src/modes/interactive/interactive-mode.ts";
import { handleResumeIntoTab } from "../../src/modes/interactive/mixcode/multi-tab/tab-lifecycle.ts";
import { createHarness, getMessageText, type Harness } from "../suite/harness.ts";
import { createTabClient } from "./helpers/tab-runtime.ts";

type TabClient = Awaited<ReturnType<typeof createTabClient>>;

/** What `InteractiveMode.handleResumeIntoTab` reads off `this`. */
type ResumeEntryContext = {
	tabManager: TabClient["manager"] | undefined;
	handleResumeSession: (sessionPath: string) => Promise<{ cancelled: boolean }>;
	resumeTabHost: () => Parameters<typeof handleResumeIntoTab>[0];
};

/**
 * `/resume` opens the picked session in a tab of its own: the focused tab keeps
 * its session, and a session that is already open is focused rather than opened
 * twice, because two runtimes on one file would append to it concurrently.
 */
describe("resume into a new tab", () => {
	let root: string;
	let workdir: string;
	let sessionDir: string;
	let agentDir: string;
	let harness: Harness;
	const clients: TabClient[] = [];

	beforeEach(async () => {
		root = mkdtempSync(join(tmpdir(), "pi-resume-tab-"));
		workdir = join(root, "project");
		sessionDir = join(root, "sessions");
		agentDir = join(root, "agent");
		mkdirSync(workdir);
		vi.stubEnv("PI_CODING_AGENT_DIR", agentDir);
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

	async function client(): Promise<TabClient> {
		const created = await createTabClient({ harness, workdir, sessionDir, agentDir });
		clients.push(created);
		return created;
	}

	/** Drop a client but keep its session file on disk, the way a closed tab does. */
	async function closeClient(client: TabClient): Promise<void> {
		clients.splice(clients.indexOf(client), 1);
		client.shared.dispose();
		await client.manager.dispose();
	}

	/** The session-selector host surface: the tab client plus the two extra callbacks. */
	function host(
		client: TabClient,
		options: {
			promptMissingSessionCwd?: (error: MissingSessionCwdError) => Promise<string | undefined>;
			/** Receives every cwd the trust decision is asked for. */
			trustCwds?: string[];
		} = {},
	) {
		return {
			...client.host,
			promptMissingSessionCwd: options.promptMissingSessionCwd ?? (async () => undefined),
			projectTrustContext: (cwd: string): ProjectTrustContext => {
				options.trustCwds?.push(cwd);
				return {
					cwd,
					mode: "tui",
					hasUI: false,
					ui: {
						select: async () => undefined,
						confirm: async () => false,
						input: async () => undefined,
						notify: () => {},
					},
				};
			},
		};
	}

	/** The conversation a session holds, in order, so two tabs can be compared by content. */
	function messageTexts(manager: SessionManager): string[] {
		return manager
			.getEntries()
			.flatMap((entry) =>
				entry.type === "message" && entry.message.role !== "system" ? [getMessageText(entry.message)] : [],
			);
	}

	it("opens the picked session beside the focused tab and keeps that tab's session", async () => {
		const focused = await client();
		harness.setResponses([fauxAssistantMessage("focused reply")]);
		await focused.manager.getActive().runtime.session.prompt("focused question");
		const focusedFile = focused.manager.getActive().runtime.session.sessionFile!;
		const focusedTexts = messageTexts(focused.manager.getActive().runtime.session.sessionManager);

		// A session file on disk that no tab holds, the way a closed tab leaves one.
		const closed = await client();
		harness.setResponses([fauxAssistantMessage("resumed reply")]);
		const closedSession = closed.manager.getActive().runtime.session;
		await closedSession.prompt("question for the closed tab");
		closedSession.setSessionName("resumed-tab");
		const closedFile = closedSession.sessionFile!;
		const closedTexts = messageTexts(closedSession.sessionManager);
		expect(closedTexts).toEqual(["question for the closed tab", "resumed reply"]);
		await closeClient(closed);

		const trustCwds: string[] = [];
		await handleResumeIntoTab(host(focused, { trustCwds }), closedFile);

		expect(focused.errors).toEqual([]);
		expect(focused.status).toEqual(["Resumed session"]);
		expect(focused.manager.list().map((tab) => tab.title)).toEqual(["Agent-01", "resumed-tab"]);
		// The trust decision covers the cwd the session is opened in.
		expect(trustCwds).toEqual([workdir]);

		const resumed = focused.manager.list()[1]!;
		expect(resumed.runtime.session.sessionFile).toBe(closedFile);
		expect(messageTexts(resumed.runtime.session.sessionManager)).toEqual(closedTexts);
		expect(focused.displayedTabId).toBe(resumed.id);

		// The tab that was in front kept its own session file and conversation.
		const kept = focused.manager.list()[0]!;
		expect(kept.runtime.session.sessionFile).toBe(focusedFile);
		expect(messageTexts(kept.runtime.session.sessionManager)).toEqual(focusedTexts);
		expect(focused.manager.getActive().id).toBe(resumed.id);

		// The resumed tab appends to the same file it was opened from; the tab in front
		// keeps writing its own.
		harness.setResponses([fauxAssistantMessage("more")]);
		await resumed.runtime.session.prompt("another question");
		expect(messageTexts(resumed.runtime.session.sessionManager)).toEqual([
			...closedTexts,
			"another question",
			"more",
		]);
		expect(focused.manager.getActive().runtime.session.sessionFile).not.toBe(focusedFile);
	});

	it("focuses the tab that already holds the session instead of opening the file twice", async () => {
		const a = await client();
		harness.setResponses([fauxAssistantMessage("first reply")]);
		const firstTab = a.manager.getActive();
		await firstTab.runtime.session.prompt("first question");
		const firstFile = firstTab.runtime.session.sessionFile!;

		const secondTab = await a.manager.createTab();
		harness.setResponses([fauxAssistantMessage("second reply")]);
		await secondTab.runtime.session.prompt("second question");
		expect(a.manager.getActive().id).toBe(secondTab.id);

		const displayCalls: string[] = [];
		await handleResumeIntoTab(
			{
				...host(a),
				activateTab: async (tab) => {
					displayCalls.push(tab.id);
					await a.switchActiveTab(tab);
				},
			},
			firstFile,
		);

		expect(a.errors).toEqual([]);
		expect(a.status).toEqual([`Session is already open in tab "Agent-01".`]);
		expect(a.manager.list().map((tab) => tab.id)).toEqual([firstTab.id, secondTab.id]);
		// The tab bar is asked for the saved session's own tab, and the manager's focus
		// moves with it, so the commands that follow act on what is on screen.
		expect(displayCalls).toEqual([firstTab.id]);
		expect(a.manager.getActive().id).toBe(firstTab.id);
		// The composer text stays with the tab it was typed in.
		expect(a.manager.get(secondTab.id)!.draftInput).toBe("draft");
		expect(a.manager.list().filter((tab) => tab.runtime.session.sessionFile === firstFile)).toHaveLength(1);
	});

	it("does not rebuild a tab that already holds the session and is the one on screen", async () => {
		// Picking the session the displayed tab already holds must not run a full tab switch, which
		// would reset the tab's live extension chrome to the empty parked record.
		const a = await client();
		const tab = a.manager.getActive();
		const file = tab.runtime.session.sessionFile!;

		const calls: string[] = [];
		await handleResumeIntoTab(
			{
				...host(a),
				activateTab: async (target) => {
					calls.push(`activate:${target.id}`);
				},
				switchActiveTab: async (target) => {
					calls.push(`switch:${target.id}`);
					await a.switchActiveTab(target);
				},
			},
			file,
		);

		expect(a.errors).toEqual([]);
		expect(a.status).toEqual([`Session is already open in tab "Agent-01".`]);
		expect(calls).toEqual([`activate:${tab.id}`]);
		expect(a.manager.getActive().id).toBe(tab.id);
		expect(a.manager.list()).toHaveLength(1);
	});

	it("asks before opening a session whose recorded cwd is gone, and opens it in the chosen cwd", async () => {
		const focused = await client();
		const goneWorkdir = join(root, "gone");
		mkdirSync(goneWorkdir);
		const stale = await createTabClient({ harness, workdir: goneWorkdir, sessionDir, agentDir });
		clients.push(stale);
		harness.setResponses([fauxAssistantMessage("stale reply")]);
		const staleSession = stale.manager.getActive().runtime.session;
		await staleSession.prompt("question from a deleted directory");
		const staleFile = staleSession.sessionFile!;
		await closeClient(stale);
		rmSync(goneWorkdir, { recursive: true, force: true });

		const prompts: MissingSessionCwdError[] = [];
		const trustCwds: string[] = [];
		await handleResumeIntoTab(
			host(focused, {
				promptMissingSessionCwd: async (error) => {
					prompts.push(error);
					return workdir;
				},
				trustCwds,
			}),
			staleFile,
		);

		expect(focused.errors).toEqual([]);
		expect(prompts).toHaveLength(1);
		expect(prompts[0]!.issue.sessionCwd).toBe(goneWorkdir);
		// The fallback offered is the cwd the focused tab sits in, not the missing one.
		expect(prompts[0]!.issue.fallbackCwd).toBe(focused.manager.getActive().runtime.cwd);
		// The trust decision follows the cwd the session is actually opened in.
		expect(trustCwds).toEqual([workdir]);
		expect(focused.status).toEqual(["Resumed session in current cwd"]);

		const resumed = focused.manager.list()[1]!;
		expect(resumed.runtime.session.sessionFile).toBe(staleFile);
		expect(resumed.runtime.cwd).toBe(workdir);
		expect(readFileSync(resumed.runtime.session.sessionFile!, "utf8")).toContain("question from a deleted directory");
	});

	it("opens the tab through the /resume entry point, and replaces the session only without a tab manager", async () => {
		const entry = (
			InteractiveMode.prototype as unknown as {
				handleResumeIntoTab(this: ResumeEntryContext, sessionPath: string): Promise<void>;
			}
		).handleResumeIntoTab;
		const a = await client();
		const other = await client();
		harness.setResponses([fauxAssistantMessage("other reply")]);
		const otherSession = other.manager.getActive().runtime.session;
		await otherSession.prompt("question from the other tab");
		const otherFile = otherSession.sessionFile!;
		await closeClient(other);

		const switched: string[] = [];
		const handleResumeSession = async (path: string) => {
			switched.push(path);
			return { cancelled: false };
		};
		const keptFile = a.manager.getActive().runtime.session.sessionFile!;

		// A host that holds tabs opens one and never replaces the session in place.
		await entry.call({ tabManager: a.manager, handleResumeSession, resumeTabHost: () => host(a) }, otherFile);
		expect(a.manager.list().map((tab) => tab.runtime.session.sessionFile)).toEqual([keptFile, otherFile]);
		expect(switched).toEqual([]);

		// The single-session host has no tab to open, so the session replaces the current one.
		await entry.call({ tabManager: undefined, handleResumeSession, resumeTabHost: () => host(a) }, otherFile);
		expect(switched).toEqual([otherFile]);
		expect(a.manager.list()).toHaveLength(2);
	});
});
