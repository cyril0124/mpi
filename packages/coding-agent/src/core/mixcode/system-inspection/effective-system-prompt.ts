/**
 * The system prompt a session actually sends, read back from its transcript.
 *
 * `session.systemPrompt` renders the base build options, so sections a
 * `before_agent_start` handler wrote to its per-run copy are missing from it. The
 * transcript keeps them, and it carries what the provider receives.
 */
import { contentText, getCurrentSystemMessage, getSystemMessageText } from "@earendil-works/pi-ai";
import type { AgentSession } from "../../agent-session.ts";
import { type SystemPromptSection, sectionRowsForValue } from "./system-prompt-stats.ts";

/** The prompt the provider receives, with the display rows that decompose it. */
export interface EffectiveSystemPrompt {
	/** Exact text after every recorded section patch is replayed. */
	text: string;
	/** Rows whose texts concatenate to `text`, for the `/system-prompt` footer. */
	sections: SystemPromptSection[];
}

/**
 * Leading system prompt of a session with all recorded section patches replayed,
 * or undefined before the first system message is recorded.
 */
export function getEffectiveSystemPrompt(session: AgentSession): EffectiveSystemPrompt | undefined {
	const message = getCurrentSystemMessage(session.messages);
	if (!message) return undefined;
	const content = contentText(message.content);
	// One row group per section value; a group is split further only for display
	// (one row per project file), and its rows stay contiguous in the footer.
	const groups: SystemPromptSection[][] = [];
	for (const [name, value] of Object.entries(message.sections ?? {})) {
		if (typeof value === "string") groups.push(sectionRowsForValue(name, value));
	}
	return { text: getSystemMessageText(message), sections: displayRows(content, groups) };
}

/**
 * Rows whose texts concatenate to the rendered prompt.
 *
 * `getSystemMessageText` renders the content first, then every non-empty section,
 * joining the parts with a blank line. The separator therefore belongs to the first
 * surviving row of each section, which keeps the footer's rows an exact
 * decomposition of the prompt they describe.
 */
function displayRows(content: string, groups: readonly SystemPromptSection[][]): SystemPromptSection[] {
	const parts: SystemPromptSection[] = content.length === 0 ? [] : [{ name: "content", text: content }];
	for (const group of groups) {
		let groupHasRow = false;
		for (const row of group) {
			if (row.text.length === 0) continue;
			const needsSeparator = !groupHasRow && parts.length > 0;
			parts.push(needsSeparator ? { ...row, text: `\n\n${row.text}` } : row);
			groupHasRow = true;
		}
	}
	return parts;
}
