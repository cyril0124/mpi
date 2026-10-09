import { Text } from "@earendil-works/pi-tui";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { VirtualTerminal } from "../../../tui/test/virtual-terminal.ts";
import { createInteractiveTui, InteractiveMode } from "../../src/modes/interactive/interactive-mode.ts";

const clipboardMocks = vi.hoisted(() => ({
	copyToClipboard: vi.fn<(text: string) => Promise<void>>(),
	readClipboardText: vi.fn<() => Promise<string | null>>(),
}));

vi.mock("../../src/utils/clipboard.ts", () => clipboardMocks);

type CopyCommandContext = {
	session: { getLastAssistantText: () => string | undefined };
	ui: ReturnType<typeof createInteractiveTui>;
	showStatus: (message: string) => void;
	showError: (message: string) => void;
	notifyToast: (type: string, message: string) => void;
};

type CopyCommandPrototype = {
	handleCopyCommand(this: CopyCommandContext, options?: { preferSelection?: boolean }): Promise<void>;
	notifyCopyResult(this: CopyCommandContext, result: { ok: boolean; detail?: string; graphemes: number }): void;
};

const copyCommandPrototype = InteractiveMode.prototype as unknown as CopyCommandPrototype;

describe("InteractiveMode copy confirmation", () => {
	beforeEach(() => {
		clipboardMocks.copyToClipboard.mockReset();
		clipboardMocks.copyToClipboard.mockResolvedValue(undefined);
	});

	it("reports a selection copy through the screen's copy result callback", async () => {
		const terminal = new VirtualTerminal(40, 4);
		const showStatus = vi.fn();
		const showError = vi.fn();
		const notifyToast = vi.fn();
		const context = {
			session: { getLastAssistantText: () => "assistant response" },
			showStatus,
			showError,
			notifyToast,
		} as unknown as CopyCommandContext;
		const ui = createInteractiveTui({
			tuiMode: "fullscreen",
			showHardwareCursor: false,
			logDirectory: "/tmp",
			terminal,
			fullscreenCopyOnSelect: false,
			onCopyResult: (result) => copyCommandPrototype.notifyCopyResult.call(context, result),
		});
		context.ui = ui;
		ui.addChild(new Text("alpha\nbeta\ngamma\ndelta", 0, 0));

		ui.start();
		try {
			await terminal.waitForRender();
			terminal.sendInput("\x1b[<0;1;1M");
			terminal.sendInput("\x1b[<32;4;2M");
			terminal.sendInput("\x1b[<0;4;2m");
			await terminal.waitForRender();

			await copyCommandPrototype.handleCopyCommand.call(context, { preferSelection: true });
			await terminal.waitForRender();

			expect(showStatus).not.toHaveBeenCalled();
			expect(showError).not.toHaveBeenCalled();
			expect(notifyToast).toHaveBeenCalledWith("success", "Copied 10 chars.");
		} finally {
			ui.stop();
		}
	});
});
