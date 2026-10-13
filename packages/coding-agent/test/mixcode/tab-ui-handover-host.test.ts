import { fauxAssistantMessage } from "@earendil-works/pi-ai";
import { type Component, type Container, Text, type TUI } from "@earendil-works/pi-tui";
import { describe, expect, test, vi } from "vitest";
import { VirtualTerminal } from "../../../tui/test/virtual-terminal.ts";
import { AgentSessionRuntime } from "../../src/core/agent-session-runtime.ts";
import type { MixcodeTabMeta } from "../../src/core/mixcode/multi-tab/mixcode-state.ts";
import type { AgentTab, TabManager } from "../../src/core/mixcode/multi-tab/tab-manager.ts";
import type { SessionEntry } from "../../src/core/session-manager.ts";
import { HomeView, type HomeViewModel } from "../../src/modes/interactive/components/mixcode/home/home-view.ts";
import type { InlineWidgetTabState } from "../../src/modes/interactive/components/mixcode/inline-widgets/inline-widgets.ts";
import type { WidgetPanelTabState } from "../../src/modes/interactive/components/mixcode/widget-panel/widget-panel.ts";
import { InteractiveMode } from "../../src/modes/interactive/interactive-mode.ts";
import type { ExtensionUiController } from "../../src/modes/interactive/mixcode/extensions/extension-ui-controller.ts";
import { initTheme } from "../../src/modes/interactive/theme/theme.ts";
import { stripAnsi } from "../../src/utils/ansi.ts";
import { createHarness, type Harness } from "../suite/harness.ts";

function deferred(): { promise: Promise<void>; resolve(): void } {
	let resolve: () => void = () => {};
	const promise = new Promise<void>((done) => {
		resolve = done;
	});
	return { promise, resolve };
}

/** Mount a constructed InteractiveMode with real sessions, extensions and a virtual terminal. */
async function fixture() {
	initTheme("dark");
	const trace: string[] = [];
	const gates = new Map<string, ReturnType<typeof deferred>>();
	const started = new Map<string, ReturnType<typeof deferred>>();
	/** Set to make the next extension bind reject, the way a failing resource walk does. */
	let bindFailure: Error | undefined;
	const harnesses = await Promise.all(
		[0, 1, 2].map((index) =>
			createHarness({
				extensionFactories: [
					(pi) => {
						pi.on("session_start", async (_event, ctx) => {
							trace.push(`bind:${index}`);
							started.get(String(index))?.resolve();
							await gates.get(String(index))?.promise;
							ctx.ui.setWidget("owner", [`WIDGET-${index}`]);
							ctx.ui.setHiddenThinkingLabel(`LABEL-${index}`);
						});
					},
				],
			}),
		),
	);
	for (const [index, harness] of harnesses.entries()) {
		for (let turn = 0; turn < 8; turn++) {
			harness.sessionManager.appendMessage({
				role: "user",
				content: `SESSION-${index}-MESSAGE-${turn}`,
				timestamp: turn,
			});
		}
		harness.session.refreshContext();
	}
	const runtime = (harness: Harness) =>
		new AgentSessionRuntime(
			harness.session,
			{
				cwd: harness.tempDir,
				agentDir: harness.tempDir,
				modelRuntime: harness.session.modelRuntime,
				settingsManager: harness.settingsManager,
				resourceLoader: harness.session.resourceLoader,
				diagnostics: [],
			},
			async () => {
				throw new Error("Session replacement is outside this scenario");
			},
		);
	let next = 1;
	const terminal = new VirtualTerminal(100, 50);
	const mode = new InteractiveMode(runtime(harnesses[0]), {
		terminal,
		tuiMode: "regular",
		createRuntime: async () => {
			const current = runtime(harnesses[next++]);
			return {
				session: current.session,
				services: current.services,
				extensionsResult: current.session.resourceLoader.getExtensions(),
				diagnostics: [],
			};
		},
	});
	const manager = Reflect.get(mode, "tabManager") as TabManager;
	const ui = Reflect.get(mode, "ui") as TUI;
	const chat = Reflect.get(mode, "chatContainer") as Container;
	const loaded = Reflect.get(mode, "loadedResourcesContainer") as Container;
	const pending = Reflect.get(mode, "pendingMessagesContainer") as Container;
	const extensions = Reflect.get(mode, "extensionUiController") as ExtensionUiController;
	const activate: (tab: AgentTab) => Promise<void> = Reflect.get(mode, "activateTab").bind(mode);
	const bind: (tab: AgentTab) => Promise<void> = Reflect.get(mode, "bindTabExtensions").bind(mode);
	const home: () => Promise<void> = Reflect.get(mode, "activateHome").bind(mode);
	const warm: (tab: AgentTab) => void = Reflect.get(mode, "warmTabTranscript").bind(mode);
	const rebind: () => Promise<void> = Reflect.get(mode, "rebindCurrentSession").bind(mode);
	const editor = Reflect.get(mode, "defaultEditor") as { getText(): string; setText(text: string): void };
	const homeModel: () => HomeViewModel = Reflect.get(mode, "getHomeViewModel").bind(mode);
	Reflect.set(mode, "homeView", new HomeView({ getModel: homeModel, getHeight: () => 30, onAction: () => {} }));
	Reflect.set(mode, "isInitialized", true);
	for (const name of [
		"documentContainer",
		"pendingMessagesContainer",
		"statusContainer",
		"editorContainer",
		"footerContainer",
	]) {
		ui.addChild(Reflect.get(mode, name) as Container);
	}
	ui.addChild({
		render: () => {
			trace.push(`paint:${extensions.activeTabIdForUi}:${editor.getText()}`);
			return [];
		},
		invalidate() {},
	});
	ui.start();
	const originalResources = Reflect.get(mode, "showLoadedResources");
	const resources = vi.fn((options: { force?: boolean; showDiagnosticsWhenQuiet?: boolean }) => {
		expect(options).toMatchObject({ force: false, showDiagnosticsWhenQuiet: true });
		trace.push(`resources:${extensions.activeTabIdForUi}`);
		loaded.clear();
		loaded.addChild(new Text(`RESOURCES-${extensions.activeTabIdForUi}`, 0, 0));
	});
	Reflect.set(mode, "showLoadedResources", resources);
	const originalBind = Reflect.get(mode, "bindCurrentSessionExtensions") as (options: unknown) => Promise<void>;
	/** Reject the next bind for the scenario that needs a failing extension walk. */
	const failNextBind = (error: Error | undefined): void => {
		bindFailure = error;
	};
	Reflect.set(mode, "bindCurrentSessionExtensions", async (options: unknown) => {
		if (bindFailure) throw bindFailure;
		return originalBind.call(mode, options);
	});
	async function capture(): Promise<string> {
		ui.requestRender();
		await terminal.waitForRender();
		return terminal.getViewport().map(stripAnsi).join("\n");
	}
	async function dispose(): Promise<void> {
		Reflect.set(mode, "showLoadedResources", originalResources);
		Reflect.set(mode, "bindCurrentSessionExtensions", originalBind);
		mode.stop();
		await manager.dispose();
		for (const harness of harnesses) harness.cleanup();
	}
	return {
		mode,
		manager,
		ui,
		chat,
		loaded,
		pending,
		extensions,
		editor,
		activate,
		bind,
		home,
		warm,
		rebind,
		capture,
		dispose,
		trace,
		harnesses,
		gates,
		started,
		failNextBind,
	};
}

describe("InteractiveMode tab handover integration", () => {
	for (const completesInBackground of [false, true]) {
		test(`compaction survives a tab round trip (background completion: ${completesInBackground})`, async () => {
			const host = await fixture();
			const summaryGate = deferred();
			const summaryStarted = deferred();
			try {
				const a = host.manager.getActive();
				await host.rebind();
				host.mode.renderInitialMessages();
				const b = await host.manager.createTab({ title: "B" });
				await host.bind(b);
				await host.activate(a);
				const harness = host.harnesses[0];
				harness.settingsManager.applyOverrides({ compaction: { enabled: false, keepRecentTokens: 1 } });
				harness.setResponses([fauxAssistantMessage("RETAINED-ANSWER")]);
				await harness.session.prompt("LAST-TURN");
				harness.setResponses([
					async () => {
						summaryStarted.resolve();
						await summaryGate.promise;
						return fauxAssistantMessage("ROUND-TRIP-SUMMARY");
					},
					fauxAssistantMessage("RETAINED-TURN-SUMMARY"),
				]);
				const compact: (args: string) => Promise<void> = Reflect.get(host.mode, "handleCompactCommand").bind(
					host.mode,
				);
				const result = compact(`${harness.session.model!.provider}/${harness.session.model!.id}`);
				await summaryStarted.promise;
				expect(a.status).toBe("running");
				await host.activate(b);
				expect(await host.capture()).not.toContain("Compacting context");
				if (!completesInBackground) {
					await host.activate(a);
					const during = await host.capture();
					expect(during).toContain("Compacting context via");
					expect(during).toContain(`${harness.session.model!.provider}/${harness.session.model!.id}`);
				}
				summaryGate.resolve();
				await result;
				if (completesInBackground) {
					expect(await host.capture()).not.toContain("Compacted from");
					await host.activate(a);
				}
				const completed = await host.capture();
				expect(completed).not.toContain("Working");
				expect(completed).not.toContain("Compacting context");
				expect(completed).toContain("Compacted from");
				expect(a.status).toBe("idle");
				const transcript = host.chat.render(100).map(stripAnsi).join("\n");
				expect(transcript).toContain("RETAINED-ANSWER");
				expect(transcript.indexOf("Compacted from")).toBeGreaterThan(transcript.indexOf("RETAINED-ANSWER"));
				await host.activate(b);
				await host.activate(a);
				expect(
					(
						host.chat
							.render(100)
							.join("\n")
							.match(/Compacted from/g) ?? []
					).length,
				).toBe(1);
			} finally {
				summaryGate.resolve();
				await host.dispose();
			}
		});
	}

	test("a branch summary round trip does not restore a compaction indicator", async () => {
		const host = await fixture();
		const summaryGate = deferred();
		const summaryStarted = deferred();
		try {
			const a = host.manager.getActive();
			await host.rebind();
			const b = await host.manager.createTab({ title: "B" });
			await host.bind(b);
			await host.activate(a);
			const harness = host.harnesses[0];
			harness.setResponses([fauxAssistantMessage("BRANCH-ANSWER")]);
			await harness.session.prompt("BRANCH-TURN");
			const target = harness.sessionManager.getBranch().find((entry) => entry.type === "message");
			if (!target) throw new Error("Branch navigation requires a target");
			harness.setResponses([
				async () => {
					summaryStarted.resolve();
					await summaryGate.promise;
					return fauxAssistantMessage("BRANCH-SUMMARY");
				},
			]);
			const result = harness.session.navigateTree(target.id, { summarize: true });
			await summaryStarted.promise;
			await host.activate(b);
			await host.activate(a);
			const during = await host.capture();
			expect(during).toContain("Working");
			expect(during).not.toContain("Compacting context");
			summaryGate.resolve();
			await result;
			const clearSummary: (kind: "branchSummary") => void = Reflect.get(
				host.mode,
				"clearSummaryStatusIndicator",
			).bind(host.mode);
			clearSummary("branchSummary");
			expect(await host.capture()).not.toContain("Working");
			expect(Reflect.get(host.mode, "activeStatusIndicator")).toBeUndefined();
		} finally {
			summaryGate.resolve();
			await host.dispose();
		}
	});

	test("serialized A-B-A restores component identity, consumed queues, live runtime and turn markers", async () => {
		const host = await fixture();
		try {
			const a = host.manager.getActive();
			await host.rebind();
			host.mode.renderInitialMessages();
			const original = host.chat.children[0];
			const b = await host.manager.createTab({ title: "B" });
			await host.bind(b);
			host.manager.activate(a.id);
			host.editor.setText("A parked draft");
			await a.runtime.session.steer("CONSUMED-BACKGROUND-STEER");
			Reflect.set(host.mode, "runStartLeafId", "old-run");
			Reflect.set(host.mode, "runVisibleOutput", true);
			const reloadGate = deferred();
			const reload = vi
				.spyOn(b.runtime.session.settingsManager, "reload")
				.mockImplementation(() => reloadGate.promise);
			const first = host.activate(b);
			await Promise.resolve();
			expect(host.extensions.activeTabIdForUi).toBe(b.id);
			const second = host.activate(a);
			a.runtime.session.clearQueue();
			reloadGate.resolve();
			await Promise.all([first, second]);
			reload.mockRestore();
			expect(host.chat.children[0]).toBe(original);
			expect(Reflect.get(host.mode, "runtimeHost")).toBe(a.runtime);
			expect(Reflect.get(host.mode, "runStartLeafId")).toBeUndefined();
			expect(Reflect.get(host.mode, "runVisibleOutput")).toBe(false);
			expect(host.editor.getText()).toBe("A parked draft");
			expect(await host.capture()).not.toContain("CONSUMED-BACKGROUND-STEER");
			expect(host.trace.filter((step) => step === "bind:0")).toHaveLength(1);
			expect(host.trace.filter((step) => step === "bind:1")).toHaveLength(1);

			// A parked transcript whose branch moved rebuilds instead of restoring stale blocks.
			const parked = host.chat.children[0];
			await host.activate(b);
			a.runtime.session.sessionManager.appendMessage({ role: "user", content: "A-NEW-ENTRY", timestamp: 99 });
			await host.activate(a);
			expect(host.chat.children[0]).not.toBe(parked);
			expect(host.chat.render(100).map(stripAnsi).join("\n")).toContain("A-NEW-ENTRY");
		} finally {
			await host.dispose();
		}
	});

	test("paints before binding, defers background resources, and preserves the same-tab Home fastpath", async () => {
		const host = await fixture();
		const gate = deferred();
		try {
			await host.rebind();
			const a = host.manager.getActive();
			const b = await host.manager.createTab({ title: "B" });
			b.draftInput = "B first frame";
			host.gates.set("1", gate);
			const started = deferred();
			host.started.set("1", started);
			await host.activate(b);
			const bind = host.bind(b);
			await started.promise;
			expect(host.trace.indexOf(`paint:${b.id}:B first frame`)).toBeLessThan(host.trace.indexOf("bind:1"));
			await host.activate(a);
			gate.resolve();
			await bind;
			expect(host.trace).not.toContain(`resources:${b.id}`);
			await host.activate(b);
			expect(host.trace.filter((step) => step === `resources:${b.id}`)).toHaveLength(1);
			expect(await host.capture()).toContain(`RESOURCES-${b.id}`);
			expect(host.extensions.extensionWidgetsAbove.get("owner")?.render(100).map(stripAnsi).join("\n")).toContain(
				"WIDGET-1",
			);
			const original = host.chat.children[0];
			await host.home();
			expect(await host.capture()).toContain("MixCode / HOME");
			await host.activate(b);
			expect(host.chat.children[0]).toBe(original);
			expect(host.editor.getText()).toBe("B first frame");
			expect(host.trace.filter((step) => step === "bind:1")).toHaveLength(1);
		} finally {
			gate.resolve();
			await host.dispose();
		}
	});

	test("startup loader binds and warms persisted order on Home, then first focus reuses the prepared blocks", async () => {
		const host = await fixture();
		try {
			await host.rebind();
			const a = host.manager.getActive();
			await host.home();
			const warmed = new Map<string, Component>();
			const renderEntries: (entries: SessionEntry[], options?: { updateFooter?: boolean }) => void = Reflect.get(
				host.mode,
				"renderSessionEntries",
			).bind(host.mode);
			Reflect.set(
				host.mode,
				"renderSessionEntries",
				(entries: SessionEntry[], options?: { updateFooter?: boolean }) => {
					renderEntries(entries, options);
					if (options?.updateFooter === false && host.extensions.activeTabIdForUi && host.chat.children[0]) {
						warmed.set(host.extensions.activeTabIdForUi, host.chat.children[0]);
					}
				},
			);
			const load: (options: {
				entries: readonly string[];
				meta: Map<string, MixcodeTabMeta>;
				sessionDir: string;
				currentId: string;
				persistedIds: readonly string[];
				activeSessionId?: string;
				trashedDirsBySessionId: ReadonlyMap<string, ReadonlySet<string>>;
			}) => Promise<void> = Reflect.get(host.mode, "loadRestoredTabs").bind(host.mode);
			const ids = host.harnesses.slice(1).map((harness) => harness.sessionManager.getSessionId());
			const currentId = a.runtime.session.sessionManager.getSessionId();
			await load({
				entries: ids,
				meta: new Map(),
				sessionDir: host.harnesses[0].tempDir,
				currentId,
				persistedIds: [currentId, ...ids],
				activeSessionId: ids[1],
				trashedDirsBySessionId: new Map(),
			});
			expect(host.trace.filter((step) => step.startsWith("bind:"))).toEqual(["bind:0", "bind:1", "bind:2"]);
			expect(host.manager.list().every((tab) => !tab.loading)).toBe(true);
			expect(Reflect.get(host.mode, "runtimeHost")).toBe(a.runtime);
			expect(host.extensions.activeTabIdForUi).toBe(a.id);
			expect(host.manager.getActive().id).toBe(ids[1]);
			expect(await host.capture()).toContain("MixCode / HOME");
			const b = host.manager.get(ids[0]);
			if (!b) throw new Error("The restored tab must exist");
			expect(warmed.get(b.id)).toBeDefined();
			await host.activate(b);
			expect(host.chat.children[0]).toBe(warmed.get(b.id));
			expect(await host.capture()).toContain("SESSION-1-MESSAGE-7");
			expect(host.trace.filter((step) => step === "bind:1")).toHaveLength(1);
		} finally {
			await host.dispose();
		}
	});

	test("settings broadcasts and closed-tab disposal drop parked blocks while preserving bound-session identity", async () => {
		const host = await fixture();
		try {
			await host.rebind();
			const a = host.manager.getActive();
			const b = await host.manager.createTab({ title: "B" });
			await host.bind(b);
			await host.activate(b);
			const beforeSettings = host.chat.children[0];
			await host.activate(a);
			const broadcast: () => void = Reflect.get(host.mode, "broadcastSettingsChange").bind(host.mode);
			broadcast();
			await host.activate(b);
			expect(host.chat.children[0]).not.toBe(beforeSettings);
			expect(await host.capture()).toContain("SESSION-1-MESSAGE-7");
			const beforeDispose = host.chat.children[0];
			const inlineState: () => InlineWidgetTabState | undefined = Reflect.get(host.mode, "inlineWidgetState").bind(
				host.mode,
			);
			const panelState: () => WidgetPanelTabState | undefined = Reflect.get(host.mode, "widgetPanelState").bind(
				host.mode,
			);
			inlineState();
			panelState();
			await host.activate(a);
			const dispose: (tabId: string) => void = Reflect.get(host.mode, "disposeTabUi").bind(host.mode);
			dispose(b.id);
			expect(host.extensions.tabUi.has(b.id)).toBe(false);
			const inlineStates = Reflect.get(host.mode, "inlineWidgetTabStates") as Map<string, InlineWidgetTabState>;
			const panelStates = Reflect.get(host.mode, "widgetPanelTabStates") as Map<string, WidgetPanelTabState>;
			expect(inlineStates.has(b.id)).toBe(false);
			expect(panelStates.has(b.id)).toBe(false);
			await host.activate(b);
			expect(host.chat.children[0]).not.toBe(beforeDispose);
			expect(await host.capture()).toContain("SESSION-1-MESSAGE-7");
			expect(host.trace.filter((step) => step === "bind:1")).toHaveLength(1);
		} finally {
			await host.dispose();
		}
	});

	test("Home warming restores identity on failure and streaming focus rebuilds live output", async () => {
		const host = await fixture();
		try {
			await host.rebind();
			const a = host.manager.getActive();
			const b = await host.manager.createTab({ title: "B" });
			await host.bind(b);
			await host.home();
			const render = vi.spyOn(b.runtime.session.sessionManager, "buildContextEntries").mockImplementationOnce(() => {
				throw new Error("planned warm failure");
			});
			host.warm(b);
			expect(Reflect.get(host.mode, "runtimeHost")).toBe(a.runtime);
			expect(host.extensions.activeTabIdForUi).toBe(a.id);
			render.mockRestore();
			host.chat.clear();
			host.warm(b);
			await host.activate(b);
			expect(await host.capture()).toContain("SESSION-1-MESSAGE-7");
			await host.activate(a);
			const message = fauxAssistantMessage("STREAMING-B-LIVE");
			const agentState = vi.spyOn(b.runtime.session.agent, "state", "get").mockReturnValue({
				...b.runtime.session.agent.state,
				streamingMessage: message,
			});
			const streaming = vi.spyOn(b.runtime.session, "isStreaming", "get").mockReturnValue(true);
			await host.activate(b);
			expect(Reflect.get(host.mode, "streamingMessage")).toBe(message);
			expect(await host.capture()).toContain("STREAMING-B-LIVE");
			streaming.mockRestore();
			agentState.mockRestore();
		} finally {
			await host.dispose();
		}
	});

	test("a failed bind leaves its tab retryable and the switch queue recovers", async () => {
		const host = await fixture();
		try {
			await host.rebind();
			const a = host.manager.getActive();
			const b = await host.manager.createTab({ title: "B" });
			host.failNextBind(new Error("planned bind failure"));
			await host.bind(b);
			expect(host.trace).not.toContain("bind:1");
			expect(b.status).toBe("error");
			expect(b.loading).toBe(false);
			expect(host.trace.filter((step) => step === `resources:${b.id}`)).toHaveLength(0);

			host.failNextBind(undefined);
			await host.activate(a);
			await host.activate(b);
			await host.bind(b);
			expect(host.trace.filter((step) => step === "bind:1")).toHaveLength(1);
			expect(host.extensions.activeTabIdForUi).toBe(b.id);
			expect(await host.capture()).toContain(`RESOURCES-${b.id}`);
			expect(b.loading).toBe(false);
		} finally {
			await host.dispose();
		}
	});

	test("reports compaction history on a tab's first view and keeps it off a return", async () => {
		const host = await fixture();
		try {
			const a = host.manager.getActive();
			a.runtime.session.sessionManager.appendCompaction("HISTORICAL-SUMMARY", null, 35000);
			await host.rebind();
			host.mode.renderInitialMessages();
			expect(await host.capture()).toContain("Session compacted 1 time");

			// A status printed after the notice appends below it instead of replacing it.
			const showStatus: (message: string) => void = Reflect.get(host.mode, "showStatus").bind(host.mode);
			showStatus("STATUS-AFTER-NOTICE");
			const afterStatus = await host.capture();
			expect(afterStatus).toContain("STATUS-AFTER-NOTICE");
			expect(afterStatus).toContain("Session compacted 1 time");

			const b = await host.manager.createTab({ title: "B" });
			await host.bind(b);
			await host.activate(b);
			await host.activate(a);
			const returned = await host.capture();
			expect(host.chat.children.length).toBeGreaterThan(0);
			expect(returned).not.toContain("Session compacted");
		} finally {
			await host.dispose();
		}
	});
});
