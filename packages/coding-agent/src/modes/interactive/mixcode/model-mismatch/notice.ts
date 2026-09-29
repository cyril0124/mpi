/**
 * The response-reported model notice: some gateways answer with a concrete model
 * other than the one requested, such as a dated snapshot or a routed alias. The
 * transcript says so under that reply instead of leaving the swap invisible.
 */
import type { AssistantMessage } from "@earendil-works/pi-ai/compat";
import { stripTerminalSequences } from "@earendil-works/pi-tui";
import { sanitizeTerminalText } from "../../components/mixcode/terminal-text.ts";

/**
 * A name safe to print: terminal controls removed, whitespace collapsed. Colours
 * and the cursor marker that {@link sanitizeTerminalText} keeps are stripped
 * afterwards, because a model name carries no styling of its own.
 */
function toDisplayName(name: string): string {
	return stripTerminalSequences(sanitizeTerminalText(name)).replace(/\s+/g, " ").trim();
}

/**
 * The `[Model mismatch]` line for a finished assistant message, or undefined when
 * the provider echoed the requested name. Names are compared literally, so a
 * different snapshot or gateway alias produces a notice rather than being
 * classified as a substitution.
 */
export function responseModelNoticeText(message: AssistantMessage): string | undefined {
	const reported = message.responseModel;
	const differsFromRequest =
		message.stopReason !== "pending" &&
		typeof reported === "string" &&
		reported.trim().length > 0 &&
		reported !== message.model;
	if (!differsFromRequest) return undefined;

	const reportedName = toDisplayName(reported);
	if (!reportedName) return undefined;
	return `[Model mismatch] requested ${toDisplayName(message.model)} → returned ${reportedName} · via ${toDisplayName(message.provider)}`;
}
