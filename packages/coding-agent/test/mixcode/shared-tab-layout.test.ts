import { fork } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { fauxAssistantMessage } from "@earendil-works/pi-ai/compat";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	mutateOpenTabs,
	readOpenTabs,
	readTabMeta,
	resolveSessionPath,
	saveTabMeta,
} from "../../src/core/mixcode/multi-tab/mixcode-state.ts";
import type { SharedTabLayout } from "../../src/core/mixcode/multi-tab/shared-tab-layout.ts";
import type { TabManager } from "../../src/core/mixcode/multi-tab/tab-manager.ts";
import { SessionManager } from "../../src/core/session-manager.ts";
import { createHarness, type Harness } from "../suite/harness.ts";
import { createTabClient } from "./helpers/tab-runtime.ts";

let root: string;
let workdir: string;
let sessionDir: string;
let harness: Harness;
const clients: Array<{ manager: TabManager; shared: SharedTabLayout }> = [];

beforeEach(async () => {
	root = mkdtempSync(join(tmpdir(), "pi-shared-tabs-"));
	workdir = join(root, "project");
	sessionDir = join(root, "sessions");
	mkdirSync(workdir, { recursive: true });
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

async function createClient(sessionPath?: string) {
	const client = await createTabClient({ harness, workdir, sessionDir, agentDir: join(root, "agent"), sessionPath });
	clients.push(client);
	return client;
}

function ids(manager: TabManager): string[] {
	return manager.list().map((tab) => tab.runtime.session.sessionManager.getSessionId());
}

function storedIds(): string[] {
	const stored = readOpenTabs(workdir);
	if (stored.kind !== "ok") throw new Error(`Expected stored layout, got ${stored.kind}`);
	return stored.snapshot.sessionIds;
}

describe("shared tab runtime integration", () => {
	it("preserves 50 tabs, titles and unread badges written by two concurrent processes", async () => {
		const file = fileURLToPath(new URL("./fixtures/shared-state-writer.ts", import.meta.url));
		const writers = ["a", "b"].map((instance) => {
			const child = fork(file, [workdir, instance], {
				execArgv: ["--experimental-strip-types"],
				stdio: ["ignore", "pipe", "pipe", "ipc"],
			});
			let output = "";
			child.stdout?.on("data", (chunk) => {
				output += String(chunk);
			});
			child.stderr?.on("data", (chunk) => {
				output += String(chunk);
			});
			const ready = new Promise<void>((resolve, reject) => {
				child.once("message", () => resolve());
				child.once("error", reject);
				child.once("exit", (code) => {
					if (code !== 0) reject(new Error(output));
				});
			});
			const done = new Promise<void>((resolve, reject) => {
				child.once("exit", (code) => (code === 0 ? resolve() : reject(new Error(output))));
				child.once("error", reject);
			});
			return { child, ready, done };
		});
		try {
			await Promise.all(writers.map((writer) => writer.ready));
			for (const writer of writers) writer.child.send("start");
			await Promise.all(writers.map((writer) => writer.done));
			expect(storedIds()).toHaveLength(50);
			const meta = readTabMeta(workdir);
			for (const instance of ["a", "b"]) {
				for (let index = 0; index < 25; index++) {
					expect(meta.get(`${instance}-${index}`)).toMatchObject({
						title: `${instance}-${index}`,
						unread: index % 2 === 0,
					});
				}
			}
		} finally {
			for (const writer of writers) if (writer.child.exitCode === null) writer.child.kill();
		}
	});
	it("keeps two live managers aligned through empty-tab create, close, replacement and restart", async () => {
		const a = await createClient();
		const original = a.manager.getActive();
		const originalPath = original.runtime.session.sessionFile!;
		expect(existsSync(originalPath)).toBe(true);
		harness.setResponses([fauxAssistantMessage("Persisted after publication")]);
		await original.runtime.session.prompt("First turn after publishing an empty session");
		const entries = readFileSync(originalPath, "utf8")
			.trim()
			.split("\n")
			.map((line) => JSON.parse(line) as { type: string });
		expect(entries.filter((entry) => entry.type === "session")).toHaveLength(1);
		expect(original.runtime.session.messages.filter((message) => message.role === "user")).toHaveLength(1);
		expect(original.runtime.session.messages.filter((message) => message.role === "assistant")).toHaveLength(1);
		expect(SessionManager.open(originalPath, sessionDir).getEntries()).toEqual(
			original.runtime.session.sessionManager.getEntries(),
		);
		const b = await createClient(originalPath);
		const focusedInB = b.manager.getActive().id;
		const research = await a.manager.createTab({ title: "Research" });
		a.manager.rename(research.id, "Research");
		a.manager.setColor(research.id, "red");
		const audit = await b.manager.createTab({ title: "Audit" });
		b.manager.rename(audit.id, "Audit");
		const auditId = audit.runtime.session.sessionManager.getSessionId();
		expect(storedIds()).toEqual([ids(a.manager)[0], ids(a.manager)[1], auditId]);
		await a.shared.reconcileNow();
		await b.shared.reconcileNow();
		expect(ids(a.manager)).toEqual(storedIds());
		expect(ids(b.manager)).toEqual(storedIds());
		expect(b.manager.getActive().id).toBe(audit.id);
		expect(b.manager.list().find((tab) => tab.title === "Research")?.color).toBe("red");
		expect(focusedInB).not.toBe(audit.id);

		await b.manager.closeTab(audit.id);
		await a.shared.reconcileNow();
		expect(ids(a.manager)).not.toContain(auditId);
		expect(a.closedUi).toHaveLength(1);
		const oldResearchId = research.runtime.session.sessionManager.getSessionId();
		await research.runtime.newSession();
		const newResearchId = research.runtime.session.sessionManager.getSessionId();
		expect(newResearchId).not.toBe(oldResearchId);
		expect(storedIds()).toEqual([ids(a.manager)[0], newResearchId]);
		await b.shared.reconcileNow();
		expect(ids(b.manager)).toEqual(storedIds());

		// A focus change alone writes nothing; the layout is published when it changes
		// and once more on shutdown, so publish here the way shutdown does.
		a.manager.activate(original.id);
		a.shared.publish();
		const snapshot = readOpenTabs(workdir);
		expect(snapshot.kind === "ok" && snapshot.snapshot.activeSessionId).toBe(ids(a.manager)[0]);
		const fresh = await createClient(originalPath);
		await fresh.shared.reconcileNow();
		expect(ids(fresh.manager)).toEqual(storedIds());
		expect(a.errors).toEqual([]);
		expect(b.errors).toEqual([]);
		expect(fresh.errors).toEqual([]);
		expect(readFileSync(originalPath, "utf8").split("\n")[0]).toContain(ids(a.manager)[0]);
		a.manager.setColor(original.id, "blue");
		a.manager.setColor(research.id, "red");
		a.manager.groupByColor();
		await b.shared.reconcileNow();
		expect(ids(b.manager)).toEqual(ids(a.manager));
		expect(b.manager.list().map((tab) => tab.color)).toEqual(["red", "blue"]);
	});

	it("keeps a focused tab's cleared badge cleared when the layout is reconciled", async () => {
		const a = await createClient();
		const tab = a.manager.getActive();
		const sessionId = ids(a.manager)[0]!;
		// A finished background turn publishes the badge to the shared state.
		a.manager.setUnread(tab.id, true);
		a.shared.publish();
		expect(readTabMeta(workdir).get(sessionId)?.unread).toBe(true);

		// Focusing clears the badge in memory and in the shared state; the reconcile
		// below must not read the old badge back out of the file.
		a.manager.activate(tab.id);
		expect(tab.unread).toBe(false);
		expect(readTabMeta(workdir).get(sessionId)?.unread).toBe(false);

		await a.shared.reconcileNow();
		expect(tab.unread).toBe(false);
	});

	it("keeps a marked tab's badge when a restart skips the layout restore", async () => {
		const a = await createClient();
		const tab = a.manager.getActive();
		const sessionId = ids(a.manager)[0]!;
		a.manager.markLoaded(tab.id);
		a.manager.markDone(tab.id);
		const sessionPath = tab.runtime.session.sessionFile!;
		expect(readTabMeta(workdir).get(sessionId)?.unread).toBe(true);

		// The restart opens the same session as its first tab and never runs the layout
		// restore, so the shared layout has to adopt the badge before its first publish.
		const b = await createClient(sessionPath);
		expect(b.manager.getActive().unread).toBe(true);
		expect(readTabMeta(workdir).get(sessionId)?.unread).toBe(true);
	});

	it("does not erase a peer rename or unread badge when an unchanged local layout publishes", async () => {
		const a = await createClient();
		const sharedId = ids(a.manager)[0]!;
		const b = await createClient(a.manager.getActive().runtime.session.sessionFile);
		saveTabMeta(workdir, [
			{ sessionId: sharedId, title: "Remote chosen title", workdir, color: "blue", unread: true },
		]);
		b.shared.publish();
		const another = await b.manager.createTab();
		b.manager.setColor(another.id, "green");
		const meta = readTabMeta(workdir).get(sharedId);
		expect(meta).toMatchObject({ title: "Remote chosen title", color: "blue", unread: true });
		b.manager.setColor(b.manager.list()[0]!.id, "magenta");
		expect(readTabMeta(workdir).get(sharedId)).toMatchObject({
			title: "Remote chosen title",
			color: "magenta",
			unread: true,
		});
		await a.shared.reconcileNow();
		expect(ids(a.manager)).toEqual(storedIds());
	});

	it("publishes a layout replacement once and keeps a busy removed tab until idle", async () => {
		const a = await createClient();
		const b = await createClient(a.manager.getActive().runtime.session.sessionFile);
		const keep = await a.manager.createTab({ title: "Keep" });
		await b.shared.reconcileNow();
		const previous = b.manager.list()[0]!;
		const busy = vi.spyOn(previous.runtime.session, "isStreaming", "get").mockReturnValue(true);
		await a.shared.transaction(
			async () => {
				await a.manager.closeTab(a.manager.list()[0]!.id);
				a.manager.activate(keep.id);
			},
			{ replace: true },
		);
		await b.shared.reconcileNow();
		expect(b.manager.get(previous.id)).toBeDefined();
		expect(storedIds()).toEqual([keep.runtime.session.sessionManager.getSessionId()]);
		busy.mockRestore();
		await b.shared.reconcileNow();
		expect(ids(b.manager)).toEqual(storedIds());
		expect(b.manager.getActive().runtime.session.sessionManager.getSessionId()).toBe(storedIds()[0]);
		expect(b.errors).toEqual([]);
	});

	it("keeps a recorded id stable when its session file is gone, instead of growing the layout", async () => {
		const a = await createClient();
		// A recorded id with no session file (a session deleted outside the app, or a
		// file that was never written).
		const ghostId = "019f0000-0000-7000-8000-000000000001";
		mutateOpenTabs(workdir, (ids) => {
			ids.add(ghostId);
		});
		const before = storedIds();

		// The restore rebuilds that tab under its recorded id rather than a fresh id.
		await a.manager.createTab({ title: "ghost", id: ghostId, sessionId: ghostId });
		a.shared.publish();

		expect(storedIds()).toEqual(before);
		expect(resolveSessionPath(sessionDir, ghostId)).toBeDefined();
		clients.splice(clients.indexOf(a), 1);
		a.shared.dispose();
		await a.manager.dispose();

		// The next start restores one tab per recorded id, with no duplicate and no error.
		const b = await createClient(resolveSessionPath(sessionDir, before[0]!));
		await b.shared.reconcileNow();
		expect(ids(b.manager)).toEqual(storedIds());
		expect(new Set(ids(b.manager)).size).toBe(ids(b.manager).length);
		expect(b.errors).toEqual([]);
	});

	it("tells the host to bind a tab it opens for a peer, so its chip leaves the loading state", async () => {
		const a = await createClient();
		const b = await createClient(a.manager.getActive().runtime.session.sessionFile);
		const peer = await b.manager.createTab({ title: "Peer" });

		await a.shared.reconcileNow();
		expect(a.openedUi).toHaveLength(1);
		expect(a.manager.get(a.openedUi[0]!)).toBeDefined();
		expect(peer.runtime.session.sessionManager.getSessionId()).toBe(
			a.manager.get(a.openedUi[0]!)!.runtime.session.sessionManager.getSessionId(),
		);
	});

	it("adopts a session file's real id instead of reopening it on every poll", async () => {
		const a = await createClient();
		const realId = "019f0000-0000-7000-8000-00000000000a";
		const fileId = "019f0000-0000-7000-8000-00000000000b";
		// A file whose name id and header id disagree (a repaired empty file).
		const header = SessionManager.create(workdir, sessionDir).getHeader()!;
		writeFileSync(
			join(sessionDir, `2026-09-30T00-00-00-000Z_${fileId}.jsonl`),
			`${JSON.stringify({ ...header, id: realId })}\n`,
		);
		mutateOpenTabs(workdir, (ids) => {
			ids.add(fileId);
		});

		await a.shared.reconcileNow();
		expect(ids(a.manager)).toContain(realId);
		expect(storedIds()).toContain(realId);
		expect(storedIds()).not.toContain(fileId);

		// The adopted id satisfies the shared set, so later polls open nothing.
		const settled = a.manager.size;
		await a.shared.reconcileNow();
		await a.shared.reconcileNow();
		expect(a.manager.size).toBe(settled);
		expect(new Set(ids(a.manager)).size).toBe(ids(a.manager).length);
		expect(a.errors).toEqual([]);
	});

	it("retries a peer tab whose session file is not on disk without inventing another session id", async () => {
		const a = await createClient();
		const unpublished = SessionManager.create(workdir, sessionDir);
		const peerId = unpublished.getSessionId();
		mutateOpenTabs(workdir, (ids) => {
			ids.add(peerId);
		});
		await a.shared.reconcileNow();
		expect(ids(a.manager)).not.toContain(peerId);
		expect(storedIds()).toContain(peerId);
		expect(a.errors.length).toBeGreaterThan(0);
		writeFileSync(unpublished.getSessionFile()!, `${JSON.stringify(unpublished.getHeader())}\n`);
		await a.shared.reconcileNow();
		expect(ids(a.manager)).toEqual(storedIds());
		expect(ids(a.manager).filter((id) => id === peerId)).toHaveLength(1);
	});
});
