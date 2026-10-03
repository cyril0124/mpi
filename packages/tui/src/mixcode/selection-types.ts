import type { Component } from "../tui.ts";

/** A host surface a mouse drag may select text inside. */
export interface TuiSelectionSurface {
	/** The component whose committed box bounds the selection. */
	component: Component;
	/** Opaque host token, handed back to `normalizeText`. */
	kind: string;
}

/** Where one painted line of a selection sits: the surface it belongs to and its row inside it. */
export interface TuiSelectionLine {
	/** `kind` of the surface the selection started in. */
	kind: string;
	/**
	 * Row inside that surface: the content row within a scroll view, counting from the top of the
	 * scrolled document, and the screen row on a plain surface.
	 */
	row: number;
}

/** How a host narrows and styles the application-owned text selection. */
export interface TuiSelectionOptions {
	/**
	 * Selectable surfaces in priority order. A press that lands in none of them starts no
	 * selection, leaving the event to the component under the pointer. Omit for a screen-wide
	 * selection.
	 */
	surfaces?: () => readonly TuiSelectionSurface[];
	/** Rewrite the copied text for the surface kind it came from. */
	normalizeText?: (text: string, kind: string) => string;
	/**
	 * Paint the selected cells of one line. The wrap's opening sequence is re-inserted after every
	 * SGR inside the slice, so an inner reset cannot drop it. The line is named so a host can vary
	 * the wrap by row, e.g. to underline a cell whose row already carries another cue. Defaults to
	 * reverse video.
	 */
	highlight?: (text: string, line: TuiSelectionLine) => string;
	/**
	 * Drop the highlight on the release that copies the selection, so a drag shows a selection only
	 * while the button is down. A release with copy-on-select off never clears, leaving the selection
	 * up for the copy command. Off by default.
	 */
	clearOnRelease?: boolean;
}
