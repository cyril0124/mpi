import { fauxAssistantMessage, fauxThinking, fauxToolCall } from "@earendil-works/pi-ai";
import { Container } from "@earendil-works/pi-tui";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentSessionEvent } from "../../src/core/agent-session.ts";
import type { FollowUpHost, FollowUpSession } from "../../src/core/mixcode/follow-up/runtime-follow-up.ts";
import { createFollowUpQueueState } from "../../src/core/mixcode/follow-up/runtime-follow-up-queue.ts";
import { type SessionEntry, SessionManager } from "../../src/core/session-manager.ts";
import { InteractiveMode } from "../../src/modes/interactive/interactive-mode.ts";
import { initTheme } from "../../src/modes/interactive/theme/theme.ts";

/** Build a host whose event handler effects are recorded in call order. */
function createEventHost(prototype = false) {
	const trace: string[] = [];
	const state = createFollowUpQueueState();
	const sessionManager = SessionManager.inMemory();
	const steering: string[] = [];
	const session: FollowUpSession & { sessionManager: SessionManager; retryAttempt: number } = {
		sessionManager,
		retryAttempt: 2,
		isIdle: true,
		isStreaming: false,
		isCompacting: false,
		waitForIdle: async () => {
			trace.push(`wait-idle:${state.followUpsPaused}`);
		},
		subscribe: () => () => {},
		getSteeringMessages: () => steering,
		getFollowUpMessages: () => [],
		removeQueuedMessages: (_kind, texts) => {
			steering.splice(0, steering.length);
			return texts.map((text) => ({ message: text, text }));
		},
		restoreQueuedMessages: (_kind, removed) => steering.push(...removed.map((entry) => entry.text)),
	};
	const followUpHost: FollowUpHost = {
		session,
		promptTurn: async (text, accepted) => {
			trace.push(`prompt:${text}`);
			accepted("started");
		},
		runQueuedCommand: async () => {},
		isQueuedCommandText: () => false,
		isCompactionClaimed: () => false,
		onQueueChanged: () => {},
		onQueueError: (error) => trace.push(`queue-error:${String(error)}`),
		isDiscarded: () => false,
	};
	const tool = {
		updateArgs: vi.fn(() => trace.push(`tool-args:${host.runVisibleOutput}`)),
		updateResult: vi.fn(() => trace.push(`tool-result:${state.followUpRunFailed}`)),
		setArgsComplete: vi.fn(() => trace.push("tool-complete")),
		markExecutionStarted: vi.fn(() => trace.push(`tool-start:${host.runVisibleOutput}`)),
	};
	const streamingComponent = {
		updateContent: vi.fn((_message: unknown, streaming: boolean) =>
			trace.push(`content:${streaming}:${host.runVisibleOutput}:${state.followUpRunFailed}`),
		),
	};
	const host = {
		isInitialized: true,
		runStartLeafId: undefined as string | null | undefined,
		runVisibleOutput: false,
		followUpState: state,
		followUpHost,
		session,
		sessionManager,
		pendingTools: new Map<string, typeof tool>(),
		streamingComponent: undefined as typeof streamingComponent | undefined,
		entriesRenderedByBoundaryCompaction: new Set<string>(),
		compactionClaimed: false,
		compactionModelRefs: new Map([[session, "summary/model"]]),
		footer: { invalidate: () => {} },
		settingsManager: { getShowTerminalProgress: () => true },
		ui: {
			requestRender: () => {},
			terminal: { setProgress: (active: boolean) => trace.push(`progress:${active}:${host.runStartLeafId}`) },
		},
		chatContainer: new Container(),
		endInterruptArm: () => trace.push(`disarm:${host.runStartLeafId}:${host.runVisibleOutput}`),
		startStreamingMessage: () => {
			trace.push(`stream-start:${host.runVisibleOutput}`);
			host.streamingComponent = streamingComponent;
		},
		addCustomEntryToChat: (entry: Extract<SessionEntry, { type: "custom" }>) => {
			trace.push(`entry-render:${host.runVisibleOutput}`);
			return entry.customType === "visible";
		},
		addMessageToChat: () => trace.push(`message-render:${host.runVisibleOutput}:${state.followUpsPaused}`),
		maybeShowResponseModelNotice: () => trace.push(`model-notice:${state.followUpRunFailed}`),
		maybeSuggestBugReport: () => trace.push(`bug-notice:${state.followUpRunFailed}`),
		clearStatusIndicator: (kind: string) =>
			trace.push(
				`status-clear:${kind}:${host.runStartLeafId}:${state.followUpRunFailed}:${host.compactionClaimed}:${host.compactionModelRefs.size}`,
			),
		checkShutdownRequested: vi.fn(async () => {
			trace.push(`shutdown:${state.followUpsPaused}`);
		}),
		flushCompactionQueue: vi.fn(async (options: { willRetry: boolean }) => {
			trace.push(`flush:${options.willRetry}:${state.followUpsPaused}`);
		}),
		showError: (message: string) =>
			trace.push(`error:${message}:${state.followUpsPaused}:${state.followUpRunFailed}`),
		showStatus: (message: string) => trace.push(`status:${message}`),
	};
	if (prototype) Object.setPrototypeOf(host, InteractiveMode.prototype);
	const handleEvent = Reflect.get(InteractiveMode.prototype, "handleEvent") as (
		this: typeof host,
		event: AgentSessionEvent,
	) => Promise<void>;
	return { host, state, trace, steering, tool, event: (event: AgentSessionEvent) => handleEvent.call(host, event) };
}

afterEach(() => vi.restoreAllMocks());

describe("interactive host turn event ordering", () => {
	it.each([false, true])(
		"keeps run markers on the host and settles a failed turn (prototype=%s)",
		async (prototype) => {
			const { host, state, trace, steering, tool, event } = createEventHost(prototype);
			const leaf = host.sessionManager.appendMessage({ role: "user", content: "previous turn", timestamp: 1 });
			host.runVisibleOutput = true;
			state.followUpRunFailed = true;
			vi.spyOn(host.pendingTools, "clear").mockImplementation(() => {
				trace.push(`tools-clear:${host.runVisibleOutput}:${state.followUpRunFailed}`);
				Map.prototype.clear.call(host.pendingTools);
			});
			await event({ type: "agent_start" });
			expect(trace).toEqual(["tools-clear:true:true", `disarm:${leaf}:false`]);
			expect(host.runStartLeafId).toBe(leaf);
			trace.length = 0;

			await event({ type: "message_start", message: fauxAssistantMessage(fauxThinking("hidden thinking")) });
			expect(trace).toEqual(["stream-start:true"]);
			host.runVisibleOutput = false;
			host.pendingTools.set("read-id", tool);
			trace.length = 0;
			await event({
				type: "message_update",
				message: fauxAssistantMessage(fauxToolCall("read", { path: "a.ts" }, { id: "read-id" })),
				assistantMessageEvent: { type: "start", partial: fauxAssistantMessage("") },
			});
			expect(trace).toEqual(["content:true:false:false", "tool-args:true"]);

			host.runVisibleOutput = false;
			trace.length = 0;
			vi.spyOn(host.pendingTools, "get").mockImplementation((id) => {
				trace.push(`tool-lookup:${host.runVisibleOutput}`);
				return Map.prototype.get.call(host.pendingTools, id) as typeof tool | undefined;
			});
			await event({ type: "tool_execution_start", toolCallId: "read-id", toolName: "read", args: {} });
			expect(trace).toEqual(["tool-lookup:true", "tool-start:true"]);
			trace.length = 0;
			await event({ type: "message_end", message: fauxAssistantMessage("", { stopReason: "aborted" }) });
			expect(trace).toEqual([
				"content:false:true:false",
				"model-notice:false",
				"tool-result:true",
				"tools-clear:true:true",
				"bug-notice:true",
			]);
			expect(tool.updateResult).toHaveBeenCalledWith({
				content: [{ type: "text", text: "Aborted after 2 retry attempts" }],
				isError: true,
			});
			trace.length = 0;
			await event({ type: "agent_end", messages: [], willRetry: false });
			expect(trace).toEqual([
				`progress:false:${leaf}`,
				"disarm:undefined:true",
				"status-clear:working:undefined:true:false:1",
				"tools-clear:true:true",
			]);
			state.followUpQueue.push({ text: "deferred", kind: "next" });
			state.pendingSteer.push("steer after failure");
			state.queuedSteerCount = 1;
			steering.push("steer after failure");
			trace.length = 0;
			await event({ type: "agent_settled", aborted: false });
			expect(trace.slice(0, 2)).toEqual(["wait-idle:true", "shutdown:true"]);
			await vi.waitFor(() => expect(trace).toContain("prompt:steer after failure"));
			expect(state.followUpQueue).toEqual([{ text: "deferred", kind: "next" }]);
			expect(state.followUpsPaused).toBe(true);
		},
	);

	it("uses replacement session, failure state and steering host after lazy construction", async () => {
		const current = createEventHost(true);
		const replacement = createEventHost();
		current.host.runStartLeafId = null;
		current.host.runVisibleOutput = true;
		current.host.pendingTools.set("tool", current.tool);
		await current.event({ type: "tool_execution_start", toolCallId: "tool", toolName: "read", args: {} });
		expect(current.host.runStartLeafId).toBeNull();
		const leaf = replacement.host.sessionManager.appendMessage({
			role: "user",
			content: "new history",
			timestamp: 1,
		});
		current.state.followUpRunFailed = true;
		replacement.state.followUpRunFailed = true;
		current.host.session = replacement.host.session;
		current.host.followUpState = replacement.state;
		current.host.followUpHost = replacement.host.followUpHost;
		await current.event({ type: "agent_start" });
		expect(current.host.runStartLeafId).toBe(leaf);
		expect(current.host.runVisibleOutput).toBe(false);
		expect(current.state.followUpRunFailed).toBe(true);
		expect(replacement.state.followUpRunFailed).toBe(false);

		await current.event({ type: "message_start", message: fauxAssistantMessage("") });
		await current.event({ type: "message_end", message: fauxAssistantMessage("", { stopReason: "error" }) });
		replacement.state.followUpQueue.push({ text: "replacement round", kind: "next" });
		replacement.state.pendingSteer.push("replacement steering");
		replacement.state.queuedSteerCount = 1;
		replacement.steering.push("replacement steering");
		await current.event({ type: "agent_settled", aborted: false });
		expect(replacement.trace[0]).toBe("wait-idle:true");
		await vi.waitFor(() => expect(replacement.trace).toContain("prompt:replacement steering"));
		expect(replacement.state.followUpsPaused).toBe(true);
		expect(current.state.followUpsPaused).toBe(false);
	});

	it("counts custom output after entry rendering and before displayed message rendering", async () => {
		const { host, trace, event } = createEventHost();
		for (const customType of ["hidden", "visible"]) {
			await event({
				type: "entry_appended",
				entry: {
					type: "custom",
					id: customType,
					parentId: null,
					timestamp: "2025-01-01",
					customType,
					data: {},
				},
			});
			expect(host.runVisibleOutput).toBe(customType === "visible");
		}
		expect(trace).toEqual(["entry-render:false", "entry-render:false"]);
		host.runVisibleOutput = false;
		trace.length = 0;
		await event({
			type: "message_start",
			message: {
				role: "custom",
				customType: "hidden",
				content: "hidden",
				display: false,
				timestamp: 1,
			},
		});
		await event({
			type: "message_start",
			message: {
				role: "custom",
				customType: "visible",
				content: "visible",
				display: true,
				timestamp: 2,
			},
		});
		expect(trace).toEqual(["message-render:false:false", "message-render:true:false"]);
	});

	it.each(["manual", "overflow"] as const)(
		"releases host compaction state before pausing %s failure and flushing",
		async (reason) => {
			initTheme("dark");
			const { host, state, trace, event } = createEventHost();
			host.compactionClaimed = true;
			state.followUpQueue.push({ text: "retained", kind: "next" });
			await event({
				type: "compaction_end",
				reason,
				result: undefined,
				aborted: false,
				willRetry: true,
				errorMessage: "failed",
			});
			expect(trace.slice(0, 2)).toEqual([
				"progress:false:undefined",
				"status-clear:compaction:undefined:undefined:false:0",
			]);
			if (reason === "manual") expect(trace[2]).toBe("error:failed:true:true");
			else expect(host.chatContainer.render(80).join("\n")).toContain("failed");
			expect(trace.at(-1)).toBe("flush:true:true");
			expect(state.followUpRunFailed).toBe(true);
		},
	);

	it("honors abort precedence and prevents flush when successful compaction rendering throws", async () => {
		const { host, state, trace, event } = createEventHost();
		const result = { summary: "summary", firstKeptEntryId: "kept", tokensBefore: 1000 };
		await event({
			type: "compaction_end",
			reason: "manual",
			result,
			aborted: true,
			willRetry: false,
			errorMessage: "ignored",
		});
		expect(trace.slice(-2)).toEqual(["error:Compaction cancelled:false:undefined", "flush:false:false"]);
		expect(state.followUpRunFailed).toBeUndefined();
		host.flushCompactionQueue.mockClear();
		await expect(
			event({
				type: "compaction_end",
				reason: "manual",
				result,
				aborted: false,
				willRetry: false,
				errorMessage: "ignored",
			}),
		).rejects.toThrow("Completed compaction is missing from the session context");
		expect(host.flushCompactionQueue).not.toHaveBeenCalled();
		expect(state.followUpsPaused).toBe(false);
	});

	it("marks retry failure after clearing retry status and before reporting it", async () => {
		const { state, trace, event } = createEventHost();
		await event({ type: "auto_retry_end", success: false, attempt: 3, finalError: "failed" });
		expect(trace).toEqual([
			"status-clear:retry:undefined:undefined:false:1",
			"error:Retry failed after 3 attempts: failed:false:true",
		]);
		expect(state.followUpRunFailed).toBe(true);
	});
});
