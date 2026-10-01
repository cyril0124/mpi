import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AuthStorage } from "../../src/core/auth-storage.ts";
import { createEventBus } from "../../src/core/event-bus.ts";
import { createExtensionRuntime, loadExtensionFromFactory } from "../../src/core/extensions/loader.ts";
import { ExtensionRunner } from "../../src/core/extensions/runner.ts";
import type { ExtensionFactory } from "../../src/core/extensions/types.ts";
import type { ModelRegistry } from "../../src/core/model-registry.ts";
import { SessionManager } from "../../src/core/session-manager.ts";
import { createInMemoryModelRegistry } from "../model-runtime-test-utils.ts";

/**
 * An extension can load other extensions from its own session_start handler, registering
 * their handlers while that event is being dispatched. session_start runs once per session,
 * so those handlers have no later dispatch to wait for.
 */
describe("session_start dispatch", () => {
	let tempDir: string;
	let sessionManager: SessionManager;
	let modelRegistry: ModelRegistry;

	beforeEach(async () => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-session-start-dispatch-"));
		sessionManager = SessionManager.inMemory();
		modelRegistry = await createInMemoryModelRegistry(AuthStorage.inMemory());
	});

	afterEach(() => {
		fs.rmSync(tempDir, { recursive: true, force: true });
	});

	async function loadRunner(factory: ExtensionFactory): Promise<ExtensionRunner> {
		const runtime = createExtensionRuntime();
		const extension = await loadExtensionFromFactory(factory, tempDir, createEventBus(), runtime);
		return new ExtensionRunner([extension], runtime, tempDir, sessionManager, modelRegistry);
	}

	it("dispatches to a handler registered during the same session_start", async () => {
		const calls: string[] = [];
		const runner = await loadRunner((pi) => {
			pi.on("session_start", () => {
				calls.push("loader");
				pi.on("session_start", () => {
					calls.push("loaded");
				});
			});
		});

		await runner.emit({ type: "session_start", reason: "startup" });
		expect(calls).toEqual(["loader", "loaded"]);
	});

	it("still defers a registration made during a repeating event", async () => {
		const calls: string[] = [];
		const runner = await loadRunner((pi) => {
			pi.on("agent_end", () => {
				calls.push("loader");
				pi.on("agent_end", () => {
					calls.push("loaded");
				});
			});
		});

		await runner.emit({ type: "agent_end", messages: [] });
		expect(calls).toEqual(["loader"]);

		await runner.emit({ type: "agent_end", messages: [] });
		expect(calls).toEqual(["loader", "loader", "loaded"]);
	});
});
