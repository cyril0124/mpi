/**
 * The fullscreen mouse-selection surfaces.
 *
 * pi-tui runs the drag, the highlight and the copy; this module tells it where a drag is
 * allowed to start, how each surface's copied text is cleaned, how a selected line is
 * painted, and that the highlight goes away with the button. Selection is restricted to
 * the chat transcript, the prompt card and the notice panel, so a drag that starts on the tab
 * bar, the footer or a dock widget keeps its other meaning instead of selecting chrome.
 */
import type { Component, TuiSelectionOptions, TuiSelectionSurface } from "@earendil-works/pi-tui";
import {
	type MouseSelectionSurface,
	normalizeSelectionText,
} from "../../../../core/mixcode/selection/chat-selection.ts";
import { theme } from "../../theme/theme.ts";

export interface MouseSelectionSources {
	/** The transcript scroll view; undefined while another surface owns the viewport. */
	chat: () => Component | undefined;
	/** The prompt card's container. */
	input: () => Component | undefined;
	/** The notice panel, while it is open. */
	notice: () => Component | undefined;
	/** Whether a modal overlay owns the pointer. */
	modalOpen: () => boolean;
	/**
	 * Whether a transcript content row lies inside a block that carries the pointer cue. The cue
	 * fills those cells with the same background the selection uses, so the selection adds an
	 * underline there and only there.
	 */
	cueRow: (row: number) => boolean;
}

/** Options that scope the fullscreen selection to the fork's surfaces. */
export function createMouseSelectionOptions(sources: MouseSelectionSources): TuiSelectionOptions {
	return {
		surfaces: () => {
			const notice = sources.notice();
			const noticeSurface: TuiSelectionSurface[] = notice ? [{ component: notice, kind: "notice" }] : [];
			if (sources.modalOpen()) return noticeSurface;
			const chat = sources.chat();
			const input = sources.input();
			// The notice floats over the transcript and the prompt card, so it comes first: a drag
			// inside it must resolve to the notice, not to the surface underneath.
			return [
				...noticeSurface,
				...(chat ? [{ component: chat, kind: "chat" satisfies MouseSelectionSurface }] : []),
				...(input ? [{ component: input, kind: "input" satisfies MouseSelectionSurface }] : []),
			];
		},
		normalizeText: normalizeSelectionText,
		// Inside a cued block the cue fills the same cells with the same background, so the selection
		// underlines there to stay readable; everywhere else it is the plain selection background.
		highlight: (text, line) =>
			line.kind === "chat" && sources.cueRow(line.row)
				? theme.bg("selectedBg", `\x1b[4m${text}\x1b[24m`)
				: theme.bg("selectedBg", text),
		// The highlight lives only as long as the drag: the release drops it, so nothing stays
		// marked on screen once the pointer is up.
		clearOnRelease: true,
	};
}
