import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AgentSession } from "../../src/core/agent-session.ts";
import type { ExtensionUIContext } from "../../src/core/extensions/index.ts";
import {
	type BatchLifecyclePort,
	type BatchLifecycleTab,
	createBatchTab,
} from "../../src/core/mixcode/batch/batch-lifecycle.ts";
import type { AgentTab } from "../../src/core/mixcode/multi-tab/tab-manager.ts";
import {
	type BatchCommandHost,
	enqueueBatchPrompts,
	followUpStateFor,
	runOwnerLocalCommand,
} from "../../src/modes/interactive/mixcode/batch/batch-command.ts";
import { createHarness, type Harness } from "../suite/harness.ts";
import { createTabClient } from "./helpers/tab-runtime.ts";

let root: string;
let workdir: string;
let sessionDir: string;
let harness: Harness;
const clients: Awaited<ReturnType<typeof createTabClient>>[] = [];

interface Setup {
	client: Awaited<ReturnType<typeof createTabClient>>;
	events: string[];
	widgetLogs: Map<string, string[]>;
	bound: Set<AgentSession>;
	bindCounts: Map<string, number>;
}

function createSetup(client: Awaited<ReturnType<typeof createTabClient>>): Setup {
	return {
		client,
		events: [],
		widgetLogs: new Map(),
		bound: new Set(),
		bindCounts: new Map(),
	};
}

/** UI stub whose setWidget rows land in the tab's own log. */
function createWidgetUi(setup: Setup, tab: BatchLifecycleTab): ExtensionUIContext {
	const rows: string[] = [];
	setup.widgetLogs.set(tab.id, rows);
	return {
		setWidget: (key: string, content: string[] | undefined) => {
			if (Array.isArray(content)) rows.push(...content);
			else rows.push(`<cleared:${key}>`);
		},
		notify: () => {},
		setStatus: () => {},
	} as unknown as ExtensionUIContext;
}

function createPort(setup: Setup, bindDelayMs = 10): BatchLifecyclePort<AgentTab> {
	const { client, events } = setup;
	return {
		createRawTab: async (request) => {
			events.push(`create:${request.name}`);
			return client.manager.createTab({ title: request.name, workdir: request.workdir });
		},
		configureTab: async (tab) => {
			events.push(`configure:${tab.title}`);
		},
		bindExtensions: async (tab) => {
			const count = (setup.bindCounts.get(tab.id) ?? 0) + 1;
			setup.bindCounts.set(tab.id, count);
			events.push(`bind:start:${tab.title}`);
			if (bindDelayMs > 0) await new Promise((resolve) => setTimeout(resolve, bindDelayMs));
			await tab.runtime.session.bindExtensions({
				uiContext: createWidgetUi(setup, tab),
				mode: "tui",
			});
			// The real bind is a background queue; a session is bound only once it settled.
			setup.bound.add(tab.runtime.session);
			events.push(`bind:end:${tab.title}`);
		},
		isExtensionsBound: (tab) => setup.bound.has(tab.runtime.session),
		persistSessionName: (tab, name) => {
			events.push(`name:${name}`);
			tab.runtime.session.setSessionName(name);
		},
		lockTitle: (_tab, name) => {
			events.push(`lock:${name}`);
		},
		showTab: async (tab) => {
			events.push(`show:${tab.title}`);
			await client.host.enqueueTabSwitch(() => client.switchActiveTab(tab));
		},
	};
}

beforeEach(async () => {
	root = mkdtempSync(join(tmpdir(), "pi-batch-lifecycle-"));
	workdir = join(root, "project");
	sessionDir = join(root, "sessions");
	mkdirSync(workdir);
	harness = await createHarness({
		extensionFactories: [
			(pi) => {
				pi.on("session_start", (_event, ctx) => {
					ctx.ui.setWidget("probe-widget", ["session_start-widget"]);
				});
				pi.registerCommand("probe", {
					handler: async (args, ctx) => {
						ctx.ui.setWidget("probe-widget", [`probe:${args}`]);
					},
				});
			},
		],
	});
});

afterEach(async () => {
	for (const client of clients.splice(0)) {
		client.shared.dispose();
		await client.manager.dispose();
	}
	harness?.cleanup();
	rmSync(root, { recursive: true, force: true });
});

async function client(): Promise<Awaited<ReturnType<typeof createTabClient>>> {
	const result = await createTabClient({ harness, workdir, sessionDir, agentDir: join(root, "agent") });
	clients.push(result);
	return result;
}

describe("batch tab lifecycle", () => {
	it("configures before binding, names after a successful bind, and shows the tab", async () => {
		const setup = createSetup(await client());
		const port = createPort(setup);
		const tab = await createBatchTab(port, { name: "Alpha" }, {});

		expect(setup.events).toEqual([
			"create:Alpha",
			"configure:Alpha",
			"bind:start:Alpha",
			"bind:end:Alpha",
			"name:Alpha",
			"lock:Alpha",
			"show:Alpha",
		]);
		expect(tab.runtime.session.sessionManager.getSessionName()).toBe("Alpha");
		expect(setup.client.manager.getActive().id).toBe(tab.id);
		expect(setup.client.displayedTabId).toBe(tab.id);
		// The extension's session_start ran during the bind, so its widget is present.
		expect(setup.widgetLogs.get(tab.id)).toEqual(["session_start-widget"]);
	});

	it("keeps each tab's extensions bound across a focus change between delayed creates", async () => {
		const setup = createSetup(await client());
		const port = createPort(setup, 15);
		const first = await createBatchTab(port, { name: "First" }, {});
		const firstSession = first.runtime.session;
		// Move focus away before the second tab binds; its bind must not touch the first.
		setup.client.manager.activate(first.id);
		const second = await createBatchTab(port, { name: "Second" }, {});

		expect(setup.bound.has(firstSession)).toBe(true);
		expect(setup.bound.has(second.runtime.session)).toBe(true);
		expect(setup.client.manager.getActive().id).toBe(second.id);
		expect(setup.client.displayedTabId).toBe(second.id);
		expect(setup.bindCounts.get(first.id)).toBe(1);
		expect(setup.widgetLogs.get(first.id)).toEqual(["session_start-widget"]);
		expect(setup.widgetLogs.get(second.id)).toEqual(["session_start-widget"]);
	});

	it("aborts before naming and showing when the extension bind fails", async () => {
		const setup = createSetup(await client());
		const port = createPort(setup);
		port.bindExtensions = async (tab) => {
			setup.events.push(`bind:start:${tab.title}`);
			setup.bound.delete(tab.runtime.session);
			setup.events.push(`bind:end:${tab.title}`);
		};
		await expect(createBatchTab(port, { name: "Broken" }, {})).rejects.toThrow(/failed to initialize extensions/);
		expect(setup.events).toContain("configure:Broken");
		expect(setup.events).not.toContain("name:Broken");
		expect(setup.events).not.toContain("show:Broken");
	});
});

/** A `BatchCommandHost` over a real tab runtime, with widget-recording binds. */
function createBatchHost(setup: Setup): BatchCommandHost {
	const { client } = setup;
	return {
		tabManager: client.manager,
		homeActive: false,
		homeWorkdir: workdir,
		followUpStates: new Map(),
		boundSessions: setup.bound,
		compactionClaimed: false,
		bindTabExtensions: async (tab) => {
			setup.bindCounts.set(tab.id, (setup.bindCounts.get(tab.id) ?? 0) + 1);
			await tab.runtime.session.bindExtensions({ uiContext: createWidgetUi(setup, tab), mode: "tui" });
			setup.bound.add(tab.runtime.session);
		},
		showTab: (tab) => client.host.enqueueTabSwitch(() => client.switchActiveTab(tab)),
		withTabConsole: (_tab, run) => run(),
		requestRender: () => {},
		showError: (message) => {
			setup.events.push(`error:${message}`);
		},
		showStatus: () => {},
	};
}

describe("batch commands on a live tab fleet", () => {
	it("binds on demand and runs a plugin command in the owner tab while another tab is focused", async () => {
		const setup = createSetup(await client());
		const manager = setup.client.manager;
		const host = createBatchHost(setup);
		const owner = await manager.createTab({ title: "Owner" });
		const other = await manager.createTab({ title: "Other" });
		// Bind both tabs so a wrong-tab dispatch is observable, then focus the other tab.
		await host.bindTabExtensions(owner);
		await host.bindTabExtensions(other);
		manager.activate(other.id);
		await setup.client.host.enqueueTabSwitch(() => setup.client.switchActiveTab(other));

		await enqueueBatchPrompts(host, owner, ["/probe via-mode"]);
		await followUpStateFor(host, owner.id).followUpDrain;

		expect(setup.events.filter((event) => event.startsWith("error:"))).toEqual([]);
		expect(setup.widgetLogs.get(owner.id)).toEqual(["session_start-widget", "probe:via-mode"]);
		expect(setup.widgetLogs.get(other.id)).toEqual(["session_start-widget"]);
		// Owner dispatch never steals visible focus.
		expect(manager.getActive().id).toBe(other.id);
		expect(setup.client.displayedTabId).toBe(other.id);
	});

	it("reports a local command the adapter cannot run on a background tab", async () => {
		const setup = createSetup(await client());
		const host = createBatchHost(setup);
		const tab = await setup.client.manager.createTab({ title: "Owner" });
		await host.bindTabExtensions(tab);

		await expect(runOwnerLocalCommand(host, tab, "/settings")).rejects.toThrow(
			/not supported on a background batch tab/,
		);
	});
});
