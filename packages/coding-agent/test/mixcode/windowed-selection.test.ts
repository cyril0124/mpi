import { ScrollView, Text, TuiAltScreen, VStack } from "@earendil-works/pi-tui";
import { describe, expect, it } from "vitest";
import { VirtualTerminal } from "../../../tui/test/virtual-terminal.ts";
import { WindowedTranscript } from "../../src/modes/interactive/components/mixcode/windowed-chat/windowed-transcript.ts";

/** Real windowed chat and mouse dispatch, with history taller than the measured viewport. */
async function startTranscript(rowsPerBlock: number) {
	const blocks = Array.from(
		{ length: 200 },
		(_, block) =>
			new Text(Array.from({ length: rowsPerBlock }, (_, row) => `message${block} row${row}`).join("\n"), 0, 0),
	);
	const content = new WindowedTranscript({ blocks: () => blocks });
	const scroll = new ScrollView(content, { follow: "end", primary: true, scrollbar: "always" });
	const terminal = new VirtualTerminal(60, 12);
	const copied: string[] = [];
	const tui = new TuiAltScreen(terminal, undefined, undefined, {
		copySelection: async (text) => {
			copied.push(text);
			return true;
		},
		selection: { surfaces: () => [{ component: scroll, kind: "chat" }], clearOnRelease: true },
	});
	tui.setLayoutRoot(
		new VStack([
			{ component: new Text("header", 0, 0), basis: 1, shrink: 0 },
			{ component: scroll, basis: 0, grow: 1, minSize: 1 },
			{ component: new Text("composer", 0, 0), basis: 1, shrink: 0 },
		]),
	);
	tui.start();
	await terminal.waitForRender();
	return { terminal, tui, scroll, copied };
}

describe("mouse selection in a partially measured transcript", () => {
	it.each([3, 10])("keeps the visible rows during a plain click on %i-row messages", async (rowsPerBlock) => {
		const { terminal, tui, scroll, copied } = await startTranscript(rowsPerBlock);
		try {
			const before = terminal.getViewport();
			expect(before[10]).toContain(`message199 row${rowsPerBlock - 1}`);
			const offset = scroll.scrollTop;

			// A frame between press and release exposes the jump even if release resumes follow-end.
			terminal.sendInput("\x1b[<0;5;5M");
			await terminal.waitForRender();
			expect(terminal.getViewport()).toEqual(before);
			expect(scroll.scrollTop).toBe(offset);
			terminal.sendInput("\x1b[<0;5;5m");
			await terminal.waitForRender();
			expect(terminal.getViewport()).toEqual(before);
			expect(scroll.isFollowingEnd).toBe(true);
			expect(copied).toEqual([]);
		} finally {
			tui.stop();
		}
	});

	it("copies the displayed rows after a wheel scroll and drag without moving the viewport", async () => {
		const { terminal, tui, scroll, copied } = await startTranscript(10);
		try {
			terminal.sendInput("\x1b[<72;5;5M");
			await terminal.waitForRender();
			const before = terminal.getViewport();
			const offset = scroll.scrollTop;
			const expected = `${before[3]!.split("│")[0]!.trimEnd()}\n${before[4]!.slice(0, 10)}`;

			terminal.sendInput("\x1b[<0;1;4M");
			terminal.sendInput("\x1b[<32;10;5M");
			await terminal.waitForRender();
			terminal.sendInput("\x1b[<0;10;5m");
			await terminal.waitForRender();

			// Copy confirmation occupies the header; the transcript and composer stay put.
			expect(copied).toEqual([expected]);
			expect(terminal.getViewport().slice(1)).toEqual(before.slice(1));
			expect(scroll.scrollTop).toBe(offset);
			expect(scroll.isFollowingEnd).toBe(false);
		} finally {
			tui.stop();
		}
	});

	it("double-clicks the visible word instead of a word at its estimated document row", async () => {
		const { terminal, tui, copied } = await startTranscript(10);
		try {
			const before = terminal.getViewport();
			const expected = before[4]!.split(" ")[0];
			for (let click = 0; click < 2; click++) {
				terminal.sendInput("\x1b[<0;5;5M");
				terminal.sendInput("\x1b[<0;5;5m");
				await terminal.waitForRender();
			}
			expect(copied).toEqual([expected]);
			expect(terminal.getViewport().slice(1)).toEqual(before.slice(1));
		} finally {
			tui.stop();
		}
	});
});
