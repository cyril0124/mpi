import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { writeOpenTabs } from "../../src/core/mixcode/multi-tab/mixcode-state.ts";
import { type PeerTabSync, startPeerTabSync } from "../../src/core/mixcode/multi-tab/peer-tab-sync.ts";

let root: string;
let workdir: string;
let sync: PeerTabSync | undefined;

beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), "pi-peer-tabs-"));
	workdir = join(root, "project");
	mkdirSync(workdir);
	vi.stubEnv("PI_CODING_AGENT_DIR", join(root, "agent"));
});

afterEach(() => {
	sync?.dispose();
	sync = undefined;
	vi.unstubAllEnvs();
	rmSync(root, { recursive: true, force: true });
});

describe("peer reconciliation across asynchronous changes", () => {
	it("re-reads desired membership after opening a session and preserves a concurrently added local tab", async () => {
		writeOpenTabs(workdir, ["first", "removed-during-open"]);
		const local = new Set(["local"]);
		const errors: unknown[] = [];
		const opened: string[] = [];
		const closed: string[] = [];
		sync = startPeerTabSync({
			workdir,
			getLocalSessionIds: () => local,
			openTab: async ({ sessionId }) => {
				await Promise.resolve();
				opened.push(sessionId);
				if (sessionId === "retry-next-poll") throw new Error("not on disk yet");
				local.add(sessionId);
				if (sessionId === "first") {
					local.add("added-during-open");
					writeOpenTabs(workdir, ["first", "added-during-open", "retry-next-poll"]);
				}
			},
			closeTab: async (sessionId) => {
				closed.push(sessionId);
				local.delete(sessionId);
			},
			onError: (error) => {
				errors.push(error);
			},
		});
		await sync.reconcileNow();
		expect(opened).toEqual(["first", "retry-next-poll"]);
		expect(closed).toEqual(["local"]);
		expect(local.has("added-during-open")).toBe(true);
		expect(errors).toHaveLength(1);
	});

	it("stops further opens after disposal during an awaited open", async () => {
		writeOpenTabs(workdir, ["first", "second"]);
		const opened: string[] = [];
		sync = startPeerTabSync({
			workdir,
			getLocalSessionIds: () => opened,
			openTab: async ({ sessionId }) => {
				await Promise.resolve();
				opened.push(sessionId);
				sync?.dispose();
			},
			closeTab: async () => {
				throw new Error("Disposed reconciliation must not close tabs");
			},
		});
		await sync.reconcileNow();
		expect(opened).toEqual(["first"]);
	});
});
