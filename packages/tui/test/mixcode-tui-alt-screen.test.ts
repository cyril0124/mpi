import assert from "node:assert";
import { describe, it } from "node:test";
import { Text } from "../src/components/text.ts";
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

		assert.deepStrictEqual(results, [{ ok: true, detail: undefined, chars: 10 }]);
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

		assert.deepStrictEqual(results, [{ ok: false, detail: "clipboard unavailable", chars: 10 }]);
		assert.ok(
			terminal.getViewport().every((line) => !line.includes("clipboard unavailable")),
			"the host owns the failure text, so the screen writes none",
		);

		tui.stop();
	});
});
