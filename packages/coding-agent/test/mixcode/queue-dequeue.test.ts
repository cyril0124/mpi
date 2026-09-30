import { existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Agent } from "@earendil-works/pi-agent-core";
import { getModel } from "@earendil-works/pi-ai/compat";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AgentSession } from "../../src/core/agent-session.ts";
import { AuthStorage } from "../../src/core/auth-storage.ts";
import { SessionManager } from "../../src/core/session-manager.ts";
import { SettingsManager } from "../../src/core/settings-manager.ts";
import { createModelRegistry, getModelRuntime } from "../model-runtime-test-utils.ts";
import { createTestResourceLoader } from "../utilities.ts";

describe("AgentSession queue dequeue/restore", () => {
	let session: AgentSession;
	let tempDir: string;

	beforeEach(async () => {
		tempDir = join(tmpdir(), `pi-queue-dequeue-test-${Date.now()}`);
		mkdirSync(tempDir, { recursive: true });
		const model = getModel("anthropic", "claude-sonnet-4-5")!;
		const agent = new Agent({
			getApiKey: () => "test-key",
			initialState: { model, systemPrompt: "Test", tools: [] },
			// Never invoked: these tests only exercise the queues.
			streamFn: () => {
				throw new Error("no stream expected");
			},
		});
		const sessionManager = SessionManager.inMemory();
		const settingsManager = SettingsManager.create(tempDir, tempDir);
		const authStorage = AuthStorage.create(join(tempDir, "auth.json"));
		const modelRegistry = await createModelRegistry(authStorage, tempDir);
		session = new AgentSession({
			agent,
			sessionManager,
			settingsManager,
			cwd: tempDir,
			modelRuntime: getModelRuntime(modelRegistry),
			resourceLoader: createTestResourceLoader(),
		});
		session.subscribe(() => {});
	});

	afterEach(() => {
		session.dispose();
		if (tempDir && existsSync(tempDir)) {
			rmSync(tempDir, { recursive: true });
		}
	});

	it("steer and followUp mirror texts, and getSteering/getFollowUp read them back", async () => {
		await session.steer("hold a");
		await session.followUp("later b");
		expect(session.getSteeringMessages()).toEqual(["hold a"]);
		expect(session.getFollowUpMessages()).toEqual(["later b"]);
	});

	it("removes matched texts from both mirrors and the queue, in queue order", async () => {
		await session.steer("one");
		await session.steer("two");
		const removed = session.removeQueuedMessages("steering", ["two", "one"]);
		expect(removed.map((item) => item.text)).toEqual(["one", "two"]);
		expect(session.getSteeringMessages()).toEqual([]);
		expect(session.pendingMessageCount).toBe(0);
	});

	it("skips unmatched texts instead of erroring", () => {
		const removed = session.removeQueuedMessages("steering", ["not queued"]);
		expect(removed).toEqual([]);
	});

	it("removes the last occurrence first on duplicate texts", async () => {
		await session.followUp("dup");
		await session.followUp("dup");
		const removed = session.removeQueuedMessages("followUp", ["dup"]);
		expect(removed).toHaveLength(1);
		expect(session.getFollowUpMessages()).toEqual(["dup"]);
	});

	it("restores removed entries and re-emits queue_update", async () => {
		await session.steer("revive me");
		const updates: number[] = [];
		const seen = () => session.getSteeringMessages().length;
		session.subscribe(() => updates.push(seen()));
		const removed = session.removeQueuedMessages("steering", ["revive me"]);
		session.restoreQueuedMessages("steering", removed);
		expect(session.getSteeringMessages()).toEqual(["revive me"]);
		expect(updates.at(-1)).toBe(1);
	});

	it("restore of an empty list emits no queue update and leaves the queue empty", () => {
		const updates: number[] = [];
		session.subscribe(() => updates.push(session.pendingMessageCount));

		session.restoreQueuedMessages("steering", []);

		expect(updates).toEqual([]);
		expect(session.pendingMessageCount).toBe(0);
	});

	it("clearQueue still clears both queues after a dequeue/restore cycle", async () => {
		await session.steer("s");
		await session.followUp("f");
		const removed = session.removeQueuedMessages("followUp", ["f"]);
		session.restoreQueuedMessages("followUp", removed);
		const cleared = session.clearQueue();
		expect(cleared).toEqual({ steering: ["s"], followUp: ["f"] });
		expect(session.pendingMessageCount).toBe(0);
	});
});
