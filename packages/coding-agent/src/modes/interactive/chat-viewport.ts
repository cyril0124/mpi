import {
	type Component,
	HStack,
	ScrollView,
	type ScrollViewScrollbar,
	type StackEntry,
	type StackEntryOptions,
	VStack,
} from "@earendil-works/pi-tui";

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
	/** Hide both widget slots for a viewport, for a surface that wants their rows instead. */
	readonly widgetsVisible?: NonNullable<StackEntryOptions["visible"]>;
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
	// Both widget slots share one shape, and one predicate decides when they are hidden.
	const widgetEntries = (component: Component | undefined): StackEntry[] =>
		component === undefined ? [] : [{ component, shrink: 1, minSize: 0, visible: options.widgetsVisible }];
	const dock = new VStack([
		{ component: options.pendingMessages, shrink: 1, minSize: 0 },
		{ component: options.status, shrink: 1, minSize: 0 },
		...widgetEntries(options.widgetsAbove),
		{ component: options.editor, shrink: 1, minSize: 3 },
		...widgetEntries(options.widgetsBelow),
		{ component: options.footer, shrink: 1, minSize: 0 },
	]);
	// A visible panel splits the transcript row region only: the dock below it
	// keeps the full width, so the composer spans the terminal as before.
	const content: Component =
		options.panel === undefined
			? transcript
			: new HStack(
					[
						{ component: transcript, basis: 0, grow: 1, shrink: 1, minSize: 1 },
						{
							component: options.panel.component,
							basis: "auto",
							grow: 0,
							shrink: 0,
							minSize: 0,
							visible: (viewport) => options.panel!.visible(viewport.width),
						},
					],
					{ gap: 1 },
				);
	return {
		transcript,
		root: new VStack([
			{ component: content, basis: 0, grow: 1, shrink: 1, minSize: 1 },
			{ component: dock, basis: "auto", grow: 0, shrink: 1, minSize: 1 },
		]),
	};
}
