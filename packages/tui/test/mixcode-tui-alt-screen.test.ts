import assert from "node:assert";
import { describe, it } from "node:test";
import { ScrollView } from "../src/components/scroll-view.ts";
import { Text } from "../src/components/text.ts";
import { VStack } from "../src/components/v-stack.ts";
import { type Component, Container, type TuiMouseEvent } from "../src/tui.ts";
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
