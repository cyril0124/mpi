import { type Component, HStack, ScrollView, type ScrollViewScrollbar, VStack } from "@earendil-works/pi-tui";

/** A right-hand panel column shown beside the transcript while it is visible. */
export interface ChatViewportPanel {
	readonly component: Component;
	/** Whether the panel claims columns at this viewport width. */
	readonly visible: (width: number) => boolean;
}

export interface ChatViewportOptions {
	readonly document: Component;
	readonly pendingMessages: Component;
	readonly status: Component;
	readonly editor: Component;
	readonly footer: Component;
	readonly widgetsAbove?: Component;
	readonly widgetsBelow?: Component;
	/** Optional right-hand panel column beside the transcript. */
	readonly panel?: ChatViewportPanel;
	readonly scrollbar?: ScrollViewScrollbar;
	readonly scrollbarTrackStyle?: (text: string) => string;
	readonly scrollbarThumbStyle?: (text: string) => string;
}

export interface ChatViewport {
	readonly root: Component;
	readonly transcript: ScrollView;
}

/** Shared fullscreen transcript and fixed input-dock layout. */
export function createChatViewport(options: ChatViewportOptions): ChatViewport {
	const transcript = new ScrollView(options.document, {
		follow: "end",
		primary: true,
		overscroll: "chain",
		scrollbar: options.scrollbar ?? "auto",
		...(options.scrollbarTrackStyle === undefined ? {} : { scrollbarTrackStyle: options.scrollbarTrackStyle }),
		...(options.scrollbarThumbStyle === undefined ? {} : { scrollbarThumbStyle: options.scrollbarThumbStyle }),
	});
	// A widget slot hides its own rows and keeps the row that separates the transcript from
	// the editor, so both slots always take part in the layout.
	const dock = new VStack([
		{ component: options.pendingMessages, shrink: 1, minSize: 0 },
		{ component: options.status, shrink: 1, minSize: 0 },
		...(options.widgetsAbove === undefined ? [] : [{ component: options.widgetsAbove, shrink: 1, minSize: 0 }]),
		{ component: options.editor, shrink: 1, minSize: 3 },
		...(options.widgetsBelow === undefined ? [] : [{ component: options.widgetsBelow, shrink: 1, minSize: 0 }]),
		{ component: options.footer, shrink: 1, minSize: 0 },
	]);
	// A visible panel splits the transcript row region only: the dock below it
	// keeps the full width, so the composer spans the terminal as before.
	let content: Component;
	if (options.panel === undefined) {
		content = transcript;
	} else {
		const panel = options.panel;
		content = new HStack(
			[
				{ component: transcript, basis: 0, grow: 1, shrink: 1, minSize: 1 },
				{
					component: panel.component,
					basis: "auto",
					grow: 0,
					shrink: 0,
					minSize: 0,
					visible: (viewport) => panel.visible(viewport.width),
				},
			],
			{ gap: 1 },
		);
	}
	return {
		transcript,
		root: new VStack([
			{ component: content, basis: 0, grow: 1, shrink: 1, minSize: 1 },
			{ component: dock, basis: "auto", grow: 0, shrink: 1, minSize: 1 },
		]),
	};
}
