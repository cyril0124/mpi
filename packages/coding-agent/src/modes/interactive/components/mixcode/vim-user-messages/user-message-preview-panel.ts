/**
 * Panel listing the chat's user messages while vim mode walks them with
 * `right` / `shift+right`. The body comes from the preview model; this component
 * frames it and paints the selected row.
 */
import type { Component } from "@earendil-works/pi-tui";
import {
	USER_MESSAGE_PREVIEW_MIN_WIDTH,
	USER_MESSAGE_PREVIEW_TITLE,
	USER_MESSAGE_PREVIEW_WIDTH,
} from "../../../../../core/mixcode/vim/user-message-preview.ts";
import { panel } from "../panel.ts";

export class UserMessagePreviewPanel implements Component {
	private readonly lines: readonly string[];
	private readonly highlightedIndex: number;

	constructor(lines: readonly string[], highlightedIndex: number) {
		this.lines = lines;
		this.highlightedIndex = highlightedIndex;
	}

	/** The rows are fixed when the panel is created. */
	invalidate(): void {}

	render(width: number): string[] {
		const boxWidth = Math.max(
			USER_MESSAGE_PREVIEW_MIN_WIDTH,
			Math.min(USER_MESSAGE_PREVIEW_WIDTH, Math.floor(width)),
		);
		return panel(USER_MESSAGE_PREVIEW_TITLE, [...this.lines], boxWidth, {
			rounded: true,
			backgroundColor: "toolPendingBg",
			backgroundScope: "content",
			rowBackground: (row) => (row === this.highlightedIndex ? "selectedBg" : "toolPendingBg"),
		});
	}
}
