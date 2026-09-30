import { type Component, Container, type ScrollView, Text, type TuiAltScreen } from "@earendil-works/pi-tui";
import { beforeEach, describe, expect, it } from "vitest";
import { VirtualTerminal } from "../../../tui/test/virtual-terminal.ts";
import type { MixCodeSettings } from "../../src/core/mixcode/mixcode-settings.ts";
import { createChatViewport } from "../../src/modes/interactive/chat-viewport.ts";
import { DockWidgetBudget } from "../../src/modes/interactive/components/mixcode/dock-widgets/dock-widgets.ts";
import {
	createInlineWidgetTabState,
	InlineWidgetsComponent,
	type InlineWidgetTabState,
	inlineTailBudget,
} from "../../src/modes/interactive/components/mixcode/inline-widgets/inline-widgets.ts";
import { WindowedTranscript } from "../../src/modes/interactive/components/mixcode/windowed-chat/windowed-transcript.ts";
import { createInteractiveTui, InteractiveMode } from "../../src/modes/interactive/interactive-mode.ts";
import { initTheme } from "../../src/modes/interactive/theme/theme.ts";
import { stripAnsi } from "../../src/utils/ansi.ts";
import { WidgetBody } from "./test-utils.ts";

/** Tab id the inline wiring falls back to when there is no tab manager. */
const SESSION_KEY = "session";

/** A widget stand-in whose body is given verbatim, with no line splitting. */
class MultiLineBody implements Component {
	private readonly lines: string[];

	constructor(_key: string, lines: string[]) {
		this.lines = lines;
	}

	render(_width: number): string[] {
		return this.lines;
	}

	invalidate(): void {}
}

/**
 * The private inline-widget wiring of `InteractiveMode`, driven against a stub
 * `this` that carries the live widget maps, the real dock containers and the
 * per-tab state. The real methods run, so the dock/tail switch and the
 * `/widgets` state machine are the ones under test.
 */
type InlineWiringContext = {
	widgetContainerAbove: Container;
	widgetContainerBelow: Container;
	extensionWidgetsAbove: Map<string, Component>;
	extensionWidgetsBelow: Map<string, Component>;
	tabManager: undefined;
	activeTabIdForUi: string | undefined;
	inlineWidgetTabStates: Map<string, InlineWidgetTabState>;
	mixcodeSettings: MixCodeSettings;
	transcriptScrollView: ScrollView | undefined;
	renderer: { terminal: { rows: number } };
	windowedTranscript: WindowedTranscript | undefined;
	ui: { mode: string; requestRender: () => void };
	showError: (message: string) => void;
	showWarning: (message: string) => void;
	inlineWidgetState(this: InlineWiringContext): InlineWidgetTabState | undefined;
	requestWidgetRender(this: InlineWiringContext): void;
	renderWidgetContainer(
		this: InlineWiringContext,
		container: Container,
		widgets: Map<string, Component>,
		spacerWhenEmpty: boolean,
		leadingSpacer: boolean,
	): void;
	refreshInlineWidgets(this: InlineWiringContext): void;
	handleToggleInlineWidgets(this: InlineWiringContext): void;
	getWidgetKeys(this: InlineWiringContext): string[];
	handleWidgetsCommand(this: InlineWiringContext, args: string): void;
	inlineViewportRows(this: InlineWiringContext): number | undefined;
	buildDocumentChildren(this: InlineWiringContext): void;
	leaveHome(this: InlineWiringContext): void;
};
const proto = InteractiveMode.prototype as unknown as InlineWiringContext;

beforeEach(() => {
	initTheme("dark");
});

type WidgetSpec = { key: string; rows: number; placement?: "above" | "below" };

/**
 * A fullscreen frame built the way the running app builds it: the real chat
 * viewport (transcript scroll view + dock), the real windowed transcript, and
 * the real inline component as the transcript's last block.
 */
async function bootInline(options: {
	columns?: number;
	rows?: number;
	widgets?: WidgetSpec[];
	enabled?: boolean;
	messages?: number;
}) {
	const columns = options.columns ?? 60;
	const rows = options.rows ?? 20;
	const above = new Map<string, Component>();
	const below = new Map<string, Component>();
	const bodies = new Map<string, WidgetBody>();
	for (const widget of options.widgets ?? []) {
		const body = WidgetBody.keyed(widget.key, widget.rows);
		bodies.set(widget.key, body);
		(widget.placement === "below" ? below : above).set(widget.key, body);
	}

	const chatBlocks: Component[] = [];
	for (let index = 1; index <= (options.messages ?? 2); index += 1) {
		chatBlocks.push(new Text(`message-${index}`, 0, 0));
	}

	const terminal = new VirtualTerminal(columns, rows);
	const tui = createInteractiveTui({
		tuiMode: "fullscreen",
		showHardwareCursor: false,
		logDirectory: "/tmp",
		terminal,
	}) as TuiAltScreen;

	const state = createInlineWidgetTabState(options.enabled ?? true);
	const errors: string[] = [];
	const context = {} as InlineWiringContext;
	const inlineWidgets = new InlineWidgetsComponent({
		widgets: () => ({ above, below }),
		state: () => context.inlineWidgetState(),
		viewportRows: () => context.inlineViewportRows(),
	});
	const blocks = [...chatBlocks, inlineWidgets];
	const document = new WindowedTranscript({ blocks: () => blocks });
	// The dock side of the same widgets: the budget decides what the two slots show.
	const dockWidgets = new DockWidgetBudget({
		widgets: () => ({ above, below }),
		chromeRows: () => 0,
		viewportRows: () => rows,
		widgetsHidden: () => context.inlineWidgetState()?.enabled === true,
	});

	Object.assign(context, {
		extensionWidgetsAbove: above,
		extensionWidgetsBelow: below,
		tabManager: undefined,
		activeTabIdForUi: undefined,
		inlineWidgetTabStates: new Map([[SESSION_KEY, state]]),
		mixcodeSettings: { ui: { inlineWidgets: options.enabled ?? true, boxedHiddenThinking: true } },
		transcriptScrollView: undefined,
		renderer: { terminal: { rows } },
		windowedTranscript: document,
		ui: { mode: "fullscreen", requestRender: () => tui.requestRender() },
		showError: (message: string) => errors.push(message),
		showWarning: (message: string) => errors.push(message),
	} satisfies Partial<InlineWiringContext>);
	context.inlineWidgetState = () => proto.inlineWidgetState.call(context);
	context.requestWidgetRender = () => proto.requestWidgetRender.call(context);
	context.refreshInlineWidgets = () => proto.refreshInlineWidgets.call(context);
	context.handleToggleInlineWidgets = () => proto.handleToggleInlineWidgets.call(context);
	context.getWidgetKeys = () => proto.getWidgetKeys.call(context);
	context.handleWidgetsCommand = (args) => proto.handleWidgetsCommand.call(context, args);
	context.inlineViewportRows = () => proto.inlineViewportRows.call(context);

	const viewport = createChatViewport({
		document,
		pendingMessages: new Text("queue", 0, 0),
		status: new Text("status", 0, 0),
		widgetsAbove: dockWidgets.above,
		widgetsBelow: dockWidgets.below,
		editor: new Text("editor", 0, 0),
		footer: new Text("footer", 0, 0),
	});
	// The component reads the viewport of the scroll view the frame really uses.
	context.transcriptScrollView = viewport.transcript;
	context.requestWidgetRender();
	tui.setLayoutRoot(viewport.root);
	tui.start();
	await terminal.waitForRender();

	const painted = async (): Promise<string[]> => {
		tui.requestRender();
		await terminal.waitForRender();
		return terminal.getViewport().map((line) => stripAnsi(line).trimEnd());
	};
	return {
		state,
		bodies,
		errors,
		transcript: viewport.transcript,
		dockWidgets,
		handleToggleInlineWidgets: () => context.handleToggleInlineWidgets(),
		handleWidgetsCommand: (args: string) => context.handleWidgetsCommand(args),
		painted,
	};
}

/** Bodies sized so the whole two-widget block fills the budget exactly. */
function fittingRows(budget: number): number {
	return Math.floor((budget - 3) / 2);
}

describe("inline widgets in the chat tail", () => {
	it("paints widgets after the messages and before the queue, and empties the dock slots", async () => {
		const frame = await bootInline({ widgets: [{ key: "goal", rows: 2 }] });
		const lines = await frame.painted();

		const header = lines.findIndex((line) => line.includes("▸ Inline · goal"));
		const body = lines.findIndex((line) => line.includes("goal-body-0"));
		const queue = lines.indexOf("queue");
		expect(header).toBeGreaterThanOrEqual(0);
		expect(body).toBe(header + 1);
		expect(queue).toBeGreaterThan(body);
		expect(lines.indexOf("message-2")).toBeLessThan(header);
		// The dock slots give their rows back to the chat in inline mode.
		expect(frame.dockWidgets.above.render(60)).toEqual([]);
		expect(frame.dockWidgets.below.render(60)).toEqual([]);
	});

	it("restores the docked widgets when the tab leaves inline mode", async () => {
		const frame = await bootInline({ widgets: [{ key: "goal", rows: 2 }], enabled: false });
		const lines = await frame.painted();

		expect(lines.some((line) => line.includes("▸ Inline"))).toBe(false);
		expect(lines.some((line) => line.includes("goal-body-1"))).toBe(true);
		// Above-editor widgets keep their leading spacer; below-editor ones do not.
		expect(frame.dockWidgets.above.render(60).map(stripAnsi)).toEqual(["", "goal-body-0", "goal-body-1"]);
		expect(frame.dockWidgets.below.render(60)).toEqual([]);
	});

	it("switches a tab between the tail and the dock with /toggle-inline-widgets", async () => {
		const frame = await bootInline({ widgets: [{ key: "goal", rows: 1 }] });
		expect((await frame.painted()).some((line) => line.includes("▸ Inline · goal"))).toBe(true);

		frame.handleToggleInlineWidgets();
		expect(frame.state.enabled).toBe(false);
		expect(frame.dockWidgets.above.render(60)).toHaveLength(2);

		frame.handleToggleInlineWidgets();
		expect(frame.state.enabled).toBe(true);
		expect((await frame.painted()).some((line) => line.includes("▸ Inline · goal"))).toBe(true);
		expect(frame.dockWidgets.above.render(60)).toEqual([]);
	});

	it("orders above-editor widgets before below-editor ones", async () => {
		const frame = await bootInline({
			widgets: [
				{ key: "upper", rows: 1 },
				{ key: "lower", rows: 1, placement: "below" },
			],
		});
		const lines = await frame.painted();

		expect(lines.findIndex((line) => line.includes("upper-body-0"))).toBeLessThan(
			lines.findIndex((line) => line.includes("lower-body-0")),
		);
	});

	it("skips a widget with no rows entirely", async () => {
		const frame = await bootInline({
			widgets: [
				{ key: "empty", rows: 0 },
				{ key: "goal", rows: 1 },
			],
		});
		const lines = await frame.painted();

		expect(lines.some((line) => line.includes("empty"))).toBe(false);
		expect(lines.some((line) => line.includes("▸ Inline · goal"))).toBe(true);
	});

	it("stacks collapsed headers densely, without a blank row between them", async () => {
		const budget = inlineTailBudget(14);
		// No body fits the budget, so both widgets collapse to their headers.
		const frame = await bootInline({
			widgets: [
				{ key: "a", rows: budget },
				{ key: "b", rows: budget },
			],
		});
		const lines = await frame.painted();
		const headers = lines.filter((line) => line.includes("▸ Inline ·"));

		expect(headers).toHaveLength(2);
		expect(lines.indexOf(headers[1] as string)).toBe(lines.indexOf(headers[0] as string) + 1);
		expect(lines.some((line) => /-body-/.test(line))).toBe(false);
	});
});

describe("inline widget row budget", () => {
	it("keeps both bodies when the block fills the budget exactly", async () => {
		const frame = await bootInline({ widgets: [] });
		const budget = inlineTailBudget(frame.transcript.viewportHeight);
		const rows = fittingRows(budget);
		const sized = await bootInline({
			widgets: [
				{ key: "a", rows },
				{ key: "b", rows },
			],
		});
		const lines = await sized.painted();

		expect(budget).toBe(9);
		expect(rows).toBe(3);
		expect(lines.filter((line) => /-body-/.test(line))).toHaveLength(rows * 2);
		expect(lines.some((line) => line.includes("(auto)"))).toBe(false);
	});

	it("collapses the overflow to whole widgets and marks the auto ones", async () => {
		const budget = inlineTailBudget(14);
		const rows = fittingRows(budget) + 1;
		const frame = await bootInline({
			widgets: [
				{ key: "a", rows },
				{ key: "b", rows },
			],
		});
		const lines = await frame.painted();

		// The most recently registered widget keeps its body; the older one collapses.
		expect(lines.filter((line) => /a-body-/.test(line))).toHaveLength(0);
		expect(lines.filter((line) => /b-body-/.test(line))).toHaveLength(rows);
		expect(lines.some((line) => line.includes("▸ Inline · a"))).toBe(true);
		expect(lines.some((line) => line.includes("(auto) /widgets expand a"))).toBe(true);
	});

	it("never renders a body partially", async () => {
		const frame = await bootInline({ widgets: [{ key: "tall", rows: 30 }] });
		const lines = await frame.painted();

		expect(lines.filter((line) => /tall-body-/.test(line))).toHaveLength(0);
		expect(lines.some((line) => line.includes("▸ Inline · tall"))).toBe(true);
	});

	it("degrades to one summary row when even the headers do not fit", async () => {
		const widgets = Array.from({ length: 40 }, (_, index) => ({ key: `w${index}`, rows: 1 }));
		const frame = await bootInline({ widgets });
		const lines = await frame.painted();
		const inline = lines.filter((line) => line.includes("▸ Inline"));

		expect(inline).toHaveLength(1);
		expect(inline[0]).toContain("40 widgets");
		expect(inline[0]).toContain("/widgets expand");
	});

	it("shortens the summary row's command on a narrow column", () => {
		const state = createInlineWidgetTabState(true);
		const above = new Map<string, Component>();
		for (let index = 0; index < 40; index += 1) {
			above.set(`w${index}`, WidgetBody.keyed(`w${index}`, 1));
		}
		const component = new InlineWidgetsComponent({
			widgets: () => ({ above, below: new Map() }),
			state: () => state,
			viewportRows: () => 14,
		});
		const summaryAt = (width: number) => component.render(width).map(stripAnsi)[0] ?? "";

		expect(summaryAt(60)).toContain("▸ Inline · 40 widgets · /widgets expand");
		expect(summaryAt(30)).toContain("/widgets expand");
		const narrow = summaryAt(18);
		expect(narrow).toContain("/widgets");
		expect(narrow).not.toContain("expand");
	});

	it("renders each widget body once per frame", async () => {
		const frame = await bootInline({
			widgets: [
				{ key: "a", rows: 1 },
				{ key: "b", rows: 1 },
			],
		});
		for (const body of frame.bodies.values()) body.renders = 0;
		await frame.painted();

		for (const body of frame.bodies.values()) expect(body.renders).toBe(1);
	});
});

describe("/widgets", () => {
	it("expands a widget, then hands a bare toggle back to the row budget", async () => {
		const frame = await bootInline({ widgets: [{ key: "goal", rows: 2 }] });

		frame.handleWidgetsCommand("collapse goal");
		expect(frame.state.collapsed.get("goal")).toBe(true);
		expect((await frame.painted()).some((line) => line.includes("goal-body-0"))).toBe(false);

		frame.handleWidgetsCommand("expand goal");
		expect(frame.state.collapsed.get("goal")).toBe(false);
		expect((await frame.painted()).some((line) => line.includes("goal-body-0"))).toBe(true);

		// The bare toggle collapses by handing the widget back to the budget: the
		// manual entry goes away instead of pinning a collapse the budget cannot undo.
		frame.handleWidgetsCommand("");
		expect(frame.state.collapsed.has("goal")).toBe(false);
		expect((await frame.painted()).some((line) => line.includes("goal-body-0"))).toBe(true);
	});

	it("keeps a manually expanded widget whole when it overflows the budget", async () => {
		const frame = await bootInline({ widgets: [{ key: "tall", rows: 12 }] });

		frame.handleWidgetsCommand("expand tall");
		const lines = await frame.painted();
		expect(lines.filter((line) => /tall-body-/.test(line))).toHaveLength(12);
		expect(lines.some((line) => line.includes("(auto)"))).toBe(false);
	});

	it("reports an unknown widget and an empty tab", async () => {
		const frame = await bootInline({ widgets: [{ key: "goal", rows: 1 }] });
		frame.handleWidgetsCommand("expand missing");
		expect(frame.errors).toEqual(["Unknown widget: missing"]);

		const empty = await bootInline({});
		empty.handleWidgetsCommand("");
		expect(empty.errors).toEqual(["No widgets in this tab"]);
	});
});

describe("inline widget budget decisions", () => {
	function twoWidgetComponent(state: InlineWidgetTabState) {
		const a = WidgetBody.keyed("a", 5);
		const b = WidgetBody.keyed("b", 3);
		const above = new Map<string, Component>([
			["a", a],
			["b", b],
		]);
		const component = new InlineWidgetsComponent({
			widgets: () => ({ above, below: new Map() }),
			state: () => state,
			viewportRows: () => 14,
		});
		return { a, b, component, render: () => component.render(40).map(stripAnsi) };
	}

	it("holds collapsed widgets across a one-row move, then recomputes", () => {
		const { a, b, render } = twoWidgetComponent(createInlineWidgetTabState(true));

		// 11 rows over a 9-row budget: the newest widget keeps its body, `a` collapses.
		const first = render();
		expect(first.some((line) => line.includes("a-body-0"))).toBe(false);
		expect(first.some((line) => line.includes("b-body-2"))).toBe(true);

		// One row smaller: inside the deadband, so `a` stays collapsed.
		a.setRowCount(3);
		expect(render().some((line) => line.includes("a-body-0"))).toBe(false);

		// A larger move recomputes, and the whole block now fits the budget.
		a.setRowCount(1);
		b.setRowCount(1);
		const recovered = render();
		expect(recovered.some((line) => line.includes("a-body-0"))).toBe(true);
		expect(recovered.some((line) => line.includes("b-body-0"))).toBe(true);
	});

	it("keeps a held decision for one frame before re-expanding", () => {
		const { a, render } = twoWidgetComponent(createInlineWidgetTabState(true));

		expect(render().some((line) => line.includes("a-body-0"))).toBe(false);

		// Exactly at the budget, two rows under the held height: one fitting frame
		// holds, so a one-row dip cannot flip the block back and forth.
		a.setRowCount(3);
		expect(render().some((line) => line.includes("a-body-0"))).toBe(false);

		// The second fitting frame releases the held decisions.
		expect(render().some((line) => line.includes("a-body-0"))).toBe(true);
	});

	it("applies only manual state without a viewport and leaves the automatic set alone", () => {
		const state = createInlineWidgetTabState(true);
		const above = new Map<string, Component>([["a", WidgetBody.keyed("a", 20)]]);
		const component = new InlineWidgetsComponent({
			widgets: () => ({ above, below: new Map() }),
			state: () => state,
			viewportRows: () => undefined,
		});

		state.collapsed.set("a", true);
		expect(
			component
				.render(40)
				.map(stripAnsi)
				.filter((line) => line.includes("a-body-")).length,
		).toBe(0);

		state.collapsed.set("a", false);
		expect(
			component
				.render(40)
				.map(stripAnsi)
				.filter((line) => line.includes("a-body-")).length,
		).toBe(20);
		expect(state.autoCollapsed.size).toBe(0);
	});

	it("hides a narrow collapsed header's hint piece by piece", () => {
		const state = createInlineWidgetTabState(true);
		const above = new Map<string, Component>([["goal", WidgetBody.keyed("goal", 20)]]);
		const component = new InlineWidgetsComponent({
			widgets: () => ({ above, below: new Map() }),
			state: () => state,
			viewportRows: () => 14,
		});
		const headerAt = (width: number) => component.render(width).map(stripAnsi)[0] ?? "";

		expect(headerAt(60)).toContain("(auto) /widgets expand goal");
		const withoutMarker = headerAt(38);
		expect(withoutMarker).toContain("/widgets expand goal");
		expect(withoutMarker).not.toContain("(auto)");
		const withoutKey = headerAt(33);
		expect(withoutKey).toContain("/widgets expand");
		expect(withoutKey).not.toContain("goal");
		expect(headerAt(27)).toContain("/widgets");
		expect(headerAt(20)).not.toContain("/widgets");
	});

	it("drops the commands from a header that is too narrow for any of them", () => {
		const state = createInlineWidgetTabState(true);
		const above = new Map<string, Component>([["goal", WidgetBody.keyed("goal", 20)]]);
		const component = new InlineWidgetsComponent({
			widgets: () => ({ above, below: new Map() }),
			state: () => state,
			viewportRows: () => 14,
		});

		expect(component.render(20).map(stripAnsi)[0]).toContain("▸ Inline");
	});

	it("keeps a key's colour and line breaks out of the header row", () => {
		const state = createInlineWidgetTabState(true);
		const above = new Map<string, Component>([
			["ev\u001b[31mil\u001b[2J\u001b[3;40H\nsecond", WidgetBody.keyed("goal", 20)],
		]);
		const component = new InlineWidgetsComponent({
			widgets: () => ({ above, below: new Map() }),
			state: () => state,
			viewportRows: () => 14,
		});

		const lines = component.render(60);
		// A line break in the key would otherwise split the header across two rows.
		expect(lines).toHaveLength(1);
		const header = stripAnsi(lines[0] as string);
		expect(header).toContain("▸ Inline · evil");
		expect(header).toContain("(auto) /widgets expand evil second");
		expect(lines[0]).not.toContain("\u001b[2J");
		expect(lines[0]).not.toContain("\u001b[3;40H");
	});

	it("keeps a body line on one row when the widget embeds a line break", () => {
		const state = createInlineWidgetTabState(true);
		const above = new Map<string, Component>([["goal", new MultiLineBody("goal", ["first\nsecond"])]]);
		const component = new InlineWidgetsComponent({
			widgets: () => ({ above, below: new Map() }),
			state: () => state,
			viewportRows: () => 14,
		});

		const lines = component.render(60).map(stripAnsi);
		expect(lines).toHaveLength(2);
		expect(lines[1]).toBe(" first second");
	});

	it("keeps a body's colours but drops the escapes that would move the cursor", () => {
		const state = createInlineWidgetTabState(true);
		const above = new Map<string, Component>([
			["goal", new MultiLineBody("goal", ["\u001b[31mred\u001b[0m \u001b[2J\u001b[5;5Hgone"])],
		]);
		const component = new InlineWidgetsComponent({
			widgets: () => ({ above, below: new Map() }),
			state: () => state,
			viewportRows: () => 14,
		});

		const lines = component.render(60);
		expect(lines).toHaveLength(2);
		expect(lines[1]).toContain("\u001b[31mred\u001b[0m");
		expect(lines[1]).not.toContain("\u001b[2J");
		expect(lines[1]).not.toContain("\u001b[5;5H");
	});
});

describe("inline widget tab state", () => {
	it("is the document's last child again after MixCode Home gives the transcript back", () => {
		const header = new Container();
		const loaded = new Container();
		const chat = new Container();
		const inlineWidgets = new Container();
		const documentContainer = new Container();
		// Home replaces the document's children while it owns the surface.
		documentContainer.addChild(new Container());
		const context = {
			homeSelection: { active: true },
			homeView: { resetCapture: () => {} },
			setEditorText: () => {},
			updateEditorBorderColor: () => {},
			restoreFooterAfterHome: () => {},
			restoreStatusAfterHome: () => {},
			requestWidgetRender: () => {},
			documentContainer,
			headerContainer: header,
			loadedResourcesContainer: loaded,
			chatContainer: chat,
			inlineWidgets,
			windowedTranscript: { invalidate: () => {} },
		} as unknown as InlineWiringContext;
		context.buildDocumentChildren = () => proto.buildDocumentChildren.call(context);

		proto.leaveHome.call(context);

		// The transcript's blocks are this container's children, so the block has to be
		// back, and last, or the tail stops rendering after a visit to Home.
		expect(documentContainer.children).toEqual([header, loaded, chat, inlineWidgets]);
	});

	it("creates a tab's mode from the global default and reuses it", () => {
		const context = {
			tabManager: undefined,
			activeTabIdForUi: undefined,
			inlineWidgetTabStates: new Map<string, InlineWidgetTabState>(),
			mixcodeSettings: { ui: { inlineWidgets: false } } as MixCodeSettings,
		} as unknown as InlineWiringContext;
		const state = proto.inlineWidgetState.call(context);

		expect(state?.enabled).toBe(false);
		expect(proto.inlineWidgetState.call(context)).toBe(state);
		expect(context.inlineWidgetTabStates.has(SESSION_KEY)).toBe(true);
	});

	it("places widgets by the tab it is attached to, not the previous one", () => {
		const above = new Map<string, Component>([["goal", WidgetBody.keyed("goal", 1)]]);
		const inlineTab = createInlineWidgetTabState(true);
		const dockedTab = createInlineWidgetTabState(false);
		const context = {
			extensionWidgetsAbove: above,
			extensionWidgetsBelow: new Map<string, Component>(),
			tabManager: {},
			activeTabIdForUi: "inline",
			inlineWidgetTabStates: new Map<string, InlineWidgetTabState>([
				["inline", inlineTab],
				["docked", dockedTab],
			]),
		} as unknown as InlineWiringContext;
		context.inlineWidgetState = () => proto.inlineWidgetState.call(context);
		const budget = new DockWidgetBudget({
			widgets: () => ({ above, below: new Map<string, Component>() }),
			chromeRows: () => 0,
			viewportRows: () => 40,
			widgetsHidden: () => context.inlineWidgetState()?.enabled === true,
		});

		expect(budget.above.render(60)).toEqual([]);

		// The tab being attached owns the placement, so a docked tab gets its rows back.
		context.activeTabIdForUi = "docked";
		expect(budget.above.render(60)).toHaveLength(2);
	});
});
