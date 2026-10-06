/**
 * Escape interrupt rules: the confirm window in front of the interrupt key, and
 * the retract rule behind it.
 */
import { contentText } from "@earendil-works/pi-ai";
import type { AssistantMessage } from "@earendil-works/pi-ai/compat";
import type { SessionEntry } from "../session-manager.ts";

/** How long the confirming press may follow the first one, in milliseconds. */
export const INTERRUPT_ARM_WINDOW_MS = 1_000;

/**
 * True once the run's assistant message carries anything the transcript shows:
 * text, thinking, or a tool call. A block holding nothing but whitespace counts,
 * because the assistant message is on screen by then; an empty block does not.
 */
export function hasAssistantOutput(message: AssistantMessage): boolean {
	return message.content.some((block) => {
		if (block.type === "text") return block.text.length > 0;
		if (block.type === "thinking") return block.thinking.length > 0;
		return true;
	});
}

/**
 * The user message a retract takes back, or undefined when the run must not be
 * retracted. A run is retractable when it produced no visible output and the
 * branch's last user message was appended after the leaf the run start recorded:
 * a run started from a custom message has no user message of its own, and
 * rewinding to an older one would drop completed turns.
 *
 * `runStartLeafId` is `undefined` when no run is recorded and `null` when the run
 * started from an empty branch. A recorded leaf that has left the branch - a
 * rewind or a compaction - makes the run's own message unknowable, so the run is
 * refused.
 */
export function retractableUserMessage(
	branch: readonly SessionEntry[],
	runStartLeafId: string | null | undefined,
	runVisibleOutput: boolean,
): { id: string; text: string } | undefined {
	if (runStartLeafId === undefined || runVisibleOutput) return undefined;
	let startIndex = -1;
	if (runStartLeafId !== null) {
		startIndex = branch.findIndex((entry) => entry.id === runStartLeafId);
		if (startIndex === -1) return undefined;
	}
	for (let index = branch.length - 1; index >= 0; index -= 1) {
		const entry = branch[index];
		if (entry?.type !== "message" || entry.message.role !== "user") continue;
		if (index <= startIndex) return undefined;
		return { id: entry.id, text: contentText(entry.message.content, "") };
	}
	return undefined;
}
