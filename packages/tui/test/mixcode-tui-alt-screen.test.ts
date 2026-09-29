import assert from "node:assert";
import { describe, it } from "node:test";
import { ScrollView } from "../src/components/scroll-view.ts";
import { Text } from "../src/components/text.ts";
import { VStack } from "../src/components/v-stack.ts";
import { WINDOWED_NODE, type WindowedLayoutNode } from "../src/layout-node.ts";
import { type Component, Container, type TuiMouseEvent, type TuiSelectionOptions } from "../src/tui.ts";

/** Records everything the screen writes, so a test can read the styled frame. */
class RecordingTerminal extends VirtualTerminal {
	readonly writes: string[] = [];

	override write(data: string): void {
		this.writes.push(data);
		super.write(data);
	}
}

import { type ClipboardResult, TuiAltScreen } from "../src/tui-alt-screen.ts";
import { VirtualTerminal } from "./virtual-terminal.ts";

/**
 * The alternate screen normally flashes its own confirmation. A host that passes
 * `onCopyResult` takes that over, and the screen must then report the result
 * without writing anything of its own.
 */
describe("alternate screen clipboard report", () => {
	it("hands a successful copy to the host instead of flashing", async () => {
		const terminal = new VirtualTerminal(20, 4);
		const results: ClipboardResult[] = [];
		const tui = new TuiAltScreen(terminal, undefined, undefined, {
			copySelection: async () => true,
			onCopyResult: (result) => results.push(result),
		});
		tui.addChild(new Text("alpha\nbeta\ngamma\ndelta", 0, 0));
		tui.start();
		await terminal.waitForRender();

		terminal.sendInput("\x1b[<0;1;1M");
		terminal.sendInput("\x1b[<32;4;2M");
		terminal.sendInput("\x1b[<0;4;2m");
		await terminal.waitForRender();

		assert.deepStrictEqual(results, [{ ok: true, detail: undefined, graphemes: 10 }]);
		assert.ok(
			terminal.getViewport().every((line) => !line.includes("Copied")),
			"the host owns the confirmation, so the screen writes none",
		);

		tui.stop();
	});

	it("hands a failed copy's reason to the host instead of flashing", async () => {
		// Wide enough to hold the whole reason, so a flash would be visible in the viewport.
		const terminal = new VirtualTerminal(40, 4);
		const results: ClipboardResult[] = [];
		const tui = new TuiAltScreen(terminal, undefined, undefined, {
			copySelection: async () => "clipboard unavailable",
			onCopyResult: (result) => results.push(result),
		});
		tui.addChild(new Text("alpha\nbeta\ngamma\ndelta", 0, 0));
		tui.start();
		await terminal.waitForRender();

		terminal.sendInput("\x1b[<0;1;1M");
		terminal.sendInput("\x1b[<32;4;2M");
		terminal.sendInput("\x1b[<0;4;2m");
		await terminal.waitForRender();

		assert.deepStrictEqual(results, [{ ok: false, detail: "clipboard unavailable", graphemes: 10 }]);
		assert.ok(
			terminal.getViewport().every((line) => !line.includes("clipboard unavailable")),
			"the host owns the failure text, so the screen writes none",
		);

		tui.stop();
	});
});

/**
 * Hover tracking in the fullscreen renderer: passive motion reaches the component
 * under the pointer, that component is told when the pointer leaves, an overlay
 * takes the pointer away from it, and the jump-to-end label reports its own hover.
 */

/** SGR passive-motion sequence for a 1-based cell position. */
function motion(x: number, y: number): string {
	return `\x1b[<35;${x};${y}M`;
}

/** A component that tracks its own hover state the way a real region does. */
function hoverProbe(state: { hovered: boolean; renders: number }): Component {
	return {
		render: () => {
			state.renders += 1;
			return [state.hovered ? "HOVER" : "plain"];
		},
		invalidate: () => {},
		handleMouse: (event: TuiMouseEvent) => {
			if (event.type !== "move" || event.button !== "none") return undefined;
			const inside = event.x >= 0 && event.y >= 0 && event.x < event.width && event.y < event.height;
			const changed = inside !== state.hovered;
			state.hovered = inside;
			// A component that owns hover answers every move inside it.
			return { handled: true, render: changed };
		},
	};
}

describe("fullscreen hover tracking", () => {
	it("tells the component the pointer left once the move reaches another one", async () => {
		const terminal = new VirtualTerminal(20, 2);
		const tui = new TuiAltScreen(terminal);
		const first = { hovered: false, renders: 0 };
		const second = { hovered: false, renders: 0 };
		tui.setLayoutRoot(
			new VStack([
				{ component: hoverProbe(first), basis: 1, minSize: 1 },
				{ component: hoverProbe(second), basis: 1, minSize: 1 },
			]),
		);
		tui.start();
		await terminal.waitForRender();

		terminal.sendInput(motion(1, 1));
		await terminal.waitForRender();
		assert.strictEqual(first.hovered, true);

		// Moving inside the same component keeps the cue without a repaint.
		const rendersWhileHovered = first.renders;
		terminal.sendInput(motion(5, 1));
		await terminal.waitForRender();
		assert.strictEqual(first.hovered, true);
		assert.strictEqual(first.renders, rendersWhileHovered);

		terminal.sendInput(motion(1, 2));
		await terminal.waitForRender();
		assert.strictEqual(first.hovered, false);
		assert.strictEqual(second.hovered, true);
		tui.stop();
	});

	it("drops the hover when the terminal is resized under the pointer", async () => {
		const terminal = new VirtualTerminal(20, 4);
		const tui = new TuiAltScreen(terminal);
		const probe = { hovered: false, renders: 0 };
		tui.addChild(hoverProbe(probe));
		tui.start();
		await terminal.waitForRender();

		terminal.sendInput(motion(1, 1));
		await terminal.waitForRender();
		assert.strictEqual(probe.hovered, true);

		// The rectangles the cue was measured against no longer exist.
		terminal.resize(30, 4);
		await terminal.waitForRender();
		assert.strictEqual(probe.hovered, false);
		tui.stop();
	});

	it("drops the hover for input that is not pointer motion", async () => {
		const terminal = new VirtualTerminal(20, 4);
		const tui = new TuiAltScreen(terminal);
		const probe = { hovered: false, renders: 0 };
		tui.addChild(hoverProbe(probe));
		tui.start();
		await terminal.waitForRender();

		terminal.sendInput(motion(1, 1));
		await terminal.waitForRender();
		assert.strictEqual(probe.hovered, true);

		// A key does not move the pointer, but the surface under it may redraw.
		terminal.sendInput("a");
		await terminal.waitForRender();
		assert.strictEqual(probe.hovered, false);

		terminal.sendInput(motion(1, 1));
		await terminal.waitForRender();
		assert.strictEqual(probe.hovered, true);

		// The same goes for a wheel, which scrolls whatever is under the pointer.
		terminal.sendInput("\x1b[<64;1;1M");
		await terminal.waitForRender();
		assert.strictEqual(probe.hovered, false);
		tui.stop();
	});

	it("drops the jump label's hover once the label moves", async () => {
		const terminal = new VirtualTerminal(30, 6);
		const tui = new TuiAltScreen(terminal, undefined, undefined, {
			scrollToEndIndicator: (hovered) => (hovered ? "HOVER-LBL" : "PLAIN-LBL"),
		});
		const transcript = new ScrollView(
			new Text(Array.from({ length: 8 }, (_, index) => `line ${index + 1}`).join("\n"), 0, 0),
			{ follow: "end", primary: true },
		);
		const dock = new Container();
		dock.addChild(new Text("editor\nfooter", 0, 0));
		tui.setLayoutRoot(
			new VStack([
				{ component: transcript, basis: 0, grow: 1, minSize: 1 },
				{ component: dock, basis: "auto", minSize: 1 },
			]),
		);
		tui.start();
		await terminal.waitForRender();

		terminal.sendInput("\x1b[<64;1;1M");
		await terminal.waitForRender();
		const labelRow = terminal.getViewport().findIndex((row) => row.includes("PLAIN-LBL"));
		const labelColumn = (terminal.getViewport()[labelRow] ?? "").indexOf("PLAIN-LBL");
		terminal.sendInput(motion(labelColumn + 1, labelRow + 1));
		await terminal.waitForRender();
		assert.match(terminal.getViewport()[labelRow] ?? "", /HOVER-LBL/);

		// The dock grows by a row without a resize, so the label moves up and the
		// pointer is no longer on it.
		dock.addChild(new Text("status line", 0, 0));
		tui.requestRender();
		await terminal.waitForRender();
		assert.ok(!terminal.getViewport().some((row) => row.includes("HOVER-LBL")));
		tui.stop();
	});

	it("drops the hover when an overlay takes the pointer", async () => {
		const terminal = new VirtualTerminal(20, 2);
		const tui = new TuiAltScreen(terminal);
		const probe = { hovered: false, renders: 0 };
		tui.addChild(hoverProbe(probe));
		tui.start();
		await terminal.waitForRender();

		terminal.sendInput(motion(1, 1));
		await terminal.waitForRender();
		assert.strictEqual(probe.hovered, true);

		tui.showOverlay(new Text("overlay", 0, 0));
		await terminal.waitForRender();
		assert.strictEqual(probe.hovered, false);
		tui.stop();
	});

	it("reports the jump-to-end label as hovered only while the pointer is over it", async () => {
		const terminal = new VirtualTerminal(30, 6);
		const tui = new TuiAltScreen(terminal, undefined, undefined, {
			scrollToEndIndicator: (hovered) => (hovered ? "HOVER-LBL" : "PLAIN-LBL"),
		});
		const transcript = new ScrollView(
			new Text(Array.from({ length: 8 }, (_, index) => `line ${index + 1}`).join("\n"), 0, 0),
			{ follow: "end", primary: true },
		);
		tui.setLayoutRoot(
			new VStack([
				{ component: transcript, basis: 0, grow: 1, minSize: 1 },
				{ component: new Text("editor\nfooter", 0, 0), basis: "auto", minSize: 1 },
			]),
		);
		tui.start();
		await terminal.waitForRender();

		// Scroll away from the end so the label appears on the transcript's last row.
		terminal.sendInput("\x1b[<64;1;1M");
		await terminal.waitForRender();
		assert.strictEqual(transcript.isFollowingEnd, false);
		assert.match(terminal.getViewport()[3] ?? "", /PLAIN-LBL/);

		// The label is centered on that row; the pointer lands on its cells.
		const labelColumn = (terminal.getViewport()[3] ?? "").indexOf("PLAIN-LBL");
		terminal.sendInput(motion(labelColumn + 1, 4));
		await terminal.waitForRender();
		assert.match(terminal.getViewport()[3] ?? "", /HOVER-LBL/);
		assert.match(terminal.getViewport()[3] ?? "", /line 7/);

		// Leaving the label removes the cue and does not scroll the transcript.
		terminal.sendInput(motion(1, 2));
		await terminal.waitForRender();
		assert.match(terminal.getViewport()[3] ?? "", /PLAIN-LBL/);
		assert.strictEqual(transcript.isFollowingEnd, false);
		tui.stop();
	});
});

/**
 * A host that publishes selectable surfaces narrows the selection: a drag outside every
 * surface keeps its other meaning, drag points clamp to the surface, the copied text runs
 * through the host's normalizer, and the host's style replaces reverse video.
 */
describe("scoped mouse selection", () => {
	const CHROME_ROW = 1;
	const CARD_ROW = 2;

	interface Harness {
		terminal: RecordingTerminal;
		copied: string[];
		tui: TuiAltScreen;
	}

	/** A one-row chrome strip above a selectable card, both laid out by the frame. */
	async function start(
		select: (card: Text, chrome: Text) => TuiSelectionOptions,
		cardText = "hello world\nsecond line",
	): Promise<Harness> {
		const terminal = new RecordingTerminal(20, 6);
		const chrome = new Text("chrome bar", 0, 0);
		const card = new Text(cardText, 0, 0);
		const copied: string[] = [];
		const tui = new TuiAltScreen(terminal, undefined, undefined, {
			copySelection: async (text) => {
				copied.push(text);
				return true;
			},
			selection: select(card, chrome),
		});
		tui.setLayoutRoot(
			new VStack([
				{ component: chrome, basis: "auto", grow: 0, shrink: 0, minSize: 1 },
				{ component: card, basis: 0, grow: 1, shrink: 0, minSize: 1 },
			]),
		);
		tui.start();
		await terminal.waitForRender();
		return { terminal, copied, tui };
	}

	function drag(terminal: RecordingTerminal, from: [col: number, row: number], to: [col: number, row: number]): void {
		terminal.sendInput(`\x1b[<0;${from[0]};${from[1]}M`);
		terminal.sendInput(`\x1b[<32;${to[0]};${to[1]}M`);
		terminal.sendInput(`\x1b[<0;${to[0]};${to[1]}m`);
	}

	it("keeps a press outside every surface out of the selection", async () => {
		const { terminal, copied, tui } = await start((card) => ({
			surfaces: () => [{ component: card, kind: "chat" }],
		}));

		// The chrome strip is on screen but is not a published surface.
		drag(terminal, [1, CHROME_ROW], [5, CHROME_ROW]);
		await terminal.waitForRender();
		assert.deepStrictEqual(copied, [], "chrome is not selectable");

		drag(terminal, [1, CARD_ROW], [6, CARD_ROW]);
		await terminal.waitForRender();
		assert.deepStrictEqual(copied, ["hello"]);

		tui.stop();
	});

	it("starts no selection while the host publishes no surface", async () => {
		const { terminal, copied, tui } = await start(() => ({
			surfaces: () => [],
			normalizeText: (text) => `seen:${text}`,
		}));

		drag(terminal, [1, CARD_ROW], [6, CARD_ROW]);
		await terminal.waitForRender();
		assert.deepStrictEqual(copied, []);

		tui.stop();
	});

	it("clamps a drag that leaves the surface to the surface's own rows", async () => {
		const { terminal, copied, tui } = await start((card) => ({
			surfaces: () => [{ component: card, kind: "input" }],
		}));

		// Press on the card's first row, then drag up onto the chrome strip.
		drag(terminal, [1, CARD_ROW], [5, CHROME_ROW]);
		await terminal.waitForRender();

		assert.deepStrictEqual(copied, ["hello"], "the drag pins to the card's first row");

		tui.stop();
	});

	it("runs the copied text through the host's normalizer with the surface kind", async () => {
		const { terminal, copied, tui } = await start((card) => ({
			surfaces: () => [{ component: card, kind: "input" }],
			normalizeText: (text, kind) => `${kind}:${text}`,
		}));

		drag(terminal, [1, CARD_ROW], [6, CARD_ROW + 1]);
		await terminal.waitForRender();

		assert.deepStrictEqual(copied, ["input:hello world\nsecond"]);

		tui.stop();
	});

	it("paints the host's style and re-inserts it after a reset inside the selection", async () => {
		const { terminal, tui } = await start(
			(card) => ({
				surfaces: () => [{ component: card, kind: "chat" }],
				highlight: (text) => `\x1b[41m${text}\x1b[49m`,
			}),
			"\x1b[1malpha\x1b[0m beta",
		);

		drag(terminal, [1, CARD_ROW], [6, CARD_ROW]);
		await terminal.waitForRender();

		const writes = terminal.writes.join("");
		assert.ok(writes.includes("\x1b[41m"), "the host style paints the selected cells");
		assert.ok(writes.includes("\x1b[0m\x1b[41m"), "the host style is re-inserted after a reset inside the selection");

		tui.stop();
	});
});

/**
 * The notice panel is an overlay, not a layout node: a published overlay surface resolves to
 * the compositor's rect, so a drag inside it selects the panel's own cells.
 */
describe("scoped selection over an overlay surface", () => {
	it("selects inside a published overlay and ignores cells outside it", async () => {
		const terminal = new RecordingTerminal(24, 10);
		const copied: string[] = [];
		const notice = new Text("notice line\nsecond line", 0, 0);
		const tui = new TuiAltScreen(terminal, undefined, undefined, {
			copySelection: async (text) => {
				copied.push(text);
				return true;
			},
			selection: { surfaces: () => [{ component: notice, kind: "notice" }] },
		});
		tui.setLayoutRoot(new Text("background text", 0, 0));
		tui.showOverlay(notice, { anchor: "bottom-center", width: 16, margin: 1, nonCapturing: true });
		tui.start();
		await terminal.waitForRender();

		const rows = terminal.getViewport();
		const row = rows.findIndex((line) => line.includes("notice line"));
		assert.ok(row >= 0, `the notice is on screen: ${JSON.stringify(rows)}`);
		const col = rows[row]!.indexOf("notice line");

		// Press on the second cell and drag five cells right, inside the panel.
		terminal.sendInput(`\x1b[<0;${col + 2};${row + 1}M`);
		terminal.sendInput(`\x1b[<32;${col + 7};${row + 1}M`);
		terminal.sendInput(`\x1b[<0;${col + 7};${row + 1}m`);
		await terminal.waitForRender();
		assert.deepStrictEqual(copied, ["otice"]);

		// The background above the panel is not a published surface.
		copied.length = 0;
		terminal.sendInput("\x1b[<0;1;1M");
		terminal.sendInput("\x1b[<32;8;1M");
		terminal.sendInput("\x1b[<0;8;1m");
		await terminal.waitForRender();
		assert.deepStrictEqual(copied, []);

		tui.stop();
	});
});

/**
 * A following scroll view would otherwise track output that arrives while the button is down,
 * sliding the selected rows out from under the pointer and copying text the user never dragged
 * over.
 */
describe("scoped selection while new output arrives", () => {
	function transcript(lines: string[]): {
		terminal: RecordingTerminal;
		text: Text;
		tui: TuiAltScreen;
		copied: string[];
	} {
		const terminal = new RecordingTerminal(20, 5);
		const text = new Text(lines.join("\n"), 0, 0);
		const transcriptScroll = new ScrollView(text, { follow: "end", primary: true });
		const copied: string[] = [];
		const tui = new TuiAltScreen(terminal, undefined, undefined, {
			copySelection: async (value) => {
				copied.push(value);
				return true;
			},
			selection: { surfaces: () => [{ component: transcriptScroll, kind: "chat" }] },
		});
		tui.setLayoutRoot(transcriptScroll);
		return { terminal, text, tui, copied };
	}

	const lines = (count: number) => Array.from({ length: count }, (_, index) => `line ${index + 1}`);

	it("copies the rows the drag started on, not the rows that replaced them", async () => {
		const { terminal, text, tui, copied } = transcript(lines(8));
		tui.start();
		await terminal.waitForRender();
		assert.deepStrictEqual(
			terminal.getViewport().map((line) => line.trimEnd()),
			["line 4", "line 5", "line 6", "line 7", "line 8"],
		);

		terminal.sendInput("\x1b[<0;1;2M");
		terminal.sendInput("\x1b[<32;7;3M");
		await terminal.waitForRender();
		// Output arrives while the button is held down.
		text.setText(lines(12).join("\n"));
		tui.requestRender();
		await terminal.waitForRender();
		terminal.sendInput("\x1b[<0;7;3m");
		await terminal.waitForRender();

		assert.deepStrictEqual(copied, ["line 5\nline 6"]);
		tui.stop();
	});

	it("takes the endpoint from the last motion event, not from the release", async () => {
		// A frame can change under the pointer between the last motion and the release (streamed
		// output, a re-measured window), so the release row is not where the drag ended.
		const card = new Text("hello world\nsecond line\nthird line", 0, 0);
		const terminal = new RecordingTerminal(20, 4);
		const copied: string[] = [];
		const tui = new TuiAltScreen(terminal, undefined, undefined, {
			copySelection: async (text) => {
				copied.push(text);
				return true;
			},
			selection: { surfaces: () => [{ component: card, kind: "chat" }] },
		});
		tui.setLayoutRoot(card);
		tui.start();
		await terminal.waitForRender();

		terminal.sendInput("\x1b[<0;1;1M");
		terminal.sendInput("\x1b[<32;6;1M");
		terminal.sendInput("\x1b[<0;6;3m");
		await terminal.waitForRender();

		assert.deepStrictEqual(copied, ["hello"]);
		tui.stop();
	});

	it("keeps following when the press never dragged", async () => {
		const { terminal, text, tui } = transcript(lines(8));
		tui.start();
		await terminal.waitForRender();

		terminal.sendInput("\x1b[<0;1;2M");
		terminal.sendInput("\x1b[<0;1;2m");
		await terminal.waitForRender();
		text.setText(lines(12).join("\n"));
		tui.requestRender();
		await terminal.waitForRender();

		assert.deepStrictEqual(
			terminal
				.getViewport()
				.map((line) => line.trimEnd())
				.at(-1),
			"line 12",
		);
		tui.stop();
	});
});

/**
 * A windowed child that measures one pass late, the way the transcript does while a block streams:
 * its line count still describes the previous pass, so a window collected from that count reaches
 * the end of the content. Without the press keeping the offset, the window re-collects at the end
 * and the rows under the pointer are replaced by the newest output.
 */
describe("scoped selection over a window that measures late", () => {
	class LateWindow implements Component {
		rows: string[];
		/** The count the last measured pass reported, which lags `rows` by one pass. */
		estimate: number;

		constructor(rows: string[]) {
			this.rows = rows;
			this.estimate = rows.length;
		}

		render(): string[] {
			return this.rows;
		}

		invalidate(): void {}

		[WINDOWED_NODE](): WindowedLayoutNode {
			return {
				type: "windowed",
				state: {
					lineCount: () => this.estimate,
					renderWindow: (_width, scrollTop, height, overscan, honorOffset) => {
						// The window judges the offset against the count the previous pass reported.
						const staleEstimate = this.estimate;
						const total = this.rows.length;
						this.estimate = total;
						const atEnd = !honorOffset && scrollTop + height >= staleEstimate;
						const end = atEnd ? total : Math.min(total, scrollTop + height + overscan);
						const start = Math.max(0, end - (height + overscan * 2));
						return {
							lines: this.rows.slice(start, end),
							start,
							scrollTop: atEnd ? Math.max(0, total - height) : scrollTop,
							total,
						};
					},
					getLines: (_width, start, count) => this.rows.slice(start, start + count),
					materialize: () => [...this.rows],
				},
			};
		}
	}

	it("keeps the rows under the pointer while the last block streams", async () => {
		const terminal = new RecordingTerminal(20, 5);
		const head = Array.from({ length: 9 }, (_, index) => `head ${index + 1}`);
		const content = new LateWindow([...head, "stream 1", "stream 2"]);
		const transcript = new ScrollView(content, { follow: "end", primary: true });
		const copied: string[] = [];
		const tui = new TuiAltScreen(terminal, undefined, undefined, {
			copySelection: async (value) => {
				copied.push(value);
				return true;
			},
			selection: { surfaces: () => [{ component: transcript, kind: "chat" }] },
		});
		tui.setLayoutRoot(transcript);
		tui.start();
		await terminal.waitForRender();
		const viewport = () => terminal.getViewport().map((line) => line.trimEnd());
		assert.deepStrictEqual(viewport(), ["head 7", "head 8", "head 9", "stream 1", "stream 2"]);

		// Anchor on the first viewport row and drag one row down.
		terminal.sendInput("\x1b[<0;1;1M");
		terminal.sendInput("\x1b[<32;7;2M");
		await terminal.waitForRender();

		// The last block streams more rows; the count the window sees still describes the old pass.
		content.rows = [...head, ...Array.from({ length: 8 }, (_, index) => `stream ${index + 1}`)];
		content.estimate = head.length + 2;
		tui.requestRender();
		await terminal.waitForRender();

		assert.deepStrictEqual(
			viewport(),
			["head 7", "head 8", "head 9", "stream 1", "stream 2"],
			"the rows under the pointer stay put while the estimate is stale",
		);

		terminal.sendInput("\x1b[<0;7;2m");
		await terminal.waitForRender();
		assert.deepStrictEqual(copied, ["head 7\nhead 8"]);
		tui.stop();
	});
});

/**
 * What a press leaves behind. The viewport is held only while the gesture needs it: a press that
 * moved the rows nowhere (no output arrived past the viewport, nothing scrolled) lets the view
 * follow again, and one that left output behind keeps it where the user left it, with
 * jump-to-latest as the way back.
 */
describe("what a press leaves behind", () => {
	const rowLines = (count: number) => Array.from({ length: count }, (_, index) => `line ${index + 1}`);
	function followingTranscript(lineCount: number, rows = 5) {
		const terminal = new RecordingTerminal(20, rows);
		const text = new Text(rowLines(lineCount).join("\n"), 0, 0);
		const transcript = new ScrollView(text, { follow: "end", primary: true });
		const copied: string[] = [];
		const tui = new TuiAltScreen(terminal, undefined, undefined, {
			copySelection: async (value) => {
				copied.push(value);
				return true;
			},
			selection: { surfaces: () => [{ component: transcript, kind: "chat" }] },
		});
		tui.setLayoutRoot(transcript);
		return { terminal, text, transcript, copied, tui };
	}

	/** Press on the first column of `fromRow`, drag to the last column of `toRow`. */
	const drag = (terminal: RecordingTerminal, fromRow: number, toRow: number) => {
		terminal.sendInput(`\x1b[<0;1;${fromRow}M`);
		terminal.sendInput(`\x1b[<32;7;${toRow}M`);
	};

	it("follows again after a drag that left the rows where they were", async () => {
		const { terminal, text, transcript, tui } = followingTranscript(8);
		tui.start();
		await terminal.waitForRender();
		drag(terminal, 2, 3);
		terminal.sendInput("\x1b[<0;7;3m");
		await terminal.waitForRender();
		assert.strictEqual(transcript.isFollowingEnd, true, "nothing grew, so the view keeps following");

		text.setText(rowLines(12).join("\n"));
		tui.requestRender();
		await terminal.waitForRender();
		assert.deepStrictEqual(
			terminal
				.getViewport()
				.map((line) => line.trimEnd())
				.at(-1),
			"line 12",
		);
		tui.stop();
	});

	it("follows again when the content that arrived still fits the viewport", async () => {
		const { terminal, text, transcript, tui } = followingTranscript(2);
		tui.start();
		await terminal.waitForRender();
		drag(terminal, 1, 2);
		// Three more rows arrive, but the document still fits the five-row viewport.
		text.setText(rowLines(5).join("\n"));
		tui.requestRender();
		await terminal.waitForRender();
		terminal.sendInput("\x1b[<0;7;2m");
		await terminal.waitForRender();
		assert.strictEqual(transcript.isFollowingEnd, true, "content that still fits was already at its end");

		text.setText(rowLines(9).join("\n"));
		tui.requestRender();
		await terminal.waitForRender();
		assert.deepStrictEqual(
			terminal
				.getViewport()
				.map((line) => line.trimEnd())
				.at(-1),
			"line 9",
		);
		tui.stop();
	});

	it("stays where the user left it after a drag that had output arriving", async () => {
		const { terminal, text, transcript, tui } = followingTranscript(8);
		tui.start();
		await terminal.waitForRender();
		drag(terminal, 2, 3);
		text.setText(rowLines(14).join("\n"));
		tui.requestRender();
		await terminal.waitForRender();
		terminal.sendInput("\x1b[<0;7;3m");
		await terminal.waitForRender();
		assert.strictEqual(transcript.isFollowingEnd, false, "output arrived, so the rows stay put");

		tui.scrollToBottom();
		await terminal.waitForRender();
		assert.strictEqual(transcript.isFollowingEnd, true, "jump-to-latest takes up following again");
		tui.stop();
	});

	it("copies nothing for a press whose view scrolled underneath it", async () => {
		const { terminal, transcript, copied, tui } = followingTranscript(20);
		tui.start();
		await terminal.waitForRender();
		terminal.sendInput("\x1b[<0;1;2M");
		// The wheel moves the viewport without the pointer moving.
		terminal.sendInput("\x1b[<64;1;3M");
		terminal.sendInput("\x1b[<64;1;3M");
		await terminal.waitForRender();
		terminal.sendInput("\x1b[<0;7;2m");
		await terminal.waitForRender();
		assert.deepStrictEqual(copied, []);
		assert.strictEqual(transcript.isFollowingEnd, false, "the wheel asked for that position");
		tui.stop();
	});

	it("keeps following when a wheel cannot move the view under a press", async () => {
		const { terminal, transcript, tui } = followingTranscript(20);
		tui.start();
		await terminal.waitForRender();
		// The view is already at the end, so wheeling down cannot move it.
		terminal.sendInput("\x1b[<0;1;2M");
		terminal.sendInput("\x1b[<65;1;3M");
		await terminal.waitForRender();
		terminal.sendInput("\x1b[<0;7;2m");
		await terminal.waitForRender();
		assert.strictEqual(transcript.isFollowingEnd, true, "a wheel that moved nothing is not a scroll");
		tui.stop();
	});

	it("keeps following when the content shrinks under a press, and copies nothing", async () => {
		const { terminal, text, transcript, copied, tui } = followingTranscript(20);
		tui.start();
		await terminal.waitForRender();
		terminal.sendInput("\x1b[<0;1;2M");
		// The document gets shorter, which clamps the offset without the user scrolling.
		text.setText(rowLines(6).join("\n"));
		tui.requestRender();
		await terminal.waitForRender();
		terminal.sendInput("\x1b[<0;7;2m");
		await terminal.waitForRender();
		assert.deepStrictEqual(copied, [], "the clamp moved the rows, so the press has no endpoint");
		assert.strictEqual(transcript.isFollowingEnd, true, "a shrink is not a scroll");

		text.setText(rowLines(24).join("\n"));
		tui.requestRender();
		await terminal.waitForRender();
		assert.deepStrictEqual(
			terminal
				.getViewport()
				.map((line) => line.trimEnd())
				.at(-1),
			"line 24",
		);
		tui.stop();
	});
});
