/**
 * A tab switch can paint a plain working indicator while a compaction or branch summary runs.
 * These cases pin the summary's end event to clearing that working indicator, and to leaving one
 * alone while an agent run still owns it.
 */
import { Container } from "@earendil-works/pi-tui";
import { describe, expect, it, vi } from "vitest";
import type { StatusIndicatorKind } from "../../src/modes/interactive/components/status-indicator.ts";
import { InteractiveMode } from "../../src/modes/interactive/interactive-mode.ts";

type StatusIndicatorStub = { kind: StatusIndicatorKind; dispose: ReturnType<typeof vi.fn> };

type ModeContext = Record<string, unknown> & {
	activeStatusIndicator: StatusIndicatorStub | undefined;
	clearStatusIndicator: (this: ModeContext, kind?: StatusIndicatorKind) => void;
	session: { isStreaming: boolean };
};

/** The mode surface `handleEvent`'s compaction_end case and the status clear touch. */
function createContext(options: { indicatorKind: StatusIndicatorKind; streaming: boolean }): ModeContext {
	return {
		// The two status methods under test; `turnFor` and the handler read the rest.
		clearStatusIndicator: Reflect.get(InteractiveMode.prototype, "clearStatusIndicator"),
		clearSummaryStatusIndicator: Reflect.get(InteractiveMode.prototype, "clearSummaryStatusIndicator"),
		isInitialized: true,
		footer: { invalidate: vi.fn() },
		programStatus: { handleEvent: vi.fn() },
		compactionClaimed: true,
		compactionModelRefs: new Map(),
		session: { isStreaming: options.streaming },
		settingsManager: { getShowTerminalProgress: () => false },
		sessionManager: {
			buildContextEntries: vi.fn().mockReturnValue([
				{
					type: "compaction",
					id: "compaction",
					parentId: null,
					timestamp: "2025-01-02T00:00:00Z",
					summary: "summary",
					firstKeptEntryId: "kept",
					tokensBefore: 10,
				},
			]),
		},
		chatContainer: new Container(),
		renderSessionEntries: vi.fn(),
		addMessageToChat: vi.fn(),
		addCompactionCostNotice: vi.fn(),
		showError: vi.fn(),
		showStatus: vi.fn(),
		flushCompactionQueue: vi.fn().mockResolvedValue(undefined),
		activeStatusIndicator: { kind: options.indicatorKind, dispose: vi.fn() },
		activeWorkingIndicatorEmbedded: true,
		statusContainer: new Container(),
		setEditorWorkingStatusIndicator: vi.fn().mockReturnValue(true),
		homeSelection: { active: false },
		options: { tuiMode: "regular" },
		ui: { getClearOnShrink: () => false, requestRender: vi.fn(), terminal: { setProgress: vi.fn() } },
	} as ModeContext;
}

async function runCompactionEnd(context: ModeContext): Promise<void> {
	const handleEvent = Reflect.get(InteractiveMode.prototype, "handleEvent") as (
		this: ModeContext,
		event: { type: "compaction_end"; reason: "manual"; result: unknown; aborted: boolean; willRetry: boolean },
	) => Promise<void>;
	await handleEvent.call(context, {
		type: "compaction_end",
		reason: "manual",
		result: { summary: "summary", tokensBefore: 10 },
		aborted: false,
		willRetry: false,
	});
}

describe("compaction status after a tab switch", () => {
	it("clears the working indicator a tab switch painted", async () => {
		const context = createContext({ indicatorKind: "working", streaming: false });
		const indicator = context.activeStatusIndicator!;

		await runCompactionEnd(context);

		expect(indicator.dispose).toHaveBeenCalledTimes(1);
		expect(context.activeStatusIndicator).toBeUndefined();
		expect(context.setEditorWorkingStatusIndicator).toHaveBeenLastCalledWith(undefined);
	});

	it("keeps a working indicator that an agent run still owns", async () => {
		const context = createContext({ indicatorKind: "working", streaming: true });
		const indicator = context.activeStatusIndicator!;

		await runCompactionEnd(context);

		expect(indicator.dispose).not.toHaveBeenCalled();
		expect(context.activeStatusIndicator).toBe(indicator);
	});

	it("clears its own compaction indicator", async () => {
		const context = createContext({ indicatorKind: "compaction", streaming: false });
		const indicator = context.activeStatusIndicator!;

		await runCompactionEnd(context);

		expect(indicator.dispose).toHaveBeenCalledTimes(1);
		expect(context.activeStatusIndicator).toBeUndefined();
	});

	it("leaves an unrelated indicator alone", async () => {
		const context = createContext({ indicatorKind: "retry", streaming: false });
		const indicator = context.activeStatusIndicator!;

		await runCompactionEnd(context);

		expect(indicator.dispose).not.toHaveBeenCalled();
		expect(context.activeStatusIndicator).toBe(indicator);
	});
});
