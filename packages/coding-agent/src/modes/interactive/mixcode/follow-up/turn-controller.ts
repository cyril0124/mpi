import type { AssistantMessage } from "@earendil-works/pi-ai/compat";
import { hasAssistantOutput } from "../../../../core/mixcode/escape-retract.ts";
import type { FollowUpHost } from "../../../../core/mixcode/follow-up/runtime-follow-up.ts";
import { type FollowUpQueueState, pauseFollowUps } from "../../../../core/mixcode/follow-up/runtime-follow-up-queue.ts";
import { scheduleSteerSettleFlush } from "../../../../core/mixcode/follow-up/steer-settle-flush.ts";
import type { SessionManager } from "../../../../core/session-manager.ts";

/** AgentSession satisfies this surface; the host must read its live session. */
export interface TurnSession {
	readonly sessionManager: Pick<SessionManager, "getLeafId">;
}

/** Rendering stays in the host; these getters follow active-session and queue replacement. */
export interface TurnHost {
	readonly session: TurnSession;
	readonly followUpState: FollowUpQueueState;
	readonly followUpHost: FollowUpHost;
	endInterruptArm(): void;
	checkShutdownRequested(): Promise<void>;
	flushCompactionQueue(options: { willRetry: boolean }): Promise<void>;
}

/** Owns retract markers and failure reactions at explicit transcript event checkpoints. */
export class TurnController {
	private readonly host: TurnHost;
	/** Undefined means no recorded run; null means it began at an empty branch. */
	runStartLeafId: string | null | undefined;
	/** Sticky until the next run or mounted-session reset, including hidden thinking output. */
	runVisibleOutput = false;

	constructor(host: TurnHost) {
		this.host = host;
	}

	/** Call after clearing pending tools, before the prompt's message_end persists it. */
	onAgentStart(): void {
		this.host.followUpState.followUpRunFailed = false;
		this.runStartLeafId = this.host.session.sessionManager.getLeafId();
		this.runVisibleOutput = false;
		this.host.endInterruptArm();
	}

	/** Call at assistant start, or after a streaming content update and before tool components. */
	onAssistantOutput(message: AssistantMessage): void {
		if (!this.runVisibleOutput) this.runVisibleOutput = hasAssistantOutput(message);
	}

	/** An entry without a renderer or content does not block retract. */
	onCustomEntryRendered(rendered: boolean): void {
		if (rendered) this.runVisibleOutput = true;
	}

	/** A displayable custom message counts as visible output before its component is constructed. */
	onCustomMessageStarting(display: boolean): void {
		if (display) this.runVisibleOutput = true;
	}

	/** Call before looking up or constructing the tool execution component. */
	onToolExecutionStart(): void {
		this.runVisibleOutput = true;
	}

	/** Call after final content and the response-model notice, before tool errors; returns whether the run failed. */
	onAssistantMessageFinalized(message: AssistantMessage): boolean {
		const failed = message.stopReason === "aborted" || message.stopReason === "error";
		if (failed) this.host.followUpState.followUpRunFailed = true;
		return failed;
	}

	/** Call after clearing terminal progress, before clearing the working indicator and tools. */
	onAgentEnd(): void {
		this.runStartLeafId = undefined;
		this.host.endInterruptArm();
	}

	/** Pause failed deferred rounds, schedule leftover steering, then honor shutdown. */
	async onAgentSettled(): Promise<void> {
		const state = this.host.followUpState;
		if (state.followUpRunFailed) pauseFollowUps(state);
		scheduleSteerSettleFlush(state, this.host.followUpHost);
		await this.host.checkShutdownRequested();
	}

	/** Clear markers on a mounted-tab change; the host disarms its interrupt first. */
	resetRunMarkers(): void {
		this.runStartLeafId = undefined;
		this.runVisibleOutput = false;
	}

	/** Call after clearing retry status and before reporting its final error. */
	onAutoRetryEnd(success: boolean): void {
		if (!success) this.host.followUpState.followUpRunFailed = true;
	}

	/** Pause retained rounds inside the compaction error branch, before its visible effects. */
	onCompactionFailure(): void {
		const state = this.host.followUpState;
		state.followUpRunFailed = true;
		pauseFollowUps(state);
	}

	/** Flush after outcome handling returns; rendering exceptions never reach this checkpoint. */
	onCompactionOutcomeRendered(willRetry: boolean): void {
		void this.host.flushCompactionQueue({ willRetry });
	}
}
