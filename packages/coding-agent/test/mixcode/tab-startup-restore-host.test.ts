import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fauxAssistantMessage } from "@earendil-works/pi-ai";
import type { TUI } from "@earendil-works/pi-tui";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { VirtualTerminal } from "../../../tui/test/virtual-terminal.ts";
import {
	AgentSessionRuntime,
	type AgentSessionRuntimeDiagnostic,
	type CreateAgentSessionRuntimeFactory,
} from "../../src/core/agent-session-runtime.ts";
import type { ExtensionUIContext } from "../../src/core/extensions/types.ts";
import * as tabState from "../../src/core/mixcode/multi-tab/mixcode-state.ts";
import type { AgentTab } from "../../src/core/mixcode/multi-tab/tab-manager.ts";
import { listTrash, moveToTrash } from "../../src/core/mixcode/session-trash.ts";
import { SessionManager } from "../../src/core/session-manager.ts";
import { InteractiveMode } from "../../src/modes/interactive/interactive-mode.ts";
import { TabController } from "../../src/modes/interactive/mixcode/multi-tab/tab-controller.ts";
import { stripAnsi } from "../../src/utils/ansi.ts";
import * as syntaxHighlight from "../../src/utils/syntax-highlight.ts";
import * as toolsManager from "../../src/utils/tools-manager.ts";
import { createHarness, type Harness } from "../suite/harness.ts";

function deferred(): { promise: Promise<void>; resolve(): void } {
	let resolve: () => void = () => {};
	const promise = new Promise<void>((done) => {
		resolve = done;
	});
	return { promise, resolve };
}

let root: string;

beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), "pi-startup-host-"));
	vi.stubEnv("PI_CODING_AGENT_DIR", join(root, "agent"));
	vi.spyOn(toolsManager, "ensureTool").mockResolvedValue(undefined);
	vi.spyOn(syntaxHighlight, "loadAllHighlightLanguages").mockResolvedValue(undefined);
});

afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllEnvs();
	rmSync(root, { recursive: true, force: true });
});

async function createStartupHost() {
	const workdir = join(root, "project");
	const sessionDir = join(root, "sessions");
	mkdirSync(workdir, { recursive: true });
	mkdirSync(sessionDir, { recursive: true });
	const trace: string[] = [];
	const harnesses: Harness[] = [];
	const bindActions = new Map<string, (ui: ExtensionUIContext, manager: SessionManager) => Promise<void>>();
	const createGates = new Map<string, Promise<void>>();
	const eventActions = new Map<string, (message: string) => void>();
	const diagnostics = new Map<string, AgentSessionRuntimeDiagnostic[]>();
	const failedIds = new Set<string>();
	const terminal = new VirtualTerminal(110, 50);
	const write = terminal.write.bind(terminal);
	vi.spyOn(terminal, "write").mockImplementation((data) => {
		if (stripAnsi(data).includes("MixCode / HOME")) trace.push("paint:home");
		write(data);
	});
	const createRuntime: CreateAgentSessionRuntimeFactory = async ({ cwd, sessionManager }) => {
		const id = sessionManager.getSessionId();
		trace.push(`create:${id}`);
		await createGates.get(id);
		if (failedIds.has(id)) throw new Error(`planned restore failure: ${id}`);
		const harness = await createHarness({
			sessionManager,
			extensionFactories: [
				(pi) => {
					eventActions.set(id, (message) => pi.events.emit("tab-error", message));
					pi.events.on("tab-error", (message) => {
						throw new Error(String(message));
					});
					pi.on("session_start", async (_event, ctx) => {
						trace.push(`bind:${id}`);
						await bindActions.get(id)?.(ctx.ui, sessionManager);
						trace.push(`ready:${sessionManager.getSessionId()}`);
					});
				},
			],
		});
		harnesses.push(harness);
		return {
			session: harness.session,
			services: {
				cwd,
				agentDir: join(root, "agent"),
				modelRuntime: harness.session.modelRuntime,
				settingsManager: harness.settingsManager,
				resourceLoader: harness.session.resourceLoader,
				diagnostics: [],
			},
			extensionsResult: harness.session.resourceLoader.getExtensions(),
			diagnostics: diagnostics.get(id) ?? [],
		};
	};
	const initial = await createRuntime({
		cwd: workdir,
		agentDir: join(root, "agent"),
		sessionManager: SessionManager.create(workdir, sessionDir),
	});
	const runtime = new AgentSessionRuntime(initial.session, initial.services, createRuntime);
	const mode = new InteractiveMode(runtime, { terminal, tuiMode: "regular", createRuntime });
	const tabs = Reflect.get(mode, "tabs") as TabController;
	expect(tabs).toBeInstanceOf(TabController);
	const manager = tabs.manager!;
	const shared = tabs.sharedLayout!;
	const ui = Reflect.get(mode, "ui") as TUI;
	const start = shared.start.bind(shared);
	const peerStart = vi.spyOn(shared, "start").mockImplementation(() => {
		trace.push("peer:start");
		start();
	});
	const warnings: string[] = [];
	const warning = Reflect.get(mode, "showWarning").bind(mode) as (message: string) => void;
	Reflect.set(mode, "showWarning", (message: string) => {
		warnings.push(message);
		warning(message);
	});
	// Process lifetime belongs to the test runner, not to an interactive signal handler.
	Reflect.set(mode, "registerSignalHandlers", () => {});
	const initialId = initial.session.sessionManager.getSessionId();
	const initialTabId = manager.getActive().id;
	function saveSession(
		recordedId: string,
		actualId = recordedId,
		directory = sessionDir,
		conversation = false,
	): string {
		mkdirSync(directory, { recursive: true });
		const saved = SessionManager.inMemory(workdir, { id: actualId });
		if (conversation) {
			saved.appendMessage({ role: "user", content: `KEEP-${actualId}`, timestamp: 1 });
			saved.appendMessage(fauxAssistantMessage(`ANSWER-${actualId}`));
		}
		const file = join(directory, `2026-01-01T00-00-00-000Z_${recordedId}.jsonl`);
		const entries = [saved.getHeader(), ...saved.getEntries()];
		writeFileSync(file, `${entries.map((entry) => JSON.stringify(entry)).join("\n")}\n`);
		return file;
	}
	async function capture(): Promise<string> {
		ui.requestRender();
		await terminal.waitForRender();
		return terminal.getViewport().map(stripAnsi).join("\n");
	}
	async function dispose(): Promise<void> {
		mode.stop();
		await tabs.dispose(runtime);
		for (const harness of harnesses) harness.cleanup();
	}
	return {
		mode,
		manager,
		shared,
		ui,
		terminal,
		trace,
		workdir,
		sessionDir,
		initialId,
		initialTabId,
		bindActions,
		createGates,
		eventActions,
		diagnostics,
		activate: Reflect.get(mode, "activateTab").bind(mode) as (tab: AgentTab) => Promise<void>,
		activateHome: Reflect.get(mode, "activateHome").bind(mode) as () => Promise<void>,
		bind: Reflect.get(mode, "bindTabExtensions").bind(mode) as (tab: AgentTab) => Promise<void>,
		failedIds,
		peerStart,
		warnings,
		saveSession,
		capture,
		dispose,
	};
}

describe("InteractiveMode tab diagnostic ownership", () => {
	// #11264: pi.events errors use the owning extension runner even if focus moved after binding.
	test("an Events error waits for its owning tab and survives a same-tab return from Home", async () => {
		const host = await createStartupHost();
		try {
			await host.mode.init();
			const a = host.manager.getActive();
			const b = await host.manager.createTab({ title: "B" });
			await host.activate(b);
			await host.bind(b);
			const emitA = host.eventActions.get(host.initialId)!;
			emitA("EVENTS-ERROR-FROM-A");
			await new Promise<void>((resolve) => setImmediate(resolve));
			expect(await host.capture()).not.toContain("EVENTS-ERROR-FROM-A");
			await host.activate(a);
			const error = 'Extension "<inline:1>" error: EVENTS-ERROR-FROM-A';
			expect((await host.capture()).split(error)).toHaveLength(2);
			await host.activateHome();
			emitA("EVENTS-ERROR-FROM-HOME");
			await new Promise<void>((resolve) => setImmediate(resolve));
			expect(await host.capture()).not.toContain("EVENTS-ERROR-FROM-HOME");
			await host.activate(a);
			expect((await host.capture()).split("EVENTS-ERROR-FROM-HOME")).toHaveLength(2);
			await host.activate(b);
			expect(await host.capture()).not.toContain("EVENTS-ERROR-FROM-");
			await host.activate(a);
			expect((await host.capture()).split(error)).toHaveLength(2);
		} finally {
			await host.dispose();
		}
	});

	test("new, restored, resumed and replaced runtimes report diagnostics once on their own tab", async () => {
		const host = await createStartupHost();
		try {
			const restoredId = randomUUID();
			const resumedId = randomUUID();
			const newId = randomUUID();
			const restored = { type: "warning", message: "DIAGNOSTIC-RESTORED" } as const;
			const resumed = { type: "error", message: "DIAGNOSTIC-RESUMED" } as const;
			const fresh = { type: "warning", message: "DIAGNOSTIC-NEW" } as const;
			const freshInfo = { type: "info", message: "DIAGNOSTIC-NEW-INFO" } as const;
			const modelInfo = { type: "info", message: "DIAGNOSTIC-NEW-MODEL" } as const;
			host.saveSession(restoredId);
			const resumePath = host.saveSession(resumedId);
			host.diagnostics.set(restoredId, [restored]);
			host.diagnostics.set(resumedId, [resumed]);
			host.diagnostics.set(newId, [fresh, freshInfo, modelInfo]);
			tabState.writeOpenTabs(host.workdir, [restoredId], restoredId);
			await host.mode.init();
			expect(await host.capture()).not.toContain(restored.message);
			const a = host.manager.getActive();
			await host.activate(a);
			expect((await host.capture()).split(restored.message)).toHaveLength(2);

			const b = await host.manager.createTab({ title: "B", sessionId: newId });
			await host.activate(b);
			await host.bind(b);
			const freshOutput = await host.capture();
			expect(freshOutput.split(`Warning: ${fresh.message} `)).toHaveLength(2);
			expect(freshOutput.split(freshInfo.message)).toHaveLength(2);
			expect(freshOutput.split(modelInfo.message)).toHaveLength(2);
			expect(freshOutput).not.toContain(restored.message);

			const c = await host.manager.openSessionTab(resumePath, { title: "C" });
			await host.activate(c);
			await host.bind(c);
			expect((await host.capture()).split(resumed.message)).toHaveLength(2);
			expect(await host.capture()).not.toContain(fresh.message);

			const replacementId = randomUUID();
			const replacementPath = host.saveSession(replacementId, replacementId, host.sessionDir, true);
			const replacement = { type: "error", message: "DIAGNOSTIC-REPLACEMENT" } as const;
			host.diagnostics.set(replacementId, [fresh, replacement]);
			// Replacing B while C is mounted must keep C's transcript and its live diagnostic.
			await b.runtime.switchSession(replacementPath);
			const current = await host.capture();
			expect(current).toContain(resumed.message);
			expect(current).not.toContain(replacement.message);
			await host.activate(b);
			const replaced = await host.capture();
			expect(replaced).toContain("KEEP-");
			expect(replaced.split(replacement.message)).toHaveLength(2);
			expect(replaced).not.toContain(fresh.message);
			await host.activate(a);
			expect(await host.capture()).not.toContain(replacement.message);
			await host.activate(b);
			expect((await host.capture()).split(replacement.message)).toHaveLength(2);

			const focusedId = randomUUID();
			const focusedPath = host.saveSession(focusedId);
			const focused = { type: "warning", message: "DIAGNOSTIC-FOCUSED-REPLACEMENT" } as const;
			host.diagnostics.set(focusedId, [fresh, replacement, focused]);
			await b.runtime.switchSession(focusedPath);
			const focusedOutput = await host.capture();
			expect(focusedOutput.split(focused.message)).toHaveLength(2);
			expect(focusedOutput).not.toContain(replacement.message);
			await host.activate(c);
			expect(await host.capture()).not.toContain(focused.message);
			await host.activate(b);
			expect((await host.capture()).split(focused.message)).toHaveLength(2);
		} finally {
			await host.dispose();
		}
	});
});

describe("InteractiveMode startup restore contract", () => {
	test("Home precedes slow binds, parked binds release later tabs, and canonical ids are published once", async () => {
		const host = await createStartupHost();
		const slow = deferred();
		const lastCreation = deferred();
		const recordedA = randomUUID();
		const actualA = randomUUID();
		const b = randomUUID();
		const actualB = randomUUID();
		const c = randomUUID();
		let initialization: Promise<void> | undefined;
		let answer: ((value: string) => void) | undefined;
		try {
			host.saveSession(recordedA, actualA);
			host.saveSession(b);
			host.saveSession(c);
			tabState.writeOpenTabs(host.workdir, [recordedA, b, c], c);
			tabState.saveTabMeta(host.workdir, [
				{ sessionId: recordedA, title: "Agent-03", titleLocked: true, color: "blue", unread: true },
				{ sessionId: c, title: "Notes", color: "green", unread: true },
			]);
			const initialLayout = readFileSync(tabState.openTabsFilePath(host.workdir), "utf8");
			const rewrites = vi.spyOn(tabState, "replaceOpenTabSessionIds");
			host.bindActions.set(actualA, async () => {
				await slow.promise;
			});
			host.bindActions.set(b, async (context, sessionManager) => {
				await context.custom<string>(
					(_ui, _theme, _keys, done) => {
						answer = done;
						return { render: () => ["RESTORE-QUESTION-B"], invalidate() {} };
					},
					{ blocked: { kind: "question", message: "Restore B" } },
				);
				// A local bind adopts a session id only after its parked question is answered.
				sessionManager.newSession({ id: actualB });
			});
			host.createGates.set(c, lastCreation.promise);
			initialization = host.mode.init();
			await vi.waitFor(() => expect(host.trace).toContain(`bind:${actualA}`));
			expect(host.trace.indexOf("paint:home")).toBeGreaterThanOrEqual(0);
			expect(host.trace.indexOf("paint:home")).toBeLessThan(host.trace.indexOf(`bind:${actualA}`));
			expect(await host.capture()).toContain("MixCode / HOME");
			expect(host.trace).not.toContain(`create:${b}`);
			expect(host.peerStart).not.toHaveBeenCalled();
			expect(readFileSync(tabState.openTabsFilePath(host.workdir), "utf8")).toBe(initialLayout);

			slow.resolve();
			await vi.waitFor(() => expect(host.trace).toContain(`create:${c}`));
			expect(host.manager.get(b)?.loadingPhase).toBe("waiting for input");
			expect(host.trace).not.toContain(`ready:${b}`);
			expect(host.peerStart).not.toHaveBeenCalled();
			expect(rewrites.mock.calls).toEqual([[host.workdir, [{ from: recordedA, to: actualA }]]]);
			lastCreation.resolve();
			await initialization;
			expect(host.peerStart).toHaveBeenCalledOnce();
			expect(host.trace.indexOf(`ready:${c}`)).toBeLessThan(host.trace.indexOf("peer:start"));
			expect(host.manager.list().map((tab) => tab.id)).toEqual([recordedA, b, c]);
			expect(host.trace.filter((event) => event.startsWith("bind:"))).toEqual([
				`bind:${host.initialId}`,
				`bind:${actualA}`,
				`bind:${b}`,
				`bind:${c}`,
			]);
			expect(host.manager.list().map((tab) => tab.title)).toEqual(["Agent-03", "Agent-01", "Notes"]);
			expect(host.manager.get(recordedA)).toMatchObject({
				color: "blue",
				titleLocked: true,
				unread: true,
				loading: false,
			});
			expect(host.manager.get(c)).toMatchObject({ color: "green", unread: true, loading: false });
			expect(host.manager.get(b)?.loading).toBe(true);
			expect(host.manager.getActive().id).toBe(c);
			expect(host.manager.get(host.initialTabId)).toBeUndefined();
			expect(await host.capture()).toContain("MixCode / HOME");
			expect(tabState.readOpenTabs(host.workdir)).toMatchObject({
				kind: "ok",
				snapshot: { version: 1, sessionIds: [actualA, b, c], activeSessionId: c },
			});

			answer!("resume");
			await vi.waitFor(() => expect(host.manager.get(b)?.loading).toBe(false));
			expect(rewrites.mock.calls).toEqual([
				[host.workdir, [{ from: recordedA, to: actualA }]],
				[host.workdir, [{ from: b, to: actualB }]],
			]);
			await host.shared.reconcileNow();
			await host.shared.reconcileNow();
			expect(host.manager.list().map((tab) => tab.runtime.session.sessionManager.getSessionId())).toEqual([
				actualA,
				actualB,
				c,
			]);
			expect(rewrites).toHaveBeenCalledTimes(2);
			expect(host.trace.filter((event) => event.startsWith("create:"))).toHaveLength(4);
			expect(tabState.readOpenTabs(host.workdir)).toMatchObject({
				kind: "ok",
				snapshot: { version: 1, sessionIds: [actualA, actualB, c] },
			});
			expect(host.warnings).toEqual([]);
		} finally {
			slow.resolve();
			lastCreation.resolve();
			answer?.("cleanup");
			await initialization;
			await host.dispose();
		}
	});

	test("trash matching uses the original directory and preserves conversation-bearing shadows and stored formats", async () => {
		const host = await createStartupHost();
		try {
			const deleted = randomUUID();
			const foreign = randomUUID();
			const recovered = randomUUID();
			const original = host.saveSession(deleted);
			moveToTrash(original, { sessionId: deleted, title: "Deleted" });
			const placeholder = host.saveSession(deleted);
			const foreignFile = host.saveSession(foreign, foreign, join(root, "other-sessions"));
			moveToTrash(foreignFile, { sessionId: foreign, title: "Other project" });
			host.saveSession(foreign);
			const recoveredFile = host.saveSession(recovered);
			moveToTrash(recoveredFile, { sessionId: recovered, title: "Recovered conversation" });
			host.saveSession(recovered, recovered, host.sessionDir, true);
			const conversation = readFileSync(recoveredFile, "utf8");
			expect(tabState.resolveSessionPath(host.sessionDir, recovered)).toBe(recoveredFile);
			tabState.writeOpenTabs(host.workdir, [deleted, foreign, recovered], foreign);
			tabState.saveTabMeta(host.workdir, [
				{ sessionId: foreign, title: "Keep local", color: "magenta", unread: true },
			]);
			const statePath = tabState.stateFilePath(host.workdir);
			const metadata = JSON.parse(readFileSync(statePath, "utf8")) as Record<string, unknown>;
			writeFileSync(statePath, JSON.stringify({ ...metadata, foreign_extension: { keep: "untouched" } }));
			await host.mode.init();
			expect(host.manager.list().map((tab) => tab.id)).toEqual([foreign]);
			expect(host.manager.get(foreign)).toMatchObject({
				title: "Keep local",
				color: "magenta",
				unread: true,
				loading: false,
			});
			expect(existsSync(placeholder)).toBe(false);
			expect(readFileSync(recoveredFile, "utf8")).toBe(conversation);
			expect((await listTrash()).filter((entry) => entry.sessionId === deleted)).toHaveLength(2);
			expect(host.trace.filter((event) => event.startsWith("create:"))).toEqual([
				`create:${host.initialId}`,
				`create:${foreign}`,
			]);
			const membership = JSON.parse(readFileSync(tabState.openTabsFilePath(host.workdir), "utf8")) as Record<
				string,
				unknown
			>;
			expect(Object.keys(membership).sort()).toEqual(["activeSessionId", "sessionIds", "updatedAt", "version"]);
			expect(membership).toMatchObject({ version: 1, sessionIds: [foreign], activeSessionId: foreign });
			const persisted = JSON.parse(readFileSync(statePath, "utf8")) as Record<string, unknown>;
			expect(persisted).toMatchObject({
				children: [foreign],
				tab_titles: { [foreign]: "Keep local" },
				tab_colors: { [foreign]: "magenta" },
				unseen_done: [foreign],
				foreign_extension: { keep: "untouched" },
			});
			expect(host.warnings).toEqual([]);
		} finally {
			await host.dispose();
		}
	});

	test("failed restores retain the fresh tab and clear loading placeholders before peer startup", async () => {
		const host = await createStartupHost();
		try {
			const failed = [randomUUID(), randomUUID()];
			for (const id of failed) {
				host.saveSession(id);
				host.failedIds.add(id);
			}
			tabState.writeOpenTabs(host.workdir, failed, failed[1]);
			await host.mode.init();
			expect(host.manager.list().map((tab) => tab.id)).toEqual([host.initialTabId]);
			expect(host.manager.getActive().loading).toBe(false);
			expect(host.trace.filter((event) => event.startsWith("create:"))).toEqual([
				`create:${host.initialId}`,
				...failed.map((id) => `create:${id}`),
			]);
			expect(host.warnings).toEqual([`Could not restore tabs: planned restore failure: ${failed[0]}`]);
			expect(host.peerStart).toHaveBeenCalledOnce();
			expect(host.trace.indexOf(`create:${failed[1]}`)).toBeLessThan(host.trace.indexOf("peer:start"));
			const model: () => { tabs: unknown[] } = Reflect.get(host.mode, "getTabBarModel").bind(host.mode);
			expect(model().tabs).toHaveLength(1);
			expect(await host.capture()).toContain("MixCode / HOME");
			expect(tabState.readOpenTabs(host.workdir)).toMatchObject({
				kind: "ok",
				snapshot: { version: 1, sessionIds: [...failed, host.initialId] },
			});
		} finally {
			await host.dispose();
		}
	});
});
