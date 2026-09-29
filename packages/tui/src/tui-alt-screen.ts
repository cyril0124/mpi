import {
	AltScreenSearchComponent,
	AltScreenSearchIndex,
	type AltScreenSearchMatch,
	getAltScreenSearchMatchKey,
} from "./alt-screen-search.ts";
import { AltScreenFlashContainer } from "./components/alt-screen-flash.ts";
import { ScrollView } from "./components/scroll-view.ts";
import { getKeybindings } from "./keybindings.ts";
import { isKeyRelease } from "./keys.ts";
import {
	getComponentBox,
	getLayoutBoxesAt,
	getScrollbarGeometry,
	getScrollLineProvider,
	getScrollViewBox,
	getScrollViewsAt,
	type LayoutFrame,
	type LayoutRect,
	materializeScrollLines,
	renderLayoutFrame,
	type ScrollbarGeometry,
} from "./layout.ts";
import { getLayoutNode } from "./layout-node.ts";
import type { Terminal } from "./terminal.ts";
import {
	deleteAllKittyImages,
	deleteAllKittyPlacements,
	deleteKittyImage,
	getCapabilities,
	getKittyImagePlacement,
	type ImageProtocol,
	isImageLine,
	setCapabilities,
	type TerminalCapabilities,
} from "./terminal-image.ts";
import {
	type Component,
	Container,
	CURSOR_MARKER,
	compositeTuiLine,
	dispatchMouseEvent,
	type OverlayHandle,
	type OverlayOptions,
	retargetMouseEvent,
	TuiBase,
	type TuiMouseButton,
	type TuiMouseDispatchResult,
	type TuiMouseDispatchTarget,
	type TuiMouseEvent,
	type TuiSelectionOptions,
	type TuiStopOptions,
	VIEWPORT_TUI,
	type ViewportTUI,
} from "./tui.ts";
import {
	countGraphemes,
	extractAnsiCode,
	getGraphemeCellRange,
	getOsc8LinkAtColumn,
	getWordSegmenter,
	sliceByColumn,
	stripTerminalSequences,
	truncateToWidth,
	visibleWidth,
} from "./utils.ts";

const ENTER_ALT_SCREEN = "\x1b[?1049h";
const EXIT_ALT_SCREEN = "\x1b[?1049l";
const DISABLE_AUTOWRAP = "\x1b[?7l";
const ENABLE_AUTOWRAP = "\x1b[?7h";
const ENABLE_BUTTON_MOTION_MOUSE = "\x1b[?1000h\x1b[?1002h\x1b[?1004h\x1b[?1006h";
const ENABLE_ALL_MOTION_MOUSE = "\x1b[?1000h\x1b[?1002h\x1b[?1003h\x1b[?1004h\x1b[?1006h";
const DISABLE_MOUSE = "\x1b[?1006l\x1b[?1004l\x1b[?1003l\x1b[?1002l\x1b[?1000l";
const FOCUS_IN = "\x1b[I";
const FOCUS_OUT = "\x1b[O";
const BEGIN_SYNCHRONIZED_OUTPUT = "\x1b[?2026h";
const END_SYNCHRONIZED_OUTPUT = "\x1b[?2026l";
const OSC133_ZONE_PREFIX = /^(?:\x1b\]133;[ABC](?:\x07|\x1b\\))+/;
const OSC133_PROMPT_START = /^\x1b\]133;A(?:\x07|\x1b\\)/;
const PAGE_SCROLL_OVERLAP = 4;
const ALT_WHEEL_SCROLL_MULTIPLIER = 5;
/** Button bits SGR reports for motion with no button held; `decodeMouseButton` maps them to "none". */
const SGR_NO_BUTTON = 3;
const MAX_CACHED_OFFSCREEN_KITTY_IMAGES = 16;
const MAX_CACHED_OFFSCREEN_KITTY_TRANSMISSION_BYTES = 32 * 1024 * 1024;
const MAX_CACHED_OFFSCREEN_KITTY_DECODED_BYTES = 64 * 1024 * 1024;
const DOUBLE_CLICK_INTERVAL_MS = 500;
const COPY_ERROR_FLASH_DURATION_MS = 5000;
// Regular mode delegates double-click selection to the terminal emulator. Fullscreen owns mouse selection,
// so mirror common terminal word-selection behavior by keeping paths and kebab-case tokens whole.
const TERMINAL_WORD_SELECTION_JOINERS = new Set(["/", "-"]);
const wordSegmenter = getWordSegmenter();
/** Sentinel a selection wrap is probed with to read its opening sequence. */
const SELECTION_STYLE_PROBE = "\x01";

/**
 * Opening sequence of a host selection wrap, probed with a sentinel so the host keeps a plain
 * `(text) => string`. An empty result means the wrap adds nothing to re-insert.
 */
function selectionHighlightOpen(highlight: (text: string) => string): string {
	const marked = highlight(SELECTION_STYLE_PROBE);
	const index = marked.indexOf(SELECTION_STYLE_PROBE);
	return index > 0 ? marked.slice(0, index) : "";
}

interface CachedKittyImage {
	transmissionGeneration: number;
	transmissionBytes: number;
	estimatedDecodedBytes: number;
}

interface SelectionPoint {
	row: number;
	col: number;
	scrollView?: ScrollView;
	/** Whether this point lies between terminal cells rather than on a cell. */
	boundary?: boolean;
}

interface SelectionRange {
	start: SelectionPoint;
	end: SelectionPoint;
}

type SelectionGranularity = "character" | "word" | "line";

interface ClickTarget {
	timestamp: number;
	count: number;
	row: number;
	scrollView?: ScrollView;
	wordStart: number;
	wordEnd: number;
}

interface SgrMouseEvent {
	button: number;
	x: number;
	y: number;
	release: boolean;
}

interface WheelEvent {
	direction: -1 | 1;
	x: number;
	y: number;
	button: number;
}

interface ScrollbarDrag {
	scrollView: ScrollView;
	grabOffset: number;
}

interface ScrollbarTarget {
	scrollView: ScrollView;
	geometry: ScrollbarGeometry;
}

interface ScrollToEndIndicatorRect {
	row: number;
	column: number;
	width: number;
}

type SearchSelectionMode = "query" | "retain" | "next" | "previous";

interface ActiveSearch {
	component: AltScreenSearchComponent;
	index: AltScreenSearchIndex;
	overlay?: OverlayHandle;
	query: string;
	matches: AltScreenSearchMatch[];
	selectedIndex: number;
	selectedKey?: string;
	anchorRow: number;
	selectionMode: SearchSelectionMode;
	/** Transcript lines the index was built from. */
	lines?: string[];
	/** Line count the cached transcript lines were materialized from. */
	lineCount?: number;
}

interface SearchHighlightRange {
	startCol: number;
	endCol: number;
	current: boolean;
}

/** The selectable surface a drag started in. */
interface SelectionSurfaceHit {
	kind: string;
	component: Component;
}

export interface TuiAltScreenOptions {
	/** Number of logical lines moved for each mouse-wheel event. */
	wheelScrollLines?: number;
	/** Capture mouse events for viewport scrolling and application-owned text selection. */
	mouse?: boolean;
	/** Style a non-current transcript search match. */
	searchMatchStyle?: (text: string) => string;
	/** Style the current transcript search match. */
	searchCurrentMatchStyle?: (text: string) => string;
	/** Style a transcript search navigation button. */
	searchNavigationButtonStyle?: (text: string, hovered: boolean) => string;
	/**
	 * Render a clickable jump-to-end label. It is centered on the last row of a follow-end
	 * primary scroll view while that view is scrolled away from its end. `hovered` is true
	 * while the pointer is over the label.
	 */
	scrollToEndIndicator?: (hovered: boolean) => string;
	/** Open an OSC 8 hyperlink activated with a primary-button click. */
	openUrl?: (url: string) => void;
	/** Handle an unmodified secondary-button press for clipboard paste. Currently enabled on Windows only. */
	onRightClickPaste?: () => void;
	/** Automatically copy selected text to the clipboard on mouse release (default: true). */
	copyOnSelect?: boolean;
	/**
	 * Copy selected text to the system clipboard. Return `true` on success, an error message to
	 * display on failure, or `false` for a generic error. When omitted, the selection is copied
	 * via an OSC 52 write.
	 */
	copySelection?: (text: string) => Promise<boolean | string>;
	/**
	 * Report a clipboard result to the host instead of flashing it into the screen. When omitted,
	 * the alternate screen flashes its own one-line confirmation.
	 */
	onCopyResult?: (result: ClipboardResult) => void;
	/**
	 * Narrow and style the application-owned text selection: which surfaces may take one, how
	 * their copied text is cleaned, and how selected cells are painted. Omit to keep the
	 * selection screen-wide, reverse-video, and copied verbatim.
	 */
	selection?: TuiSelectionOptions;
}

/** What a clipboard write reported to the host. */
export interface ClipboardResult {
	ok: boolean;
	/** The failure detail, when the copy failed. */
	detail?: string;
	/** Length of the copied text in grapheme clusters. */
	graphemes: number;
}

/** Alternate-screen TUI with a scrollable, application-owned viewport. */
export class TuiAltScreen extends TuiBase implements ViewportTUI {
	readonly mode = "fullscreen" as const;
	readonly [VIEWPORT_TUI] = true as const;
	private previousScreen: string[] = [];
	private lastDocument: string[] = [];
	private previousScreenWidth = 0;
	private previousScreenHeight = 0;
	private layoutRoot: Component | undefined;
	private currentLayout: LayoutFrame | undefined;
	private readonly implicitDocument: Component;
	private readonly implicitScrollView: ScrollView;
	private readonly flashes: AltScreenFlashContainer;
	private altScreenActive = false;
	private imageProtocol: ImageProtocol = null;
	private savedCapabilities?: TerminalCapabilities;
	private readonly uploadedKittyImages = new Map<number, CachedKittyImage>();
	private selectionAnchor?: SelectionPoint;
	private selectionFocus?: SelectionPoint;
	private selectionGranularity: SelectionGranularity = "character";
	private selectionInitialRange?: SelectionRange;
	private lastClick?: ClickTarget;
	private selectionDragPointer?: { x: number; y: number };
	private selectionAutoScrollDirection: -1 | 0 | 1 = 0;
	private selectionAutoScrollTimer?: NodeJS.Timeout;
	private selectionPressActive = false;
	private selectionSurface?: SelectionSurfaceHit;
	/** The scroll view the current press suspended, if it suspended one. */
	private selectionPinnedScrollView?: ScrollView;
	/** Whether that view was following new output when the press started. */
	private selectionResumeFollow = false;
	private scrollbarDrag?: ScrollbarDrag;
	private scrollbarHover?: ScrollView;
	private scrollToEndIndicatorRect?: ScrollToEndIndicatorRect;
	private scrollToEndIndicatorHover = false;
	/** Component the pointer last hovered; it is sent a leave event when the pointer leaves. */
	private hoverTarget?: TuiMouseDispatchTarget;
	private activeSearch?: ActiveSearch;
	private pressedUrl?: string;
	private selectionDragged = false;
	private mouseCapture?: TuiMouseDispatchTarget;
	private mousePressTarget?: TuiMouseDispatchTarget;
	private mousePressPoint?: { x: number; y: number };
	private mousePressMoved = false;
	private lastComponentClick?: {
		timestamp: number;
		count: number;
		component: Component;
		x: number;
		y: number;
	};
	private readonly wheelScrollLines: number;
	private readonly mouseEnabled: boolean;
	private readonly searchMatchStyle: (text: string) => string;
	private readonly searchCurrentMatchStyle: (text: string) => string;
	private readonly searchNavigationButtonStyle: (text: string, hovered: boolean) => string;
	private readonly scrollToEndIndicator?: (hovered: boolean) => string;
	private readonly openUrl?: (url: string) => void;
	private readonly onRightClickPaste?: () => void;
	private copyOnSelect: boolean;
	private readonly copySelection?: (text: string) => Promise<boolean | string>;
	private readonly onCopyResult?: (result: ClipboardResult) => void;
	private readonly selection?: TuiSelectionOptions;

	constructor(
		terminal: Terminal,
		showHardwareCursor?: boolean,
		logDirectory?: string,
		options: TuiAltScreenOptions = {},
	) {
		super(terminal, showHardwareCursor, logDirectory);
		this.implicitDocument = {
			render: (width) => super.render(width),
			handleMouse: (event) => super.handleMouse(event),
			invalidate: () => {
				for (const child of this.children) child.invalidate();
			},
		};
		this.implicitScrollView = new ScrollView(this.implicitDocument, { follow: "end", primary: true });
		this.flashes = new AltScreenFlashContainer(() => this.requestRender());
		this.wheelScrollLines = Math.max(1, Math.floor(options.wheelScrollLines ?? 1));
		this.mouseEnabled = options.mouse ?? true;
		this.searchMatchStyle = options.searchMatchStyle ?? ((text) => `\x1b[4m${text}\x1b[24m`);
		this.searchCurrentMatchStyle = options.searchCurrentMatchStyle ?? ((text) => `\x1b[1;7m${text}\x1b[22;27m`);
		this.searchNavigationButtonStyle = options.searchNavigationButtonStyle ?? ((text) => text);
		this.scrollToEndIndicator = options.scrollToEndIndicator;
		this.openUrl = options.openUrl;
		this.onRightClickPaste = options.onRightClickPaste;
		this.copyOnSelect = options.copyOnSelect ?? true;
		this.copySelection = options.copySelection;
		this.onCopyResult = options.onCopyResult;
		this.selection = options.selection;
		this.addInputListener((data) => this.handleViewportInput(data));
	}

	get viewportTop(): number {
		return this.getPrimaryScrollView().scrollTop;
	}

	get isFollowingOutput(): boolean {
		return this.getPrimaryScrollView().isFollowingEnd;
	}

	getCopyOnSelect(): boolean {
		return this.copyOnSelect;
	}

	setCopyOnSelect(enabled: boolean): void {
		this.copyOnSelect = enabled;
	}

	/** Whether the fullscreen viewport has a non-empty active text selection. */
	hasActiveSelection(): boolean {
		return this.getActiveSelectionText() !== undefined;
	}

	/** Copy the active fullscreen text selection, if any, using the configured selection clipboard path. */
	async copyActiveSelectionToClipboard(): Promise<boolean> {
		const text = this.getActiveSelectionText();
		if (!text) return false;
		return this.copyTextToClipboard(text);
	}

	setLayoutRoot(component: Component | undefined): void {
		if (this.layoutRoot === component) return;
		this.layoutRoot = component;
		this.currentLayout = undefined;
		this.requestRender();
	}

	override render(width: number): string[] {
		return this.layoutRoot?.render(width) ?? super.render(width);
	}

	protected override getMountedRoots(): readonly Component[] {
		return this.layoutRoot ? [this.layoutRoot] : this.children;
	}

	private getPrimaryScrollView(): ScrollView {
		return this.currentLayout?.primaryScrollView ?? this.implicitScrollView;
	}

	protected override beforeTerminalStart(): void {
		this.stopSelectionAutoScroll();
		this.selectionPressActive = false;
		this.stopScrollbarHover();
		this.stopScrollbarDrag();
		this.flashes.dispose();
		this.altScreenActive = true;
		const capabilities = getCapabilities();
		this.imageProtocol = capabilities.images;
		this.uploadedKittyImages.clear();
		if (capabilities.images === "iterm2") {
			this.savedCapabilities = capabilities;
			setCapabilities({ ...capabilities, images: null });
			this.invalidate();
		}
		this.lastDocument = [];
		this.selectionAnchor = undefined;
		this.selectionFocus = undefined;
		this.selectionGranularity = "character";
		this.selectionInitialRange = undefined;
		this.lastClick = undefined;
		this.pressedUrl = undefined;
		this.releaseSelectionScrollPin(this.selectionDragged ? "keep" : "resume-silently");
		this.selectionDragged = false;
		this.selectionSurface = undefined;
		this.clearComponentMouseGesture();
		this.lastComponentClick = undefined;
		this.resetRenderState();
		const term = process.env.TERM?.toLowerCase() ?? "";
		// Multiplexers can lag when every pointer movement is forwarded. Button-motion
		// tracking preserves clicks, wheel events, selections, and scrollbar dragging.
		const mouseSequence =
			process.env.TMUX !== undefined ||
			process.env.ZELLIJ !== undefined ||
			process.env.STY !== undefined ||
			term.startsWith("tmux") ||
			term.startsWith("screen")
				? ENABLE_BUTTON_MOTION_MOUSE
				: ENABLE_ALL_MOTION_MOUSE;
		this.terminal.write(
			`${ENTER_ALT_SCREEN}${DISABLE_AUTOWRAP}${this.mouseEnabled ? mouseSequence : ""}\x1b[2J\x1b[H\x1b[?25l`,
		);
	}

	protected override beforeTerminalStop(_options: TuiStopOptions): void {
		// The layout root outlives this renderer, so a suspended scroll view has to be let go here.
		this.releaseSelectionScrollPin("resume-silently");
		this.closeSearch();
		this.stopSelectionAutoScroll();
		this.selectionPressActive = false;
		this.stopScrollbarHover();
		this.stopScrollbarDrag();
		this.hoverTarget = undefined;
		this.scrollToEndIndicatorHover = false;
		this.clearComponentMouseGesture();
		this.flashes.dispose();
		if (!this.altScreenActive) return;
		this.terminal.write(
			`${BEGIN_SYNCHRONIZED_OUTPUT}${this.deleteKittyImages()}${this.mouseEnabled ? DISABLE_MOUSE : ""}${ENABLE_AUTOWRAP}${END_SYNCHRONIZED_OUTPUT}`,
		);
		this.uploadedKittyImages.clear();
	}

	protected override afterTerminalStop(options: TuiStopOptions): void {
		if (!this.altScreenActive) return;
		this.altScreenActive = false;
		if (options.preserveScreen) {
			this.terminal.write(`${BEGIN_SYNCHRONIZED_OUTPUT}${EXIT_ALT_SCREEN}\x1b[?25h${END_SYNCHRONIZED_OUTPUT}`);
		} else {
			const width = Math.max(1, this.terminal.columns);
			const documentLines = this.render(width).map((line) => line.replace(OSC133_ZONE_PREFIX, ""));
			this.lastDocument = this.applyLineResets(documentLines.map((line) => line.replaceAll(CURSOR_MARKER, ""))).map(
				(line) => (isImageLine(line) || visibleWidth(line) <= width ? line : sliceByColumn(line, 0, width, true)),
			);
			let buffer = `${BEGIN_SYNCHRONIZED_OUTPUT}${EXIT_ALT_SCREEN}${DISABLE_AUTOWRAP}`;
			for (let row = 0; row < this.lastDocument.length; row++) {
				if (row > 0) buffer += "\r\n";
				buffer += `\r\x1b[2K${this.lastDocument[row] ?? ""}`;
			}
			buffer += `\x1b[0m${ENABLE_AUTOWRAP}\r\n\x1b[?25h${END_SYNCHRONIZED_OUTPUT}`;
			this.terminal.write(buffer);
		}
		if (this.savedCapabilities) {
			setCapabilities(this.savedCapabilities);
			this.savedCapabilities = undefined;
		}
	}

	private deleteKittyImages(): string {
		return this.imageProtocol === "kitty" ? deleteAllKittyImages() : "";
	}

	private prepareKittyScreen(screen: string[]): { lines: string[]; evictedImageDeletion: string } {
		const visibleImageIds = new Set<number>();
		const lines = screen.map((line) => {
			const placement = getKittyImagePlacement(line);
			if (!placement) return line;
			visibleImageIds.add(placement.imageId);

			const cachedImage = this.uploadedKittyImages.get(placement.imageId);
			const nextCachedImage = {
				transmissionGeneration: placement.transmissionGeneration,
				transmissionBytes: placement.transmissionBytes,
				estimatedDecodedBytes: placement.estimatedDecodedBytes,
			};
			if (cachedImage) this.uploadedKittyImages.delete(placement.imageId);
			this.uploadedKittyImages.set(placement.imageId, nextCachedImage);

			return cachedImage?.transmissionGeneration === placement.transmissionGeneration
				? placement.replacementLine
				: line;
		});

		let cachedOffscreenImageCount = 0;
		let cachedOffscreenTransmissionBytes = 0;
		let cachedOffscreenDecodedBytes = 0;
		for (const [imageId, cachedImage] of this.uploadedKittyImages) {
			if (visibleImageIds.has(imageId)) continue;
			cachedOffscreenImageCount += 1;
			cachedOffscreenTransmissionBytes += cachedImage.transmissionBytes;
			cachedOffscreenDecodedBytes += cachedImage.estimatedDecodedBytes;
		}

		let evictedImageDeletion = "";
		for (const [imageId, cachedImage] of this.uploadedKittyImages) {
			if (
				cachedOffscreenImageCount <= MAX_CACHED_OFFSCREEN_KITTY_IMAGES &&
				cachedOffscreenTransmissionBytes <= MAX_CACHED_OFFSCREEN_KITTY_TRANSMISSION_BYTES &&
				cachedOffscreenDecodedBytes <= MAX_CACHED_OFFSCREEN_KITTY_DECODED_BYTES
			) {
				break;
			}
			if (visibleImageIds.has(imageId)) continue;
			evictedImageDeletion += deleteKittyImage(imageId);
			this.uploadedKittyImages.delete(imageId);
			cachedOffscreenImageCount -= 1;
			cachedOffscreenTransmissionBytes -= cachedImage.transmissionBytes;
			cachedOffscreenDecodedBytes -= cachedImage.estimatedDecodedBytes;
		}
		return { lines, evictedImageDeletion };
	}

	protected override resetRenderState(): void {
		this.previousScreen = [];
		this.previousScreenWidth = 0;
		this.previousScreenHeight = 0;
		this.currentLayout = undefined;
	}

	/** Scroll the primary transcript by the given number of lines. */
	scrollBy(lines: number): void {
		this.getPrimaryScrollView().scrollBy(lines);
		this.requestRender();
	}

	/** Scroll the primary transcript to its start. */
	scrollToTop(): void {
		this.getPrimaryScrollView().scrollToStart();
		this.requestRender();
	}

	/** Scroll the primary transcript to its end. */
	scrollToBottom(): void {
		this.getPrimaryScrollView().scrollToEnd();
		this.requestRender();
	}

	/** Jump to the next or previous OSC 133 prompt start; returns whether one was found. */
	scrollToPrompt(direction: -1 | 1): boolean {
		if (!this.currentLayout) return false;
		const scrollView = this.getPrimaryScrollView();
		const lines = materializeScrollLines(this.currentLayout, scrollView);
		if (!lines || lines.length === 0) return false;

		// The committed offset can sit past the rows that exist, because a windowed
		// transcript reports a virtual line count until its parts are rendered.
		const from = Math.min(Math.max(0, scrollView.scrollTop), lines.length - 1);
		for (let row = from + direction; row >= 0 && row < lines.length; row += direction) {
			if (!OSC133_PROMPT_START.test(lines[row] ?? "")) continue;
			scrollView.scrollTo(row);
			this.requestRender();
			return true;
		}
		return false;
	}

	private toggleSearch(): void {
		if (this.activeSearch) {
			this.closeSearch();
			return;
		}
		const component = new AltScreenSearchComponent(
			(query) => this.updateSearchQuery(query),
			this.searchNavigationButtonStyle,
		);
		const search: ActiveSearch = {
			component,
			index: new AltScreenSearchIndex(),
			query: "",
			matches: [],
			selectedIndex: -1,
			anchorRow: this.getPrimaryScrollView().scrollTop,
			selectionMode: "query",
		};
		this.activeSearch = search;
		search.overlay = this.showOverlay(component, {
			anchor: "top-right",
			width: "40%",
			minWidth: 32,
			margin: 1,
		});
	}

	private closeSearch(): void {
		const search = this.activeSearch;
		if (!search) return;
		this.activeSearch = undefined;
		search.overlay?.hide();
		this.requestRender();
	}

	private updateSearchQuery(query: string): void {
		const search = this.activeSearch;
		if (!search || query === search.query) return;
		const selected = search.matches[search.selectedIndex];
		search.anchorRow = selected?.segments[0]?.row ?? this.getPrimaryScrollView().scrollTop;
		search.query = query;
		search.selectionMode = "query";
		search.component.setResult(-1, 0);
		this.requestRender();
	}

	private navigateSearch(direction: -1 | 1): void {
		const search = this.activeSearch;
		if (!search?.query) return;
		search.selectionMode = direction < 0 ? "previous" : "next";
		this.requestRender();
	}

	private getSearchNavigationDirectionAt(x: number, y: number): -1 | 1 | undefined {
		const search = this.activeSearch;
		const bounds = search?.overlay?.getBounds();
		if (!search || !bounds) return undefined;
		if (x < bounds.col || x >= bounds.col + bounds.width || y < bounds.row || y >= bounds.row + bounds.height) {
			return undefined;
		}
		return search.component.getNavigationDirectionAt(y - bounds.row, x - bounds.col);
	}

	private handleSearchMouseEvent(event: SgrMouseEvent): boolean {
		const search = this.activeSearch;
		if (!search) return false;
		const direction = this.getSearchNavigationDirectionAt(event.x, event.y);
		if (search.component.setHoveredNavigationDirection(direction)) this.requestRender();
		if (direction === undefined || event.release || (event.button & 32) !== 0 || (event.button & 3) !== 0) {
			return false;
		}
		this.navigateSearch(direction);
		return true;
	}

	private refreshSearch(layout: LayoutFrame): boolean {
		const search = this.activeSearch;
		if (!search) return false;
		const scrollView = layout.primaryScrollView ?? this.implicitScrollView;
		const box = getScrollViewBox(layout, scrollView);
		const provider = getScrollLineProvider(layout, scrollView);
		if (!provider || !search.query.trim()) {
			search.lines = undefined;
			search.lineCount = undefined;
			search.matches = [];
			search.selectedIndex = -1;
			search.selectedKey = undefined;
			search.selectionMode = "retain";
			search.component.setResult(-1, 0);
			return false;
		}

		// Materializing walks the whole document, and this runs on every frame while the
		// search overlay is open, so the lines are kept until the line count moves.
		const lineCount = provider.lineCount();
		if (search.lines === undefined || search.lineCount !== lineCount) {
			search.lines = materializeScrollLines(layout, scrollView) ?? [];
			search.lineCount = lineCount;
		}
		const lines = search.lines;

		const shouldRevealSelection = search.selectionMode !== "retain";
		const result = search.index.search(lines, search.query);
		const matches = result.matches;
		search.matches = matches;
		if (!result.changed && search.selectionMode === "retain") return false;

		const exactIndex = result.changed
			? search.selectedKey
				? matches.findIndex((match) => getAltScreenSearchMatchKey(match) === search.selectedKey)
				: -1
			: search.selectedIndex;
		let selectedIndex = -1;
		if (matches.length > 0) {
			if (search.selectionMode === "query") {
				let low = 0;
				let high = matches.length;
				while (low < high) {
					const middle = low + Math.floor((high - low) / 2);
					if ((matches[middle]!.segments[0]?.row ?? 0) < search.anchorRow) low = middle + 1;
					else high = middle;
				}
				selectedIndex = low < matches.length ? low : 0;
			} else if (search.selectionMode === "next") {
				const baseIndex = exactIndex >= 0 ? exactIndex : Math.min(search.selectedIndex, matches.length - 1);
				selectedIndex = baseIndex < 0 ? 0 : (baseIndex + 1) % matches.length;
			} else if (search.selectionMode === "previous") {
				const baseIndex = exactIndex >= 0 ? exactIndex : Math.min(search.selectedIndex, matches.length - 1);
				selectedIndex = baseIndex < 0 ? matches.length - 1 : (baseIndex - 1 + matches.length) % matches.length;
			} else {
				selectedIndex =
					exactIndex >= 0 ? exactIndex : Math.min(Math.max(0, search.selectedIndex), matches.length - 1);
			}
		}

		search.selectedIndex = selectedIndex;
		search.selectedKey = selectedIndex >= 0 ? getAltScreenSearchMatchKey(matches[selectedIndex]!) : undefined;
		search.selectionMode = "retain";
		search.component.setResult(selectedIndex, matches.length);
		if (!shouldRevealSelection) return false;

		const selected = matches[selectedIndex];
		const firstSegment = selected?.segments[0];
		const lastSegment = selected?.segments[selected.segments.length - 1];
		if (!box || !firstSegment || !lastSegment || scrollView.viewportHeight <= 0) return false;
		const before = scrollView.scrollTop;
		const visibleBottom = before + scrollView.viewportHeight - 1;
		let target = before;
		if (firstSegment.row < before || lastSegment.row > visibleBottom) {
			target = firstSegment.row - Math.floor(scrollView.viewportHeight / 3);
		}
		scrollView.scrollTo(target, { disableFollow: true });
		return scrollView.scrollTop !== before;
	}

	/** Show a transient message in the alternate-screen flash stack. */
	flash(message: string, durationMs?: number): void {
		this.flashes.flash(message, durationMs);
	}

	private shouldDeferViewportInputToOverlay(): boolean {
		return this.isOverlayFocused() && this.activeSearch?.overlay?.isFocused() !== true;
	}

	private clearComponentMouseGesture(): void {
		this.mouseCapture = undefined;
		this.mousePressTarget = undefined;
		this.mousePressPoint = undefined;
		this.mousePressMoved = false;
	}

	private handleViewportInput(data: string): { consume?: boolean } | undefined {
		if (data === FOCUS_OUT) {
			const hadActiveSelection = this.selectionPressActive;
			const hadNonEmptyActiveSelection = hadActiveSelection && this.getSelectionBounds() !== undefined;
			this.selectionPressActive = false;
			this.stopSelectionAutoScroll();
			this.stopScrollbarHover();
			if (this.activeSearch?.component.setHoveredNavigationDirection(undefined)) this.requestRender();
			this.stopScrollbarDrag();
			this.pressedUrl = undefined;
			this.releaseSelectionScrollPin(this.selectionDragged ? "keep" : "resume-silently");
			this.selectionDragged = false;
			this.clearComponentMouseGesture();
			this.lastComponentClick = undefined;
			if (hadActiveSelection) {
				this.selectionAnchor = undefined;
				this.selectionFocus = undefined;
				this.selectionGranularity = "character";
				this.selectionInitialRange = undefined;
				if (hadNonEmptyActiveSelection) this.requestRender();
			}
			this.lastClick = undefined;
			return { consume: true };
		}
		if (data === FOCUS_IN) return { consume: true };

		const wheelEvent = this.parseWheelEvent(data);
		if (wheelEvent) {
			const event = this.createMouseEvent("wheel", wheelEvent.button, wheelEvent.x, wheelEvent.y, {
				wheelDelta: wheelEvent.direction * this.getWheelScrollLines(wheelEvent.button),
			});
			const overlay = this.dispatchMouseToOverlay(event);
			// A wheel is not a hover: the surface under the pointer may have scrolled.
			this.clearHoverTarget();
			const result = overlay.result ?? (overlay.hit ? undefined : this.dispatchMouseToLayout(event));
			if (result) {
				if (this.applyMouseDispatchResult(event, result)) this.requestRender();
				return { consume: true };
			}
			if (this.shouldDeferViewportInputToOverlay()) return undefined;
			this.routeWheel(wheelEvent);
			return { consume: true };
		}
		const mouseEvent = this.parseSgrMouseEvent(data);
		if (mouseEvent) {
			this.handleMouseEvent(mouseEvent);
			return { consume: true };
		}
		if (this.isMouseSequence(data)) return { consume: true };

		// A key is not a hover either, and the surface the pointer rests on may redraw.
		this.clearHoverTarget();

		const keybindings = getKeybindings();
		const isRelease = isKeyRelease(data);
		if (keybindings.matches(data, "tui.altScreen.search")) {
			if (!isRelease) this.toggleSearch();
			return { consume: true };
		}
		if (this.activeSearch?.overlay?.isFocused()) {
			if (keybindings.matches(data, "tui.altScreen.searchNext")) {
				if (!isRelease) this.navigateSearch(1);
				return { consume: true };
			}
			if (keybindings.matches(data, "tui.altScreen.searchPrevious")) {
				if (!isRelease) this.navigateSearch(-1);
				return { consume: true };
			}
			if (keybindings.matches(data, "tui.altScreen.searchClose")) {
				if (!isRelease) this.closeSearch();
				return { consume: true };
			}
		}
		if (this.shouldDeferViewportInputToOverlay()) return undefined;
		if (keybindings.matches(data, "tui.altScreen.pageUp")) {
			if (!isRelease) {
				this.scrollBy(-Math.max(1, this.getPrimaryScrollView().viewportHeight - PAGE_SCROLL_OVERLAP));
			}
			return { consume: true };
		}
		if (keybindings.matches(data, "tui.altScreen.pageDown")) {
			if (!isRelease) {
				this.scrollBy(Math.max(1, this.getPrimaryScrollView().viewportHeight - PAGE_SCROLL_OVERLAP));
			}
			return { consume: true };
		}
		if (keybindings.matches(data, "tui.altScreen.halfPageUp")) {
			if (!isRelease) this.scrollBy(-Math.max(1, Math.floor(this.getPrimaryScrollView().viewportHeight / 2)));
			return { consume: true };
		}
		if (keybindings.matches(data, "tui.altScreen.halfPageDown")) {
			if (!isRelease) this.scrollBy(Math.max(1, Math.floor(this.getPrimaryScrollView().viewportHeight / 2)));
			return { consume: true };
		}
		if (keybindings.matches(data, "tui.altScreen.lineUp")) {
			if (!isRelease) this.scrollBy(-1);
			return { consume: true };
		}
		if (keybindings.matches(data, "tui.altScreen.lineDown")) {
			if (!isRelease) this.scrollBy(1);
			return { consume: true };
		}
		if (keybindings.matches(data, "tui.altScreen.previousPrompt")) {
			if (!isRelease) this.scrollToPrompt(-1);
			return { consume: true };
		}
		if (keybindings.matches(data, "tui.altScreen.nextPrompt")) {
			if (!isRelease) this.scrollToPrompt(1);
			return { consume: true };
		}
		if (keybindings.matches(data, "tui.altScreen.top")) {
			if (!isRelease) this.scrollToTop();
			return { consume: true };
		}
		if (keybindings.matches(data, "tui.altScreen.bottom")) {
			if (!isRelease) this.scrollToBottom();
			return { consume: true };
		}
		return undefined;
	}

	private decodeMouseButton(button: number): TuiMouseButton {
		switch (button & 3) {
			case 0:
				return "left";
			case 1:
				return "middle";
			case 2:
				return "right";
			default:
				return "none";
		}
	}

	private createMouseEvent(
		type: TuiMouseEvent["type"],
		button: number,
		x: number,
		y: number,
		extra: Partial<Pick<TuiMouseEvent, "wheelDelta" | "clickCount">> = {},
	): TuiMouseEvent {
		return {
			type,
			button: type === "wheel" ? "none" : this.decodeMouseButton(button),
			x,
			y,
			screenX: x,
			screenY: y,
			width: Math.max(1, this.terminal.columns),
			height: Math.max(1, this.terminal.rows),
			shift: (button & 4) !== 0,
			alt: (button & 8) !== 0,
			ctrl: (button & 16) !== 0,
			...(extra.wheelDelta === undefined ? {} : { wheelDelta: extra.wheelDelta }),
			...(extra.clickCount === undefined ? {} : { clickCount: extra.clickCount }),
		};
	}

	private dispatchMouseToLayout(event: TuiMouseEvent): TuiMouseDispatchResult | undefined {
		if (!this.currentLayout) return undefined;
		const visited = new Set<Component>();
		const boxes = getLayoutBoxesAt(this.currentLayout, event.screenX, event.screenY);
		for (const box of boxes) {
			if (visited.has(box.component)) continue;
			if (getLayoutNode(box.component) && box.component.handleMouse === Container.prototype.handleMouse) continue;
			visited.add(box.component);
			const result = dispatchMouseEvent(box.component, {
				...event,
				x: event.screenX - box.rect.x,
				y: event.screenY - box.rect.y,
				width: box.rect.width,
				height: box.rect.height,
			});
			if (result) return result;
		}
		return undefined;
	}

	private applyMouseDispatchResult(event: TuiMouseEvent, result: TuiMouseDispatchResult): boolean {
		const focusTarget = this.resolveMouseFocusTarget(result.focusTarget ?? result.target.component);
		const focusChanged = result.focus === true && this.getFocusedComponent() !== focusTarget;
		if (result.focus) this.setFocus(focusTarget);
		if (result.capture) this.mouseCapture = result.target;
		return (
			result.render ??
			(focusChanged ||
				event.type === "press" ||
				event.type === "click" ||
				event.type === "drag" ||
				event.type === "wheel")
		);
	}

	private dispatchMouseToTarget(
		event: TuiMouseEvent,
		target: TuiMouseDispatchTarget,
	): TuiMouseDispatchResult | undefined {
		return dispatchMouseEvent(target.component, retargetMouseEvent(event, target));
	}

	private getComponentClickCount(target: TuiMouseDispatchTarget, x: number, y: number): number {
		const now = Date.now();
		const previous = this.lastComponentClick;
		const count =
			previous &&
			now - previous.timestamp <= DOUBLE_CLICK_INTERVAL_MS &&
			previous.component === target.component &&
			previous.x === x &&
			previous.y === y
				? (previous.count % 3) + 1
				: 1;
		this.lastComponentClick = { timestamp: now, count, component: target.component, x, y };
		return count;
	}

	private clearTextSelection(): void {
		this.stopSelectionAutoScroll();
		this.selectionPressActive = false;
		this.selectionAnchor = undefined;
		this.selectionFocus = undefined;
		this.selectionGranularity = "character";
		this.selectionInitialRange = undefined;
		this.pressedUrl = undefined;
		this.selectionDragged = false;
		this.selectionSurface = undefined;
		this.releaseSelectionScrollPin("keep");
	}

	/**
	 * Hold a following scroll view still for the duration of the pointer press, so output that
	 * arrives while the button is down cannot move the rows the selection is anchored to.
	 */
	private pinSelectionScrollView(scrollView: ScrollView | undefined): void {
		this.selectionPinnedScrollView = undefined;
		this.selectionResumeFollow = false;
		if (!scrollView?.followEnd) return;
		this.selectionPinnedScrollView = scrollView;
		this.selectionResumeFollow = scrollView.isFollowingEnd;
		scrollView.setFollowSuspended(true);
	}

	/**
	 * End the press's hold on its scroll view. A press that left the rows and the end where they
	 * were lets the view follow again; one that scrolled the view, or that the content grew past,
	 * leaves it where the user was reading. `resume` repaints as it goes, `resume-silently` does
	 * not, and `keep` never resumes.
	 */
	private releaseSelectionScrollPin(action: "keep" | "resume" | "resume-silently"): void {
		const pinned = this.selectionPinnedScrollView;
		// A gesture scroll and content that grew past the viewport both leave the user somewhere
		// other than the end; anything else resumes following.
		const staysPut = pinned?.wasScrolledWhileSuspended === true || pinned?.grewPastViewportWhileSuspended === true;
		pinned?.setFollowSuspended(false);
		if (action !== "keep" && !staysPut && this.selectionResumeFollow) {
			if (action === "resume") pinned?.scrollToEnd();
			else pinned?.resumeFollowEnd();
		}
		this.selectionPinnedScrollView = undefined;
		this.selectionResumeFollow = false;
	}

	/**
	 * Show an overlay and drop the pointer's hover cue. The overlay takes the pointer, so
	 * the chrome beneath it must not keep a highlight the pointer no longer reaches.
	 */
	override showOverlay(component: Component, options?: OverlayOptions): OverlayHandle {
		const handle = super.showOverlay(component, options);
		this.clearHoverTarget();
		// The label is chrome the overlay now covers.
		this.scrollToEndIndicatorHover = false;
		return handle;
	}

	/**
	 * Take the hover cue off the component the pointer last hovered. A component only learns
	 * that the pointer left it from a move event, so a move outside every cell is sent to the
	 * target it was last inside of. That target is the component that answered the move, so the
	 * leave is dispatched in the target's own coordinates; a scrolled or windowed box reports
	 * content coordinates and its screen origin cannot be turned back into a pointer position.
	 */
	private clearHoverTarget(): void {
		const target = this.hoverTarget;
		if (!target) return;
		this.hoverTarget = undefined;
		const leave = {
			...this.createMouseEvent("move", SGR_NO_BUTTON, -1, -1),
			width: target.width,
			height: target.height,
		};
		const result = dispatchMouseEvent(target.component, leave);
		if (result && this.applyMouseDispatchResult(leave, result)) this.requestRender();
	}

	/** Track the pointer over the jump-to-end label; true when the hovered state changed. */
	private updateScrollToEndIndicatorHover(x: number, y: number): boolean {
		const rect = this.scrollToEndIndicatorRect;
		const inside = Boolean(
			rect && !this.hasOverlay() && y === rect.row && x >= rect.column && x < rect.column + rect.width,
		);
		if (inside === this.scrollToEndIndicatorHover) return false;
		this.scrollToEndIndicatorHover = inside;
		return true;
	}

	private handleMouseEvent(raw: SgrMouseEvent): void {
		const isMotion = (raw.button & 32) !== 0;
		const type: TuiMouseEvent["type"] = raw.release
			? "release"
			: isMotion
				? this.decodeMouseButton(raw.button) === "none"
					? "move"
					: "drag"
				: "press";
		const event = this.createMouseEvent(type, raw.button, raw.x, raw.y);

		// A press, click, drag, wheel or release is not a hover: drop the cue it left behind.
		if (type !== "move") this.clearHoverTarget();

		if (this.mouseCapture || this.mousePressTarget) {
			const target = this.mouseCapture ?? this.mousePressTarget!;
			if (this.mousePressPoint && (raw.x !== this.mousePressPoint.x || raw.y !== this.mousePressPoint.y)) {
				this.mousePressMoved = true;
				this.lastComponentClick = undefined;
			}
			let render = false;
			const targetResult = this.dispatchMouseToTarget(event, target);
			if (targetResult) render = this.applyMouseDispatchResult(event, targetResult);
			if (raw.release) {
				if (!this.mousePressMoved && this.mousePressPoint?.x === raw.x && this.mousePressPoint.y === raw.y) {
					const clickEvent = this.createMouseEvent("click", raw.button, raw.x, raw.y, {
						clickCount: this.getComponentClickCount(target, raw.x, raw.y),
					});
					const clickResult = this.dispatchMouseToTarget(clickEvent, target);
					if (clickResult) render = this.applyMouseDispatchResult(clickEvent, clickResult) || render;
				}
				this.clearComponentMouseGesture();
			}
			if (render) this.requestRender();
			return;
		}

		if (this.handleSearchMouseEvent(raw)) {
			this.clearHoverTarget();
			return;
		}

		const overlay = this.dispatchMouseToOverlay(event);
		if (!overlay.hit) {
			if (type === "move" && this.hasOverlay()) {
				// A visible overlay owns the pointer: the chrome beneath it keeps no hover, even
				// for a move outside the overlay's own rectangle.
				this.clearHoverTarget();
				this.stopScrollbarHover();
				this.scrollToEndIndicatorHover = false;
				return;
			}
			if (type === "move" && this.updateScrollToEndIndicatorHover(raw.x, raw.y)) this.requestRender();
			if (this.handleScrollToEndIndicatorMouseEvent(raw)) {
				this.clearHoverTarget();
				return;
			}
			if (type === "move" && this.scrollToEndIndicatorHover) {
				// The label sits over the last transcript row; the block beneath it is not hovered.
				this.clearHoverTarget();
				return;
			}
			const scrollbarHandled = this.handleScrollbarMouseEvent(raw);
			if (!this.scrollbarDrag) this.updateScrollbarHover(raw.x, raw.y);
			if (scrollbarHandled) {
				this.clearHoverTarget();
				return;
			}
			if (this.scrollbarHover) this.clearHoverTarget();
		} else {
			this.stopScrollbarHover();
			// An overlay takes the pointer from the chrome beneath it, but the overlay's own
			// hover stays: the pointer is still on the component that tracks it.
			if (this.hoverTarget && this.hoverTarget.component !== overlay.component) this.clearHoverTarget();
		}

		// A move that reaches another component ends the previous component's hover, and a
		// move that reaches none ends it too. The target is compared by component, since a
		// scrolled or windowed box reports content coordinates, not screen ones.
		const result = overlay.result ?? (overlay.hit ? undefined : this.dispatchMouseToLayout(event));
		if (result) {
			const render = this.applyMouseDispatchResult(event, result);
			if (type === "move") {
				if (this.hoverTarget && this.hoverTarget.component !== result.target.component) this.clearHoverTarget();
				this.hoverTarget = result.target;
			}
			if (type === "release") this.releaseSelectionScrollPin("resume-silently");
			if (type === "press") {
				this.clearTextSelection();
				this.mousePressTarget = result.target;
				this.mousePressPoint = { x: raw.x, y: raw.y };
				this.mousePressMoved = false;
			}
			if (render) this.requestRender();
			return;
		}

		// A move that reached no component leaves nothing hovered.
		if (type === "move") this.clearHoverTarget();
		if (this.handleRightClickPaste(raw)) return;
		this.handleSelectionMouseEvent(raw);
	}

	private parseWheelEvent(data: string): WheelEvent | undefined {
		const sgr = /^\x1b\[<(\d+);(\d+);(\d+)[Mm]$/.exec(data);
		if (sgr) {
			const button = Number.parseInt(sgr[1], 10);
			if ((button & 64) === 0) return undefined;
			const direction = button & 3;
			if (direction !== 0 && direction !== 1) return undefined;
			return {
				direction: direction === 0 ? -1 : 1,
				x: Number.parseInt(sgr[2], 10) - 1,
				y: Number.parseInt(sgr[3], 10) - 1,
				button,
			};
		}
		if (data.length === 6 && data.startsWith("\x1b[M")) {
			const button = data.charCodeAt(3) - 32;
			if ((button & 64) === 0) return undefined;
			const direction = button & 3;
			if (direction !== 0 && direction !== 1) return undefined;
			return {
				direction: direction === 0 ? -1 : 1,
				x: data.charCodeAt(4) - 33,
				y: data.charCodeAt(5) - 33,
				button,
			};
		}
		return undefined;
	}

	private getWheelScrollLines(button: number): number {
		// SGR mouse button codes use bit 3 (value 8) for the Alt modifier.
		return (button & 8) !== 0 ? this.wheelScrollLines * ALT_WHEEL_SCROLL_MULTIPLIER : this.wheelScrollLines;
	}

	private routeWheel(event: WheelEvent): void {
		let remaining = event.direction * this.getWheelScrollLines(event.button);
		const seen = new Set<ScrollView>();
		for (const scrollView of this.currentLayout ? getScrollViewsAt(this.currentLayout, event.x, event.y) : []) {
			seen.add(scrollView);
			remaining = scrollView.scrollBy(remaining);
			if (remaining === 0 || scrollView.overscroll === "contain") break;
		}
		const primary = this.getPrimaryScrollView();
		if (remaining !== 0 && !seen.has(primary)) primary.scrollBy(remaining);
		this.updateScrollbarHover(event.x, event.y);
		this.requestRender();
	}

	private parseSgrMouseEvent(data: string): SgrMouseEvent | undefined {
		const match = /^\x1b\[<(\d+);(\d+);(\d+)([Mm])$/.exec(data);
		if (!match) return undefined;
		return {
			button: Number.parseInt(match[1], 10),
			x: Number.parseInt(match[2], 10) - 1,
			y: Number.parseInt(match[3], 10) - 1,
			release: match[4] === "m",
		};
	}

	private handleRightClickPaste(event: SgrMouseEvent): boolean {
		if (
			!this.onRightClickPaste ||
			process.platform !== "win32" ||
			process.env.TERM_PROGRAM?.toLowerCase() === "vscode" ||
			event.release ||
			event.button !== 2
		) {
			return false;
		}
		try {
			this.onRightClickPaste();
		} catch {
			// Clipboard paste is best-effort.
		}
		return true;
	}

	private handleScrollToEndIndicatorMouseEvent(event: SgrMouseEvent): boolean {
		const rect = this.scrollToEndIndicatorRect;
		if (!rect || event.release || (event.button & 32) !== 0 || (event.button & 3) !== 0) return false;
		if (event.y !== rect.row || event.x < rect.column || event.x >= rect.column + rect.width) return false;
		this.scrollToBottom();
		return true;
	}

	private getScrollbarTargetAt(x: number, y: number, includeHiddenAuto = false): ScrollbarTarget | undefined {
		if (this.hasOverlay() || !this.currentLayout) return undefined;
		for (const scrollView of getScrollViewsAt(this.currentLayout, x, y)) {
			const box = getScrollViewBox(this.currentLayout, scrollView);
			const geometry = box ? getScrollbarGeometry(box, includeHiddenAuto) : undefined;
			if (
				geometry &&
				x === geometry.column &&
				y >= geometry.trackTop &&
				y < geometry.trackTop + geometry.trackHeight
			) {
				return { scrollView, geometry };
			}
		}
		return undefined;
	}

	private setScrollbarHover(scrollView: ScrollView | undefined): void {
		if (scrollView === this.scrollbarHover) return;
		this.scrollbarHover?.setScrollbarActive(false);
		this.scrollbarHover = scrollView;
		this.scrollbarHover?.setScrollbarActive(true);
	}

	private updateScrollbarHover(x: number, y: number): void {
		this.setScrollbarHover(this.getScrollbarTargetAt(x, y, true)?.scrollView);
	}

	private stopScrollbarHover(): void {
		this.setScrollbarHover(undefined);
	}

	private scrollScrollbarToPointer(
		scrollView: ScrollView,
		geometry: ScrollbarGeometry,
		pointerY: number,
		grabOffset: number,
	): void {
		const maxThumbOffset = geometry.trackHeight - geometry.thumbHeight;
		const thumbOffset = Math.max(0, Math.min(maxThumbOffset, pointerY - geometry.trackTop - grabOffset));
		const scrollTop = maxThumbOffset === 0 ? 0 : Math.round((thumbOffset / maxThumbOffset) * geometry.maxScrollTop);
		scrollView.scrollTo(scrollTop);
	}

	private handleScrollbarMouseEvent(event: SgrMouseEvent): boolean {
		if (this.scrollbarDrag) {
			if (event.release) {
				this.stopScrollbarDrag();
				return true;
			}
			const box = this.currentLayout
				? getScrollViewBox(this.currentLayout, this.scrollbarDrag.scrollView)
				: undefined;
			const geometry = box ? getScrollbarGeometry(box) : undefined;
			if (geometry) {
				this.scrollScrollbarToPointer(
					this.scrollbarDrag.scrollView,
					geometry,
					event.y,
					this.scrollbarDrag.grabOffset,
				);
			}
			return true;
		}

		if (event.release || (event.button & 32) !== 0 || (event.button & 3) !== 0) return false;
		const target = this.getScrollbarTargetAt(event.x, event.y);
		if (!target) return false;
		this.stopSelectionAutoScroll();
		this.selectionPressActive = false;
		this.selectionAnchor = undefined;
		this.selectionFocus = undefined;
		this.selectionGranularity = "character";
		this.selectionInitialRange = undefined;
		this.lastClick = undefined;
		this.pressedUrl = undefined;
		this.selectionDragged = false;
		this.selectionSurface = undefined;
		this.releaseSelectionScrollPin("keep");
		this.setScrollbarHover(target.scrollView);
		const onThumb =
			event.y >= target.geometry.thumbTop && event.y < target.geometry.thumbTop + target.geometry.thumbHeight;
		const grabOffset = onThumb ? event.y - target.geometry.thumbTop : Math.floor(target.geometry.thumbHeight / 2);
		if (!onThumb) this.scrollScrollbarToPointer(target.scrollView, target.geometry, event.y, grabOffset);
		this.scrollbarDrag = {
			scrollView: target.scrollView,
			grabOffset,
		};
		return true;
	}

	private stopScrollbarDrag(): void {
		this.scrollbarDrag = undefined;
	}

	private getScrollSelectionPoint(scrollView: ScrollView, x: number, y: number): SelectionPoint | undefined {
		if (!this.currentLayout) return undefined;
		const box = getScrollViewBox(this.currentLayout, scrollView);
		if (!box || box.rect.height <= 0 || box.clip.height <= 0) return undefined;
		const visibleTop = Math.max(0, box.rect.y, box.clip.y);
		const visibleBottom = Math.min(
			this.terminal.rows - 1,
			box.rect.y + box.rect.height - 1,
			box.clip.y + box.clip.height - 1,
		);
		if (visibleBottom < visibleTop) return undefined;
		const pointerRow = Math.max(visibleTop, Math.min(visibleBottom, y));
		const maxContentRow = Math.max(0, (getScrollLineProvider(this.currentLayout, scrollView)?.lineCount() ?? 1) - 1);
		return {
			row: Math.max(0, Math.min(maxContentRow, scrollView.scrollTop + pointerRow - box.rect.y)),
			col: Math.max(0, Math.min(box.rect.width - 1, x - box.rect.x)),
			scrollView,
		};
	}

	private getSelectionPoint(event: SgrMouseEvent, scrollView?: ScrollView): SelectionPoint {
		if (scrollView) {
			const point = this.getScrollSelectionPoint(scrollView, event.x, event.y);
			if (point) return point;
		}
		// A selection that started on a plain surface follows that surface: a pointer outside it
		// pins to the nearest cell instead of reaching a neighbouring surface.
		const rect = scrollView ? undefined : this.activeSelectionRect();
		if (rect) {
			return {
				row: Math.max(rect.y, Math.min(rect.y + rect.height - 1, event.y)),
				col: Math.max(rect.x, Math.min(rect.x + rect.width - 1, event.x)),
			};
		}
		return {
			row: Math.max(0, Math.min(this.terminal.rows - 1, event.y)),
			col: Math.max(0, Math.min(this.terminal.columns - 1, event.x)),
		};
	}

	/** The surface the host publishes at the pointer, if one covers it. */
	private resolveSelectionSurface(x: number, y: number): SelectionSurfaceHit | undefined {
		for (const surface of this.selection?.surfaces?.() ?? []) {
			const rect = this.getSelectionSurfaceRect(surface.component);
			if (!rect || x < rect.x || x >= rect.x + rect.width || y < rect.y || y >= rect.y + rect.height) {
				continue;
			}
			return { kind: surface.kind, component: surface.component };
		}
		return undefined;
	}

	/** Screen rect of the surface the current selection started in, in `layout`. */
	private activeSelectionRect(layout = this.currentLayout): LayoutRect | undefined {
		const component = this.selectionSurface?.component;
		return component ? this.getSelectionSurfaceRect(component, layout) : undefined;
	}

	/** Screen rect of a published surface: an open overlay first, then the given committed layout. */
	private getSelectionSurfaceRect(component: Component, layout = this.currentLayout): LayoutRect | undefined {
		const overlay = this.overlayComponentRect(component);
		if (overlay) return overlay;
		if (!layout) return undefined;
		if (component instanceof ScrollView) return getScrollViewBox(layout, component)?.rect;
		return getComponentBox(layout, component)?.rect;
	}

	private getSelectionSourceLine(point: SelectionPoint): string {
		if (point.scrollView && this.currentLayout) {
			const lines = materializeScrollLines(this.currentLayout, point.scrollView);
			if (lines) return lines[point.row] ?? "";
		}
		return this.previousScreen[point.row] ?? "";
	}

	private getWordSelection(point: SelectionPoint): SelectionRange | undefined {
		const line = stripTerminalSequences(this.getSelectionSourceLine(point));
		const segments: Array<{ start: number; end: number; selectable: boolean; joiner: boolean }> = [];
		let start = 0;
		for (const segment of wordSegmenter.segment(line)) {
			const end = start + visibleWidth(segment.segment);
			const joiner = TERMINAL_WORD_SELECTION_JOINERS.has(segment.segment);
			segments.push({ start, end, selectable: segment.isWordLike === true || joiner, joiner });
			start = end;
		}
		const clickedSegmentIndex = segments.findIndex(
			(segment) => point.col >= segment.start && point.col < segment.end,
		);
		if (clickedSegmentIndex < 0) return undefined;

		const canJoin = (
			left: { selectable: boolean; joiner: boolean },
			right: { selectable: boolean; joiner: boolean },
		): boolean => left.selectable && right.selectable && (left.joiner || right.joiner);
		let selectionStart = segments[clickedSegmentIndex].start;
		let selectionEnd = segments[clickedSegmentIndex].end;
		for (let index = clickedSegmentIndex; index > 0 && canJoin(segments[index - 1], segments[index]); index--) {
			selectionStart = segments[index - 1].start;
		}
		for (
			let index = clickedSegmentIndex;
			index < segments.length - 1 && canJoin(segments[index], segments[index + 1]);
			index++
		) {
			selectionEnd = segments[index + 1].end;
		}
		return {
			start: { ...point, col: selectionStart },
			end: { ...point, col: selectionEnd, boundary: true },
		};
	}

	private getLineSelection(point: SelectionPoint): SelectionRange {
		return {
			start: { ...point, col: 0 },
			end: { ...point, col: visibleWidth(this.getSelectionSourceLine(point)), boundary: true },
		};
	}

	private updateSelectionFocus(point: SelectionPoint): void {
		if (this.selectionGranularity === "character" || !this.selectionInitialRange) {
			this.selectionFocus = point;
			return;
		}
		const range = this.selectionGranularity === "word" ? this.getWordSelection(point) : this.getLineSelection(point);
		if (!range) return;
		const initial = this.selectionInitialRange;
		const targetBeforeInitial =
			range.start.row < initial.start.row ||
			(range.start.row === initial.start.row && range.start.col < initial.start.col);
		if (targetBeforeInitial) {
			this.selectionAnchor = initial.end;
			this.selectionFocus = range.start;
		} else {
			this.selectionAnchor = initial.start;
			this.selectionFocus = range.end;
		}
	}

	private getClickCount(point: SelectionPoint, word: SelectionRange | undefined): number {
		const now = Date.now();
		const previous = this.lastClick;
		const count =
			word &&
			previous &&
			now - previous.timestamp <= DOUBLE_CLICK_INTERVAL_MS &&
			previous.row === point.row &&
			previous.scrollView === point.scrollView &&
			previous.wordStart === word.start.col &&
			previous.wordEnd === word.end.col
				? (previous.count % 3) + 1
				: 1;
		this.lastClick = word
			? {
					timestamp: now,
					count,
					row: point.row,
					scrollView: point.scrollView,
					wordStart: word.start.col,
					wordEnd: word.end.col,
				}
			: undefined;
		return count;
	}

	private updateSelectionAutoScroll(event: SgrMouseEvent): void {
		const scrollView = this.selectionAnchor?.scrollView;
		if (!scrollView || !this.currentLayout) {
			this.stopSelectionAutoScroll();
			return;
		}
		const box = getScrollViewBox(this.currentLayout, scrollView);
		if (!box || box.rect.height <= 0 || box.clip.height <= 0) {
			this.stopSelectionAutoScroll();
			return;
		}
		const visibleTop = Math.max(0, box.rect.y, box.clip.y);
		const visibleBottom = Math.min(
			this.terminal.rows - 1,
			box.rect.y + box.rect.height - 1,
			box.clip.y + box.clip.height - 1,
		);
		this.selectionDragPointer = { x: event.x, y: event.y };
		this.selectionAutoScrollDirection = event.y <= visibleTop ? -1 : event.y >= visibleBottom ? 1 : 0;
		if (this.selectionAutoScrollDirection === 0) {
			this.stopSelectionAutoScroll();
			return;
		}
		if (this.selectionAutoScrollTimer) return;
		this.selectionAutoScrollTimer = setInterval(() => this.autoScrollSelection(), 50);
		this.selectionAutoScrollTimer.unref();
	}

	private autoScrollSelection(): void {
		const scrollView = this.selectionAnchor?.scrollView;
		const pointer = this.selectionDragPointer;
		const direction = this.selectionAutoScrollDirection;
		if (!scrollView || !pointer || direction === 0) {
			this.stopSelectionAutoScroll();
			return;
		}
		const remaining = scrollView.scrollBy(direction);
		if (remaining === direction) {
			this.stopSelectionAutoScroll();
			return;
		}
		const point = this.getScrollSelectionPoint(scrollView, pointer.x, pointer.y);
		if (point) this.updateSelectionFocus(point);
		this.requestRender();
	}

	private stopSelectionAutoScroll(): void {
		if (this.selectionAutoScrollTimer) {
			clearInterval(this.selectionAutoScrollTimer);
			this.selectionAutoScrollTimer = undefined;
		}
		this.selectionAutoScrollDirection = 0;
		this.selectionDragPointer = undefined;
	}

	private handleSelectionMouseEvent(event: SgrMouseEvent): void {
		const button = event.button & 3;
		if (button !== 0 && !(event.release && button === 3)) return;
		const anchorScrollView = this.selectionAnchor?.scrollView;
		const point = this.getSelectionPoint(event, anchorScrollView);
		if (event.release) {
			if (!this.selectionPressActive) return;
			this.selectionPressActive = false;
			this.stopSelectionAutoScroll();
			if (!this.selectionAnchor) return;
			// A drag already set its endpoint on the last motion event, and a press that scrolled the
			// view has an endpoint that no longer means the same row. Deriving it again from this
			// event's screen row would copy rows the user never dragged over.
			if (!this.selectionDragged && this.selectionPinnedScrollView?.movedWhileSuspended !== true) {
				this.updateSelectionFocus(point);
			}
			this.releaseSelectionScrollPin("resume");
			const isClick =
				!this.selectionDragged &&
				this.selectionAnchor.scrollView === point.scrollView &&
				this.selectionAnchor.row === point.row &&
				this.selectionAnchor.col === point.col;
			const clickedUrl = isClick ? this.pressedUrl : undefined;
			this.pressedUrl = undefined;
			if (clickedUrl && this.openUrl) {
				this.selectionAnchor = undefined;
				this.selectionFocus = undefined;
				try {
					this.openUrl(clickedUrl);
				} catch {
					// URL activation is best-effort.
				}
				this.requestRender();
				return;
			}
			if (isClick) {
				const clickEvent = this.createMouseEvent("click", event.button, event.x, event.y, {
					clickCount: this.lastClick?.count ?? 1,
				});
				const overlay = this.dispatchMouseToOverlay(clickEvent);
				const result = overlay.result ?? (overlay.hit ? undefined : this.dispatchMouseToLayout(clickEvent));
				if (result) {
					const render = this.applyMouseDispatchResult(clickEvent, result);
					this.clearTextSelection();
					if (render) this.requestRender();
					return;
				}
			}
			if (this.copyOnSelect) void this.copySelectionToClipboard();
			this.requestRender();
			return;
		}
		if ((event.button & 32) !== 0) {
			if (!this.selectionPressActive || !this.selectionAnchor) return;
			this.selectionDragged = true;
			this.lastClick = undefined;
			this.pressedUrl = undefined;
			this.updateSelectionFocus(point);
			this.updateSelectionAutoScroll(event);
			this.requestRender();
			return;
		}
		this.stopSelectionAutoScroll();
		const surface =
			this.selection?.surfaces === undefined ? undefined : this.resolveSelectionSurface(event.x, event.y);
		// A scoped selection owns only its published surfaces; anywhere else keeps the event.
		if (this.selection?.surfaces !== undefined && !surface) return;
		this.selectionPressActive = true;
		this.selectionSurface = surface;
		const scrollView =
			surface && surface.component instanceof ScrollView
				? surface.component
				: !this.hasOverlay() && this.currentLayout
					? getScrollViewsAt(this.currentLayout, event.x, event.y)[0]
					: undefined;
		const anchor = this.getSelectionPoint(event, scrollView);
		const word = this.getWordSelection(anchor);
		const clickCount = this.getClickCount(anchor, word);
		const range = clickCount === 2 ? word : clickCount === 3 ? this.getLineSelection(anchor) : undefined;
		this.selectionGranularity = range ? (clickCount === 2 ? "word" : "line") : "character";
		this.selectionInitialRange = range;
		this.selectionAnchor = range?.start ?? anchor;
		this.selectionFocus = range?.end ?? anchor;
		this.selectionDragged = false;
		this.pinSelectionScrollView(scrollView);
		this.pressedUrl = range
			? undefined
			: getOsc8LinkAtColumn(
					this.previousScreen[Math.max(0, Math.min(this.terminal.rows - 1, event.y))] ?? "",
					Math.max(0, Math.min(this.terminal.columns - 1, event.x)),
				);
		this.requestRender();
	}

	private getSelectionBounds(): { start: SelectionPoint; end: SelectionPoint } | undefined {
		if (!this.selectionAnchor || !this.selectionFocus) return undefined;
		if (this.selectionAnchor.scrollView !== this.selectionFocus.scrollView) return undefined;
		const anchorBeforeFocus =
			this.selectionAnchor.row < this.selectionFocus.row ||
			(this.selectionAnchor.row === this.selectionFocus.row && this.selectionAnchor.col < this.selectionFocus.col);
		if (
			this.selectionAnchor.row === this.selectionFocus.row &&
			this.selectionAnchor.col === this.selectionFocus.col
		) {
			return undefined;
		}
		return anchorBeforeFocus
			? { start: this.selectionAnchor, end: this.selectionFocus }
			: { start: this.selectionFocus, end: this.selectionAnchor };
	}

	private getSelectionColumns(
		line: string,
		row: number,
		selection: { start: SelectionPoint; end: SelectionPoint },
		minColumn = 0,
		maxColumn = visibleWidth(line),
	): { start: number; end: number } {
		const lineWidth = visibleWidth(line);
		let start = Math.max(0, minColumn);
		let end = Math.min(lineWidth, maxColumn);
		if (row === selection.start.row) {
			start = getGraphemeCellRange(line, selection.start.col)?.start ?? Math.min(selection.start.col, lineWidth);
		}
		if (row === selection.end.row) {
			end = selection.end.boundary
				? Math.min(selection.end.col, lineWidth)
				: (getGraphemeCellRange(line, selection.end.col)?.end ?? Math.min(selection.end.col + 1, lineWidth));
		}
		return { start: Math.max(minColumn, start), end: Math.min(maxColumn, end) };
	}

	private getActiveSelectionText(): string | undefined {
		const selection = this.getSelectionBounds();
		if (!selection) return undefined;
		let sourceLines: readonly string[] = this.previousScreen;
		if (selection.start.scrollView) {
			if (!this.currentLayout) return undefined;
			const scrollLines = materializeScrollLines(this.currentLayout, selection.start.scrollView);
			if (!scrollLines) return undefined;
			sourceLines = scrollLines;
		}
		const lines: string[] = [];
		for (let row = selection.start.row; row <= selection.end.row; row++) {
			const line = sourceLines[row] ?? "";
			const columns = this.getSelectionColumns(line, row, selection);
			lines.push(
				stripTerminalSequences(
					sliceByColumn(line, columns.start, Math.max(0, columns.end - columns.start), true),
				).trimEnd(),
			);
		}
		const text = lines.join("\n");
		const normalized = this.selection?.normalizeText?.(text, this.selectionSurface?.kind ?? "") ?? text;
		return normalized.length === 0 ? undefined : normalized;
	}

	private async copySelectionToClipboard(): Promise<boolean> {
		const text = this.getActiveSelectionText();
		if (!text) return false;
		return this.copyTextToClipboard(text);
	}

	private async copyTextToClipboard(text: string): Promise<boolean> {
		// Prefer an injected clipboard implementation (native clipboard + platform tools with a
		// verified success path) when the host app provides one. A bare OSC 52 write can show
		// "Copied!" while leaving the system clipboard untouched (e.g. macOS Terminal.app, tmux
		// without OSC 52 clipboard passthrough), so only report success when it actually copies.
		if (this.copySelection) {
			const result = await this.copySelection(text);
			const ok = result === true;
			const detail = typeof result === "string" ? result : undefined;
			if (this.onCopyResult) this.onCopyResult({ ok, detail, graphemes: countGraphemes(text) });
			else this.flash(ok ? "Copied!" : (detail ?? "Copy failed"), ok ? undefined : COPY_ERROR_FLASH_DURATION_MS);
			return ok;
		}
		this.terminal.write(`\x1b]52;c;${Buffer.from(text).toString("base64")}\x07`);
		if (this.onCopyResult) this.onCopyResult({ ok: true, graphemes: countGraphemes(text) });
		else this.flash("Copied!");
		return true;
	}

	private applySearchTextHighlight(text: string, current: boolean): string {
		const style = current ? this.searchCurrentMatchStyle : this.searchMatchStyle;
		let result = "";
		let plainStart = 0;
		let index = 0;
		while (index < text.length) {
			const ansi = extractAnsiCode(text, index);
			if (!ansi) {
				index += 1;
				continue;
			}
			if (index > plainStart) result += style(text.slice(plainStart, index));
			result += ansi.code;
			index += ansi.length;
			plainStart = index;
		}
		if (plainStart < text.length) result += style(text.slice(plainStart));
		return result;
	}

	private applySearchHighlights(screen: string[], layout: LayoutFrame): string[] {
		const search = this.activeSearch;
		if (!search || search.selectedIndex < 0 || search.matches.length === 0) return screen;
		const scrollView = layout.primaryScrollView ?? this.implicitScrollView;
		const box = getScrollViewBox(layout, scrollView);
		if (!box) return screen;

		const rangesByRow = new Map<number, SearchHighlightRange[]>();
		const scrollbarColumn = getScrollbarGeometry(box)?.column;
		const minRow = Math.max(0, box.rect.y, box.clip.y);
		const maxRow = Math.min(screen.length, box.rect.y + box.rect.height, box.clip.y + box.clip.height);
		const minColumn = Math.max(0, box.rect.x, box.clip.x);
		const maxColumn = Math.min(
			this.terminal.columns,
			box.rect.x + box.rect.width,
			box.clip.x + box.clip.width,
			scrollbarColumn ?? Number.POSITIVE_INFINITY,
		);
		const minContentRow = scrollView.scrollTop + minRow - box.rect.y;
		const maxContentRow = scrollView.scrollTop + maxRow - box.rect.y - 1;
		let low = 0;
		let high = search.matches.length;
		while (low < high) {
			const middle = low + Math.floor((high - low) / 2);
			const match = search.matches[middle]!;
			const lastRow = match.segments[match.segments.length - 1]?.row ?? -1;
			if (lastRow < minContentRow) low = middle + 1;
			else high = middle;
		}
		for (let matchIndex = low; matchIndex < search.matches.length; matchIndex++) {
			const match = search.matches[matchIndex]!;
			if ((match.segments[0]?.row ?? 0) > maxContentRow) break;
			for (const segment of match.segments) {
				const row = box.rect.y + segment.row - scrollView.scrollTop;
				if (row < minRow || row >= maxRow) continue;
				const startCol = Math.max(minColumn, box.rect.x + segment.startCol);
				const endCol = Math.min(maxColumn, box.rect.x + segment.endCol);
				if (endCol <= startCol) continue;
				const ranges = rangesByRow.get(row) ?? [];
				ranges.push({ startCol, endCol, current: matchIndex === search.selectedIndex });
				rangesByRow.set(row, ranges);
			}
		}

		const result = [...screen];
		for (const [row, ranges] of rangesByRow) {
			let line = result[row] ?? "";
			if (isImageLine(line)) continue;
			const lineWidth = visibleWidth(line);
			for (const range of ranges.sort((a, b) => b.startCol - a.startCol)) {
				const startCol = Math.min(range.startCol, lineWidth);
				const endCol = Math.min(range.endCol, lineWidth);
				if (endCol <= startCol) continue;
				const before = sliceByColumn(line, 0, startCol, true);
				const highlighted = sliceByColumn(line, startCol, endCol - startCol, true);
				const after = sliceByColumn(line, endCol, Math.max(0, lineWidth - endCol), true);
				line = `${before}${this.applySearchTextHighlight(highlighted, range.current)}${after}`;
			}
			result[row] = line;
		}
		return result;
	}

	private applySelectionHighlight(text: string): string {
		const highlight = this.selection?.highlight;
		if (highlight) {
			const open = selectionHighlightOpen(highlight);
			if (!open || !text.includes("\x1b")) return highlight(text);
			// Re-open the host's style after every SGR so an inner reset cannot drop it.
			return highlight(text.replace(/\x1b\[[0-9;:]*m/g, (sequence) => `${sequence}${open}`));
		}
		let result = "\x1b[7m";
		let index = 0;
		while (index < text.length) {
			const ansi = extractAnsiCode(text, index);
			if (!ansi) {
				result += text[index];
				index += 1;
				continue;
			}
			result += ansi.code;
			if (ansi.code.endsWith("m")) result += "\x1b[7m";
			index += ansi.length;
		}
		return `${result}\x1b[27m`;
	}

	private applySelection(screen: string[], layout = this.currentLayout): string[] {
		const selection = this.getSelectionBounds();
		if (!selection) return screen;
		let screenSelection = selection;
		let minRow = 0;
		let maxRow = screen.length - 1;
		let minColumn = 0;
		let maxColumn = this.terminal.columns;
		if (selection.start.scrollView) {
			if (!layout) return screen;
			const box = getScrollViewBox(layout, selection.start.scrollView);
			if (!box) return screen;
			minRow = Math.max(0, box.rect.y, box.clip.y);
			maxRow = Math.min(screen.length - 1, box.rect.y + box.rect.height - 1, box.clip.y + box.clip.height - 1);
			minColumn = Math.max(0, box.rect.x, box.clip.x);
			maxColumn = Math.min(this.terminal.columns, box.rect.x + box.rect.width, box.clip.x + box.clip.width);
			screenSelection = {
				start: {
					...selection.start,
					row: box.rect.y + selection.start.row - selection.start.scrollView.scrollTop,
					col: box.rect.x + selection.start.col,
				},
				end: {
					...selection.end,
					row: box.rect.y + selection.end.row - selection.start.scrollView.scrollTop,
					col: box.rect.x + selection.end.col,
				},
			};
		} else {
			const rect = this.activeSelectionRect(layout);
			if (rect) {
				minRow = Math.max(0, rect.y);
				maxRow = Math.min(screen.length - 1, rect.y + rect.height - 1);
				minColumn = Math.max(0, rect.x);
				maxColumn = Math.min(this.terminal.columns, rect.x + rect.width);
			}
		}
		return screen.map((line, row) => {
			if (
				row < minRow ||
				row > maxRow ||
				row < screenSelection.start.row ||
				row > screenSelection.end.row ||
				isImageLine(line)
			) {
				return line;
			}
			const lineWidth = visibleWidth(line);
			const columns = this.getSelectionColumns(line, row, screenSelection, minColumn, maxColumn);
			if (columns.end <= columns.start) return line;
			const before = sliceByColumn(line, 0, columns.start, true);
			const selected = sliceByColumn(line, columns.start, columns.end - columns.start, true);
			const after = sliceByColumn(line, columns.end, Math.max(0, lineWidth - columns.end), true);
			return `${before}${this.applySelectionHighlight(selected)}${after}`;
		});
	}

	private isMouseSequence(data: string): boolean {
		return /^\x1b\[<\d+;\d+;\d+[Mm]$/.test(data) || (data.length === 6 && data.startsWith("\x1b[M"));
	}

	private compositeScrollToEndIndicator(screen: string[], layout: LayoutFrame, width: number): string[] {
		// A label whose cells moved is no longer the label the pointer was over.
		const previousRect = this.scrollToEndIndicatorRect;
		this.scrollToEndIndicatorRect = undefined;
		const scrollView = layout.primaryScrollView ?? this.implicitScrollView;
		if (!this.scrollToEndIndicator || !scrollView.followEnd || scrollView.isFollowingEnd) {
			this.scrollToEndIndicatorHover = false;
			return screen;
		}
		const box = getScrollViewBox(layout, scrollView);
		const clip = box?.clip;
		if (!clip || clip.width <= 0 || clip.height <= 0) {
			this.scrollToEndIndicatorHover = false;
			return screen;
		}
		const row = clip.y + clip.height - 1;
		if (row >= screen.length || isImageLine(screen[row] ?? "")) {
			this.scrollToEndIndicatorHover = false;
			return screen;
		}
		const scrollbarColumn = box ? getScrollbarGeometry(box)?.column : undefined;
		const label = truncateToWidth(this.scrollToEndIndicator(this.scrollToEndIndicatorHover), clip.width, "");
		const labelWidth = visibleWidth(label);
		const column = clip.x + Math.floor((clip.width - labelWidth) / 2);
		const rightEdge = scrollbarColumn ?? clip.x + clip.width;
		const availableWidth = Math.max(0, rightEdge - column);
		const text = truncateToWidth(label, availableWidth, "");
		const textWidth = visibleWidth(text);
		if (textWidth === 0) {
			this.scrollToEndIndicatorHover = false;
			return screen;
		}
		const result = [...screen];
		result[row] = compositeTuiLine(result[row] ?? "", text, column, textWidth, width);
		this.scrollToEndIndicatorRect = { row, column, width: textWidth };
		if (
			this.scrollToEndIndicatorHover &&
			previousRect &&
			(previousRect.row !== row || previousRect.column !== column || previousRect.width !== textWidth)
		) {
			// This frame drew the label with the old hover; repaint it where it sits now.
			this.scrollToEndIndicatorHover = false;
			this.requestRender();
		}
		return result;
	}

	private compositeFlashes(screen: string[], width: number, height: number): string[] {
		const flashLines = this.flashes.render(width).slice(-height);
		if (flashLines.length === 0) return screen;
		const result = [...screen];
		while (result.length < height) result.push("");
		for (let row = 0; row < flashLines.length; row++) {
			const line = flashLines[row]!;
			const flashWidth = visibleWidth(line);
			if (flashWidth === 0) continue;
			result[row] = compositeTuiLine(result[row] ?? "", line, width - flashWidth, flashWidth, width);
		}
		return result;
	}

	protected override doRender(): void {
		if (this.stopped || !this.altScreenActive) return;
		const width = Math.max(1, this.terminal.columns);
		const height = Math.max(1, this.terminal.rows);
		if (this.previousScreenWidth !== width || this.previousScreenHeight !== height) {
			// The geometry every hover was measured against just moved. Drop it; the next move
			// re-establishes whatever is under the pointer.
			this.clearHoverTarget();
			this.stopScrollbarHover();
			this.scrollToEndIndicatorHover = false;
		}
		const root = this.layoutRoot ?? this.implicitScrollView;
		let nextLayout = renderLayoutFrame(root, width, height, () => this.requestRender());
		if (this.refreshSearch(nextLayout)) {
			nextLayout = renderLayoutFrame(root, width, height, () => this.requestRender());
		}
		let screen = nextLayout.lines.map((line) => line.replace(OSC133_ZONE_PREFIX, ""));
		screen = this.applySearchHighlights(screen, nextLayout);
		screen = this.compositeScrollToEndIndicator(screen, nextLayout, width);
		screen = this.compositeOverlays(screen, width, height);
		if (screen.length > height) screen = screen.slice(screen.length - height);
		screen = this.applySelection(screen, nextLayout);
		screen = this.compositeFlashes(screen, width, height);

		const cursorPos = this.extractCursorPosition(screen, height);
		screen = this.applyLineResets(screen).map((line) => {
			if (isImageLine(line) || visibleWidth(line) <= width) return line;
			return sliceByColumn(line, 0, width, true);
		});

		const fullRedraw =
			this.previousScreen.length === 0 || this.previousScreenWidth !== width || this.previousScreenHeight !== height;
		const imagesNeedRedraw = screen.some(
			(line, row) =>
				line !== this.previousScreen[row] && (isImageLine(line) || isImageLine(this.previousScreen[row] ?? "")),
		);
		const redrawImages = fullRedraw || imagesNeedRedraw;
		const hadUploadedKittyImages = this.uploadedKittyImages.size > 0;
		const preparedKittyScreen =
			redrawImages && this.imageProtocol === "kitty"
				? this.prepareKittyScreen(screen)
				: { lines: screen, evictedImageDeletion: "" };

		let buffer = BEGIN_SYNCHRONIZED_OUTPUT;
		if (fullRedraw) {
			this.fullRedrawCount += 1;
			const clearImages =
				this.imageProtocol === "kitty" && hadUploadedKittyImages
					? deleteAllKittyPlacements()
					: this.deleteKittyImages();
			buffer += `${clearImages}\x1b[2J`;
		} else if (imagesNeedRedraw) {
			if (this.imageProtocol === "iterm2") buffer += "\x1b[2J";
			else if (this.imageProtocol === "kitty") buffer += deleteAllKittyPlacements();
		}
		buffer += preparedKittyScreen.evictedImageDeletion;

		// WezTerm erases intersecting Kitty image cells when a later EL clears a covered row.
		// Only separate clearing from drawing for WezTerm frames that place images; preserve the
		// existing interleaved output for text-only frames and every other terminal.
		const clearRowsBeforeKittyImages =
			redrawImages &&
			this.imageProtocol === "kitty" &&
			screen.some(isImageLine) &&
			(Boolean(process.env.WEZTERM_PANE) || process.env.TERM_PROGRAM?.toLowerCase() === "wezterm");
		if (clearRowsBeforeKittyImages) {
			for (let row = 0; row < height; row++) {
				if (!fullRedraw && !imagesNeedRedraw && screen[row] === this.previousScreen[row]) continue;
				buffer += `\x1b[${row + 1};1H\x1b[2K`;
			}
		}

		for (let row = 0; row < height; row++) {
			if (!fullRedraw && !imagesNeedRedraw && screen[row] === this.previousScreen[row]) continue;
			buffer += `\x1b[${row + 1};1H${clearRowsBeforeKittyImages ? "" : "\x1b[2K"}${preparedKittyScreen.lines[row] ?? ""}`;
		}

		if (cursorPos) {
			buffer += `\x1b[${cursorPos.row + 1};${Math.min(width, cursorPos.col) + 1}H`;
			buffer += this.getShowHardwareCursor() ? "\x1b[?25h" : "\x1b[?25l";
		} else {
			buffer += "\x1b[?25l";
		}
		buffer += END_SYNCHRONIZED_OUTPUT;
		this.terminal.write(buffer);

		this.previousScreen = screen;
		this.previousScreenWidth = width;
		this.previousScreenHeight = height;
		this.currentLayout = nextLayout;
	}
}
