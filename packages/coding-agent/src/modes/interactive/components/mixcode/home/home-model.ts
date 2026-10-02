/**
 * Pure helpers for the MixCode Home page: text normalization, relative times,
 * preview-message selection, and the caches that keep a Home frame cheap.
 *
 * Rendering lives in `home-view.ts`; nothing here touches the TUI.
 */
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { contentText } from "@earendil-works/pi-ai";
import { stripTerminalSequences, truncateToWidth, visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import { bashExecutionToText } from "../../../../../core/messages.ts";
import type { TabColorName, TabLoadingPhase, TabStatus } from "../../../../../core/mixcode/multi-tab/types.ts";
import { formatTokens } from "../../../components/footer.ts";
import { formatSecondCount, padLine } from "../layout-text.ts";

/** Longest transcript text the card summary keeps, in UTF-16 code units. */
export const HOME_PREVIEW_TEXT_LIMIT = 16_384;

/** Roster card height including its trailing blank row. */
export const AGENT_CARD_HEIGHT = 4;

/** One chat line as the Home previews need it. */
export interface HomeChatMessage {
	role: "user" | "assistant" | "tool" | "system";
	text: string;
}

/** One roster card. Built by the interactive mode from an `AgentTab`. */
export interface HomeCard {
	id: string;
	title: string;
	status: TabStatus;
	unread: boolean;
	color?: TabColorName;
	/** What a `loading` card is waiting on; the chip names this phase. */
	loadingPhase?: TabLoadingPhase;
	/** ISO stamp of the current run; drives the spinner and `running <elapsed>`. */
	workingStartedAt?: string;
	/** ISO stamp of the last finished turn; drives the `Ns ago` meta suffix. */
	lastWorkedAt?: string;
	/** Working directory of the tab, shown in the conversation preview heading. */
	workdir?: string;
	/** Model label, already reduced to its last `/` segment. */
	model?: string;
	/** Context tokens, or null when unknown (e.g. right after compaction). */
	tokens: number | null;
	contextWindow: number;
}

/** A preview row: a message, or one collapsed group of consecutive tool calls. */
export type HomePreviewRow = { role: "user" | "assistant"; text: string } | { role: "tools"; count: number };

// ---------------------------------------------------------------------------
// Agent messages to preview rows
// ---------------------------------------------------------------------------

/** Longest tail of a session the Home previews read. */
export const HOME_MESSAGE_LIMIT = 100;

/** Per-tab Home data: the transcript tail, its length, and its context usage. */
export interface HomeSnapshot {
	source: readonly AgentMessage[];
	length: number;
	/** Newest message object and text, so an in-place streaming update invalidates. */
	newest: AgentMessage | undefined;
	newestText: string;
	messages: HomeChatMessage[];
	tokens: number | null;
	contextWindow: number;
}

/**
 * One message in the Home preview shape, or undefined for roles the previews do
 * not show. `toolResult` and a `!command` run both read as a tool row.
 */
export function homePreviewOf(message: AgentMessage): HomeChatMessage | undefined {
	switch (message.role) {
		case "user":
		case "assistant":
		case "system":
			return { role: message.role, text: contentText(message.content) };
		case "toolResult":
			return { role: "tool", text: contentText(message.content) };
		case "bashExecution":
			return { role: "tool", text: bashExecutionToText(message) };
		default:
			return undefined;
	}
}

/**
 * Map the newest {@link HOME_MESSAGE_LIMIT} messages to the Home preview shape.
 * The previews read the tail, and extracting text from a long session is the
 * cost this avoids.
 */
export function mapHomeMessages(messages: readonly AgentMessage[]): HomeChatMessage[] {
	const tail = messages.length > HOME_MESSAGE_LIMIT ? messages.slice(-HOME_MESSAGE_LIMIT) : messages;
	const mapped: HomeChatMessage[] = [];
	for (const message of tail) {
		const preview = homePreviewOf(message);
		if (preview) mapped.push(preview);
	}
	return mapped;
}

// ---------------------------------------------------------------------------
// Text normalization
// ---------------------------------------------------------------------------

/**
 * Collapse transcript text to one line: terminal sequences stripped, whitespace
 * runs folded to single spaces, and only the newest {@link HOME_PREVIEW_TEXT_LIMIT}
 * code units of a long message kept, so a multi-megabyte reply cannot enter a
 * width cache.
 */
export function singleLinePreview(text: string | undefined): string {
	const source = text ?? "";
	const bounded = source.length > HOME_PREVIEW_TEXT_LIMIT ? source.slice(-HOME_PREVIEW_TEXT_LIMIT) : source;
	const plain = stripTerminalSequences(bounded).trim();
	// Avoid rebuilding already-normalized large strings on every streaming update.
	return /[^\S ]| {2}/u.test(plain) ? plain.replace(/\s+/g, " ") : plain;
}

// ---------------------------------------------------------------------------
// Time formatting
// ---------------------------------------------------------------------------

/** Coarse run length: `7s`, `2m 05s`, `1h 02m 03s`; an invalid stamp counts as zero elapsed. */
export function formatElapsed(startedAt: string | undefined, now: number): string {
	const start = startedAt ? Date.parse(startedAt) : Number.NaN;
	const totalSeconds = Number.isFinite(start) ? Math.max(0, Math.floor((now - start) / 1000)) : 0;
	return formatSecondCount(totalSeconds);
}

/** Relative age of a past stamp: `12s ago`, `3m ago`, `2h ago`, `4d ago`. */
export function formatRelativeAge(at: string | undefined, now: number): string {
	if (!at) return "";
	const parsed = Date.parse(at);
	if (!Number.isFinite(parsed)) return "";
	const seconds = Math.max(0, Math.floor((now - parsed) / 1000));
	if (seconds < 60) return `${seconds}s ago`;
	if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
	if (seconds < 86_400) return `${Math.floor(seconds / 3600)}h ago`;
	return `${Math.floor(seconds / 86_400)}d ago`;
}

/** `<used>/<limit>`, where an unknown used count prints `?`. */
export function formatContextUsage(tokens: number | null, contextWindow: number): string {
	const limit = contextWindow > 0 ? formatTokens(contextWindow) : "?";
	return `${tokens === null ? "?" : formatTokens(tokens)}/${limit}`;
}

// ---------------------------------------------------------------------------
// Preview selection
// ---------------------------------------------------------------------------

/**
 * Newest-first walk turned back into chronological order. Consecutive tool
 * calls collapse into one counted row *before* the limit check, so the count
 * stays exact even when the group is the oldest visible row.
 */
export function previewRows(messages: readonly HomeChatMessage[], maxMessages: number): HomePreviewRow[] {
	const rows: HomePreviewRow[] = [];
	for (let index = messages.length - 1; index >= 0; index--) {
		const message = messages[index]!;
		if (message.role !== "user" && message.role !== "assistant" && message.role !== "tool") continue;
		const previous = rows[rows.length - 1];
		if (message.role === "tool" && previous?.role === "tools") {
			previous.count += 1;
			continue;
		}
		if (rows.length >= maxMessages) break;
		rows.push(message.role === "tool" ? { role: "tools", count: 1 } : { role: message.role, text: message.text });
	}
	return rows.reverse();
}

/** `<dots>  <count>`: one dot per collapsed call, clipped to `width`. */
export function formatToolCallPreview(count: number, width: number): string {
	const countText = String(count);
	const dots = "·".repeat(Math.min(count, Math.max(0, width - countText.length - 2)));
	return truncateToWidth(`${dots}  ${countText}`, width, "");
}

/** Newest message matching `predicate`, or undefined. */
function lastMatching(
	messages: readonly HomeChatMessage[],
	predicate: (message: HomeChatMessage) => boolean,
): HomeChatMessage | undefined {
	for (let index = messages.length - 1; index >= 0; index--) {
		const message = messages[index]!;
		if (predicate(message)) return message;
	}
	return undefined;
}

/**
 * Newest chat text to show on a card. Prefers assistant output, then a system
 * line, then the user's own text; `No output yet` when nothing matches.
 */
export function latestOutputPreview(messages: readonly HomeChatMessage[], width: number): string {
	const predicates: Array<(message: HomeChatMessage) => boolean> = [
		(message) => message.role === "assistant",
		(message) => message.role === "system",
		(message) => message.role === "user",
	];
	for (const predicate of predicates) {
		const latest = lastMatching(messages, predicate);
		if (!latest) continue;
		const text = singleLinePreview(latest.text);
		if (!text) continue;
		return truncateToWidth(text, width);
	}
	return "No output yet";
}

// ---------------------------------------------------------------------------
// Per-tab caches (the Home page re-renders every frame)
// ---------------------------------------------------------------------------

/**
 * One cached value per tab, keyed by the width it was computed at plus the
 * transcript tail it was computed from, so a streaming tail invalidates and an
 * unchanged frame reuses the result.
 */
interface PreviewCacheEntry<T> {
	width: number;
	/** Second layout input, for values that also depend on a row count. */
	rows: number | undefined;
	messageCount: number;
	lastText: string;
	value: T;
}

function cachedPreview<T>(
	cache: Map<string, PreviewCacheEntry<T>>,
	tabId: string,
	messages: readonly HomeChatMessage[],
	key: { width: number; rows?: number },
	compute: () => T,
): T {
	const lastText = messages[messages.length - 1]?.text ?? "";
	const cached = cache.get(tabId);
	if (
		cached &&
		cached.width === key.width &&
		cached.rows === key.rows &&
		cached.messageCount === messages.length &&
		cached.lastText === lastText
	) {
		return cached.value;
	}
	const value = compute();
	cache.set(tabId, { width: key.width, rows: key.rows, messageCount: messages.length, lastText, value });
	return value;
}

const summaryCache = new Map<string, PreviewCacheEntry<string>>();
const blockCache = new Map<string, PreviewCacheEntry<string[]>>();

/** Drop a closed tab's cached previews so the maps stay bounded by open tabs. */
export function clearHomeTabCache(tabId: string): void {
	summaryCache.delete(tabId);
	blockCache.delete(tabId);
}

/** One tab's newest output line, recomputed only when its transcript tail moved. */
export function cachedOutputPreview(
	tabId: string,
	messages: readonly HomeChatMessage[],
	width: number,
	compute: () => string,
): string {
	return cachedPreview(summaryCache, tabId, messages, { width }, compute);
}

/** One tab's wrapped preview block, recomputed only when its tail or row count moved. */
export function cachedPreviewBlock(
	tabId: string,
	messages: readonly HomeChatMessage[],
	width: number,
	rows: number,
	compute: () => string[],
): string[] {
	return cachedPreview(blockCache, tabId, messages, { width, rows }, compute);
}

/** Hard-wrap one preview message to `width`, keeping its newest `rows` lines. */
export function wrapPreviewTail(text: string, width: number, rows: number): string[] {
	// `slice(-0)` is `slice(0)`, so a zero-row request would return every line.
	if (rows <= 0) return [];
	return wrapTextWithAnsi(singleLinePreview(text), width).slice(-rows);
}

// ---------------------------------------------------------------------------
// Layout primitives
// ---------------------------------------------------------------------------

/** Gap between the left and right fragments of {@link lineEnds}. */
const LINE_END_GAP = "  ";
/** Columns {@link lineEnds} keeps for the left fragment when a right one is shown. */
const LINE_END_MIN_LEFT = 2;

/**
 * Place a right-aligned fragment after a left one without letting it displace
 * the left text; the fragment is dropped when it cannot fit with a gap.
 */
export function lineEnds(left: string, right: string, width: number): string {
	const gapWidth = visibleWidth(LINE_END_GAP);
	if (!right || visibleWidth(right) + gapWidth + LINE_END_MIN_LEFT > width) return padLine(left, width);
	const leftWidth = Math.max(0, width - visibleWidth(right) - gapWidth);
	return `${padLine(truncateToWidth(left, leftWidth, "…"), leftWidth)}${LINE_END_GAP}${right}`;
}

/** Two-column join used by the wide layout; the separator is one styled bar. */
export function joinColumns(
	left: readonly string[],
	right: readonly string[],
	leftWidth: number,
	rightWidth: number,
	separator: string,
): string[] {
	const rows = Math.max(left.length, right.length);
	const lines: string[] = [];
	for (let row = 0; row < rows; row++) {
		lines.push(`${padLine(left[row] ?? "", leftWidth)} ${separator} ${padLine(right[row] ?? "", rightWidth)}`);
	}
	return lines;
}
