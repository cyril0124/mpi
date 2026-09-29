/**
 * Queued-message preview boxes.
 *
 * Steer texts park in a box that offers an immediate send (Esc) plus editor
 * recall; follow-up rounds number their dispatch order (each "next" entry ends
 * the adjacent batch group) with SDK-owned continuations appended after them.
 * Each box shows at most five entries and names the total when truncated.
 */
import { type Component, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import type { FollowUpQueueEntry } from "../../../../../core/mixcode/follow-up/runtime-follow-up-queue.ts";
import { theme } from "../../../theme/theme.ts";
import { panel } from "../panel.ts";

/** Entries shown per box; older ones roll off and the count reports the total. */
const MAX_QUEUE_PREVIEW = 5;

export interface QueuePreviewData {
	/** Steer texts: parked (compaction) texts first, SDK-mirrored texts last. */
	steer: readonly string[];
	/** Host follow-up rounds, in dispatch order. */
	followUpRounds: readonly FollowUpQueueEntry[];
	/** SDK follow-up continuations shown after the local rounds. */
	sdkFollowUps: readonly string[];
	/** Paused rounds wait for an explicit /follow-up resume. */
	followUpsPaused: boolean;
	/** Compaction owns the steer queue until compaction_end; Esc cannot flush then. */
	compacting: boolean;
}

/** Shortcuts shown inside the boxes, resolved from the live keybindings. */
export interface QueuePreviewHints {
	/** Dequeue-to-editor key, e.g. "Ctrl+U". */
	dequeue: string;
	/** Key that sends the steer queue now, e.g. "Esc". */
	sendNow: string;
}

/** Dispatch-round number for every follow-up entry, computed before the display cut. */
export function followUpPreviewMessages(data: QueuePreviewData): string[] {
	let round = 0;
	let previousKind: "batch" | "next" | undefined;
	// Each next item ends both adjacent batches, so its neighbors cannot share its round.
	const messages = data.followUpRounds.map((item) => {
		if (item.command || item.kind === "next" || previousKind !== "batch") round += 1;
		previousKind = item.command ? "next" : item.kind;
		const kindLabel = item.command ? "command · " : item.kind === "next" ? "next · " : "";
		return `Round ${round} · ${kindLabel}${item.text}`;
	});
	// SDK companions are not user rounds. The aggregate appends them after the
	// local queue; keep them visible without inventing local dispatch boundaries.
	for (const text of data.sdkFollowUps) {
		messages.push(`SDK · ${text}`);
	}
	return messages;
}

/** Plain render of both queue boxes; empty queues contribute no lines. */
export function renderQueuePreview(data: QueuePreviewData, width: number, hints: QueuePreviewHints): string[] {
	const lines: string[] = [];
	const followUpCount = data.followUpRounds.length + data.sdkFollowUps.length;
	const dualQueues = data.steer.length > 0 && followUpCount > 0;
	if (data.steer.length > 0) {
		lines.push(
			...renderOneQueueBox({
				label: "Steer",
				messages: data.steer,
				width,
				escSendNow: !data.compacting,
				editShortcut: dualQueues ? `${hints.dequeue},S->edit` : `${hints.dequeue}->edit`,
			}),
		);
	}
	if (followUpCount > 0) {
		lines.push(
			...renderOneQueueBox({
				label: "Follow-up",
				messages: followUpPreviewMessages(data),
				width,
				escSendNow: false,
				editShortcut: dualQueues ? `${hints.dequeue},F->edit` : `${hints.dequeue}->edit`,
				statusHint: data.followUpsPaused ? "Paused · /follow-up to resume" : undefined,
			}),
		);
	}
	return lines;
}

function renderOneQueueBox(options: {
	label: string;
	messages: readonly string[];
	width: number;
	escSendNow: boolean;
	editShortcut: string;
	statusHint?: string;
}): string[] {
	const shown = options.messages.slice(-MAX_QUEUE_PREVIEW);
	const title =
		options.messages.length > MAX_QUEUE_PREVIEW
			? `${options.label} (${options.messages.length}, latest ${MAX_QUEUE_PREVIEW})`
			: `${options.label} (${options.messages.length})`;
	const shortcuts = options.escSendNow ? `${options.editShortcut}  Esc->send now` : options.editShortcut;
	const body = [
		theme.fg("dim", `${title}  ${shortcuts}`),
		...(options.statusHint ? [theme.fg("warning", options.statusHint)] : []),
		...shown.map((message) => `↳ ${normalizePendingMessage(message)}`),
	];
	return panel(options.label, body, options.width, { rounded: true });
}

/** Collapse line breaks and runs of spaces; the panel clips the row to its width. */
function normalizePendingMessage(message: string): string {
	return message.replace(/\s+/g, " ").trim();
}

/** TUI component wrapper; re-reads the queue data every render. */
export class QueuePreviewComponent implements Component {
	private readonly getData: () => QueuePreviewData;
	private readonly getHints: () => QueuePreviewHints;

	constructor(getData: () => QueuePreviewData, getHints: () => QueuePreviewHints) {
		this.getData = getData;
		this.getHints = getHints;
	}

	/** Nothing is cached between renders. */
	invalidate(): void {}

	render(width: number): string[] {
		const lines = renderQueuePreview(this.getData(), width, this.getHints());
		// panel() pads to the full width; nothing here may exceed the viewport.
		return lines.map((line) => (visibleWidth(line) > width ? truncateToWidth(line, width, "") : line));
	}
}
