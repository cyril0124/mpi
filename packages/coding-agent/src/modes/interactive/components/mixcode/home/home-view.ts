/**
 * MixCode Home page: the masthead, the Agent View roster, the conversation
 * preview, and the `+ New session` / `[ Resume ]` actions.
 *
 * The mode owns the data; this component owns layout and mouse hit-testing.
 * Rendered lines are exactly `width` columns wide so the surface can replace the
 * transcript inside the scroll view without shifting the layout.
 */
import {
	type Component,
	type TuiMouseEvent,
	type TuiMouseEventResult,
	truncateToWidth,
	visibleWidth,
} from "@earendil-works/pi-tui";
import { visibleRosterIndices } from "../../../../../core/mixcode/home/home-state.ts";
import { isWorkingStatus } from "../../../../../core/mixcode/multi-tab/types.ts";
import { theme } from "../../../theme/theme.ts";
import { compactWorkdir, padLine, windowStart } from "../layout-text.ts";
import { tabColorPaint, tabStatusGlyph } from "../multi-tab/tab-bar.ts";
import { paintBackground } from "../panel.ts";
import {
	AGENT_CARD_HEIGHT,
	cachedOutputPreview,
	cachedPreviewBlock,
	formatContextUsage,
	formatElapsed,
	formatRelativeAge,
	formatToolCallPreview,
	type HomeCard,
	type HomeChatMessage,
	joinColumns,
	latestOutputPreview,
	lineEnds,
	previewRows,
	singleLinePreview,
	wrapPreviewTail,
} from "./home-model.ts";

/** A roster card plus the transcript text its previews read. */
export interface HomeAgentEntry {
	card: HomeCard;
	messages: readonly HomeChatMessage[];
}

/** Everything the page renders for one frame. */
export interface HomeViewModel {
	version: string;
	workdir: string;
	workingCount: number;
	/** Outdated extension packages the startup check reported; absent when it found none. */
	packageUpdates?: readonly string[];
	agents: readonly HomeAgentEntry[];
	selectedIndex: number;
	nonIdleOnly: boolean;
	/** True while a dialog owns the screen, so the buttons drop their capture. */
	overlayOpen: boolean;
}

/** Action a button on the heading fires. */
export type HomeAction = "new-session" | "resume";

interface ActionRegion {
	action: HomeAction;
	label: string;
	/** Zero-based column of the label start within the rendered line. */
	x: number;
	/** Zero-based row index within this component's rendered lines. */
	y: number;
}

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const SPINNER_INTERVAL_MS = 80;
/** Action button labels; the compact form is used when the full one does not fit. */
const NEW_SESSION_LABEL = " + New session ";
const NEW_SESSION_COMPACT_LABEL = " + New ";
/** Command that updates the outdated extension packages the masthead reports. */
const PACKAGE_UPDATE_COMMAND = "pi update --extensions";
const PREVIEW_HEIGHT_PERCENT = 15;
const MIN_PREVIEW_ROWS = 4;
const DEFAULT_PREVIEW_ROWS = 6;
/** Page insets: generous on a wide terminal, minimal on a narrow one, none below that. */
const WIDE_INSET_WIDTH = 80;
const WIDE_INSET = 3;
const NARROW_INSET_WIDTH = 4;
const NARROW_INSET = 1;
/** Above this row budget the masthead gains its two blank rows. */
const ROOMY_MASTHEAD_ROWS = 18;
/** Below this row budget the table keeps only the selected card or the buttons. */
const TINY_TABLE_ROWS = 4;
/** Below this row budget the heading cannot spend a second row on the buttons. */
const TWO_ROW_HEADING_BUDGET = 5;
/** The roster and the conversation pane sit side by side only at this width and budget. */
const SPLIT_MIN_WIDTH = 114;
const SPLIT_MIN_ROWS = 18;
/** Share of the body the roster keeps when split; the rest goes to the conversation. */
const SPLIT_LIST_SHARE = 0.44;
/** Detail rows the conversation pane shows before the roster is measured. */
const MIN_DETAIL_ROWS = 12;
/** Columns reserved on a card line for the status chip, and for its surrounding gap. */
const CARD_CHIP_RESERVE = 14;
const CARD_TITLE_RESERVE = 6;
/** Gap between the hint phrases, and the number of hints never trimmed away. */
const HINT_GAP = "  ";
const KEPT_HINTS = 2;
/** Rows the `older`/`newer` markers take when the roster is windowed. */
const ROSTER_MARKER_ROWS = 2;
/** Prefix before a card's message text; its width is what the text has to give up. */
const CARD_TEXT_PREFIX = "  ⎿ ";

/** Where the action buttons go when they cannot share a row with the heading. */
type HeadingLayout = "heading-first" | "actions-first";

/**
 * The `+ New session` / `[ Resume ]` buttons. Capture state is per rendered
 * viewport: a resize or an overlay opening resets it, so a stale press can never
 * fire against a button that moved.
 */
export class HomeActions {
	pending = false;
	private regions: ActionRegion[] = [];
	private hovered?: HomeAction;
	private pressed?: HomeAction;
	private viewport = "";

	/**
	 * Called once per frame before rendering; clears capture when the shape or the
	 * overlay state changed, so a press cannot survive a resize or a dialog.
	 */
	beginFrame(width: number, height: number | undefined, overlayOpen: boolean): void {
		const viewport = `${width}:${height}:${overlayOpen}`;
		if (this.viewport !== viewport) this.reset();
		this.viewport = viewport;
	}

	reset(): void {
		this.regions = [];
		this.hovered = undefined;
		this.pressed = undefined;
	}

	/**
	 * Render the heading with the action buttons. `origin` is where this
	 * component's first cell starts inside the page body, so the recorded hit
	 * regions line up with the drawn row. `layout` decides which of the two keeps
	 * the first row when both cannot share one. Returns one line when the heading
	 * fits beside the buttons, two when it does not, and just the heading when
	 * there is no room for buttons.
	 */
	renderHeading(
		heading: string,
		width: number,
		origin: { x: number; y: number },
		maxRows: number,
		layout: HeadingLayout,
	): string[] {
		const buttons: Array<{ action: HomeAction; label: string }> = [
			{
				action: "new-session",
				label: width >= visibleWidth(NEW_SESSION_LABEL) ? NEW_SESSION_LABEL : NEW_SESSION_COMPACT_LABEL,
			},
			{ action: "resume", label: "[ Resume ]" },
		];
		if (width < visibleWidth(buttons[0]!.label)) {
			this.reset();
			return heading ? [heading] : [];
		}
		if (width < visibleWidth(buttons[0]!.label) + 1 + visibleWidth(buttons[1]!.label)) buttons.pop();
		const buttonWidth = buttons.reduce((total, button) => total + visibleWidth(button.label), 0) + buttons.length - 1;
		const inline = Boolean(heading) && visibleWidth(heading) + 2 + buttonWidth <= width;
		if (!inline && heading && maxRows < 2 && layout === "heading-first") {
			this.reset();
			return [heading];
		}
		const separateHeading = !inline && Boolean(heading) && maxRows >= 2;
		const startX = inline ? width - buttonWidth : 0;
		const row = separateHeading ? 1 : 0;
		let column = startX;
		const regions = buttons.map((button) => {
			const region = { ...button, x: origin.x + column, y: origin.y + row };
			column += visibleWidth(button.label) + 1;
			return region;
		});
		if (
			this.regions.length !== regions.length ||
			regions.some((region, index) => {
				const previous = this.regions[index];
				return previous?.x !== region.x || previous.y !== region.y || previous.label !== region.label;
			})
		) {
			this.reset();
		}
		this.regions = regions;
		const bar = regions.map((region) => this.paint(region)).join(" ");
		if (inline) return [heading + " ".repeat(startX - visibleWidth(heading)) + bar];
		return separateHeading ? [heading, bar] : [bar];
	}

	/** Hit-test one mouse event. Only press/release/hover transitions are reported. */
	handleMouse(mouse: TuiMouseEvent): { consume: boolean; changed: boolean; action?: HomeAction } {
		const region = this.regions.find(
			(candidate) =>
				mouse.y === candidate.y && mouse.x >= candidate.x && mouse.x < candidate.x + visibleWidth(candidate.label),
		);
		const previousHover = this.hovered;
		const previousPress = this.pressed;
		const target = region?.action;
		let action: HomeAction | undefined;
		const primary = mouse.button === "left";
		const passive = mouse.type === "move" && mouse.button === "none";
		const isRelease = mouse.type === "release";
		const isPress = mouse.type === "press";
		if (primary || passive) {
			this.hovered = target;
			if (isRelease) {
				if (primary && target && target === this.pressed && !this.pending) action = target;
				this.pressed = undefined;
			} else if (mouse.type === "move" || mouse.type === "drag") {
				// Leaving a pressed target cancels, even if the pointer later returns.
				if (target !== this.pressed || passive) this.pressed = undefined;
			} else if (isPress && !this.pending) {
				this.pressed = target;
			}
		} else {
			this.pressed = undefined;
		}
		return {
			consume: Boolean(previousPress || (target && (primary || passive))),
			changed: previousHover !== this.hovered || previousPress !== this.pressed,
			action,
		};
	}

	private paint(region: ActionRegion): string {
		const label = region.label;
		if (this.pending) return theme.fg("dim", label);
		const hovered = this.hovered === region.action;
		const pressed = this.pressed === region.action;
		const labelled = theme.bold(label);
		const accent = theme.fg("accent", labelled);
		if (region.action === "new-session") {
			if (pressed) return theme.bg("selectedBg", accent);
			// Inverse video paints over the accent; underline marks hover without it.
			return hovered ? `\x1b[7m\x1b[4m${accent}\x1b[24m\x1b[27m` : accent;
		}
		if (pressed) return `\x1b[7m${accent}\x1b[27m`;
		if (hovered) return theme.bg("selectedBg", accent);
		return `${theme.fg("borderMuted", "[")}${theme.fg("text", " Resume ")}${theme.fg("borderMuted", "]")}`;
	}
}

/**
 * Home page component. `getHeight` supplies the row budget the surrounding
 * scroll view currently offers, so the page fills the viewport exactly instead
 * of scrolling.
 */
export class HomeView implements Component {
	private lines: string[] = [];
	private readonly actions = new HomeActions();
	private readonly getModel: () => HomeViewModel;
	private readonly getHeight: () => number | undefined;
	private readonly onAction: (action: HomeAction) => void;

	constructor(options: {
		getModel: () => HomeViewModel;
		getHeight: () => number | undefined;
		onAction: (action: HomeAction) => void;
	}) {
		this.getModel = options.getModel;
		this.getHeight = options.getHeight;
		this.onAction = options.onAction;
	}

	/** Drop hover/press capture; used when Home is hidden. */
	resetCapture(): void {
		this.actions.reset();
	}

	/**
	 * Mark the heading buttons busy while their command runs: the labels dim and
	 * presses are ignored, so a double click cannot start two sessions.
	 */
	setActionPending(pending: boolean): void {
		this.actions.pending = pending;
	}

	invalidate(): void {
		this.lines = [];
	}

	render(width: number): string[] {
		if (width <= 0) {
			this.lines = [];
			return [];
		}
		this.lines = renderHome(this.getModel(), width, this.getHeight(), this.actions);
		return this.lines;
	}

	handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
		// Only the action buttons are clickable; the roster itself is keyboard-driven.
		const route = this.actions.handleMouse(event);
		if (route.action) {
			this.onAction(route.action);
			return { handled: true, render: true };
		}
		// `render` is only honoured on a result the dispatcher keeps, so a hover
		// change has to count as handled or the highlight never repaints.
		if (route.consume || route.changed) return { handled: route.consume || route.changed, render: route.changed };
		return undefined;
	}
}

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

/** Masthead above the table, then the Agent View table itself, padded to the full width. */
function renderHome(view: HomeViewModel, width: number, height: number | undefined, actions: HomeActions): string[] {
	const inset = width >= WIDE_INSET_WIDTH ? WIDE_INSET : width >= NARROW_INSET_WIDTH ? NARROW_INSET : 0;
	const bodyWidth = Math.max(0, width - inset * 2);
	actions.beginFrame(width, height, view.overlayOpen);
	const brand = `${theme.fg("accent", theme.bold("MixCode"))} ${theme.fg("dim", "/ HOME")}`;
	const activity = [view.workingCount ? theme.fg("accent", `${view.workingCount} working`) : ""]
		.filter(Boolean)
		.join(theme.fg("dim", "  ·  "));
	const roomy = height === undefined || height >= ROOMY_MASTHEAD_ROWS;
	// The workdir yields whatever the activity counters are not using.
	const activityWidth = activity ? visibleWidth(activity) + 2 : 0;
	const workdir = theme.fg(
		"dim",
		compactWorkdir(singleLinePreview(view.workdir), Math.max(0, bodyWidth - activityWidth)),
	);
	const header = [
		...(roomy ? [""] : []),
		lineEnds(brand, theme.fg("dim", `v${view.version}`), bodyWidth),
		lineEnds(workdir, activity, bodyWidth),
		theme.fg("borderMuted", "─".repeat(bodyWidth)),
		...(roomy ? [""] : []),
	];
	const updates = renderPackageUpdateNotice(view.packageUpdates ?? [], bodyWidth);
	// The roster keeps at least four rows: the notice list is what gets clipped.
	const headerBudget = height === undefined ? header.length + updates.length : Math.max(0, height - 4);
	const top = [...header, ...updates].slice(0, headerBudget);
	if (updates.length > 0 && header.length + updates.length > headerBudget && top.length > header.length) {
		top[top.length - 1] = theme.fg("warning", `… more package updates · ${PACKAGE_UPDATE_COMMAND}`);
	}
	const body = renderAgentViewTable(view, bodyWidth, height === undefined ? undefined : height - top.length, actions, {
		x: inset,
		y: top.length,
	});
	return [...top, ...body].map((line) => padLine(`${" ".repeat(inset)}${padLine(line, bodyWidth)}`, width));
}

/** Heading and hints wrapped around the roster, split into two columns when there is room. */
function renderAgentViewTable(
	view: HomeViewModel,
	width: number,
	maxRows: number | undefined,
	actions: HomeActions,
	origin: { x: number; y: number },
): string[] {
	const budget = maxRows === undefined ? undefined : Math.max(0, Math.floor(maxRows));
	const visible = visibleIndices(view);
	const heading = `${theme.bold("Agents")} ${theme.fg("dim", String(visible.length))}${
		view.nonIdleOnly ? `  ${theme.bg("selectedBg", " non-idle ")}` : ""
	}`;
	const hints = [
		"↑/↓: select",
		"→: attach",
		"Enter: send",
		"Tab: cycle tabs",
		view.nonIdleOnly ? "Ctrl+F: all" : "Ctrl+F: non-idle",
	];
	/** Pad to the row budget and replace the reserved last row with the hints. */
	const finish = (lines: string[]): string[] => {
		const content = budget === undefined ? lines : lines.slice(0, Math.max(0, budget - 1));
		if (budget !== undefined) {
			while (content.length < budget - 1) content.push("");
		}
		if (budget !== 0) content.push(theme.fg("dim", hintText(hints, width)));
		return content;
	};
	if (budget !== undefined && budget < TINY_TABLE_ROWS) {
		return renderTinyTable(view, width, budget, visible, actions, origin, finish);
	}
	const split = visible.length > 0 && width >= SPLIT_MIN_WIDTH && (budget === undefined || budget >= SPLIT_MIN_ROWS);
	const listWidth = split ? Math.floor((width - 3) * SPLIT_LIST_SHARE) : width;
	const headings = actions.renderHeading(
		heading,
		listWidth,
		origin,
		budget === undefined || budget >= TWO_ROW_HEADING_BUDGET ? 2 : 1,
		visible.length === 0 ? "actions-first" : "heading-first",
	);
	if (visible.length === 0) {
		return finish([
			...headings,
			theme.fg("borderMuted", "─".repeat(width)),
			theme.fg("dim", view.agents.length === 0 ? "No agent sessions." : "No non-idle agents."),
		]);
	}
	const selectedIndex = visible.includes(view.selectedIndex) ? view.selectedIndex : visible[0]!;
	const selected = view.agents[selectedIndex]!;
	const bodyRows = budget === undefined ? undefined : Math.max(0, budget - headings.length - 2);
	if (split) {
		return finish(renderSplitTable(view, visible, selected, width, listWidth, headings, bodyRows));
	}
	return finish(renderStackedTable(view, width, visible, selected, headings, bodyRows, budget));
}

/** Tiny budget: the action buttons alone, or the selected card, then the hint row. */
function renderTinyTable(
	view: HomeViewModel,
	width: number,
	budget: number,
	visible: number[],
	actions: HomeActions,
	origin: { x: number; y: number },
	finish: (lines: string[]) => string[],
): string[] {
	if (budget === 0) {
		actions.reset();
		return [];
	}
	if (visible.length > 0) actions.reset();
	const rows =
		visible.length === 0
			? actions.renderHeading("", width, origin, 1, "actions-first")
			: renderAgentRoster(view, width, Math.max(1, budget - 1), visible);
	return budget === 1 ? rows.slice(0, 1) : finish(rows);
}

/** Wide layout: the roster left, the selected agent's conversation right. */
function renderSplitTable(
	view: HomeViewModel,
	visible: number[],
	selected: HomeAgentEntry,
	width: number,
	listWidth: number,
	headings: string[],
	bodyRows: number | undefined,
): string[] {
	const previewWidth = width - listWidth - 3;
	const roster = renderAgentRoster(view, listWidth, bodyRows, visible);
	const detailRows = bodyRows ?? Math.max(roster.length, MIN_DETAIL_ROWS);
	const left = [...headings, theme.fg("borderMuted", "─".repeat(listWidth)), ...roster];
	const right = [
		lineEnds(theme.bold("Conversation"), statusChip(selected.card), previewWidth),
		...Array.from({ length: Math.max(0, headings.length - 1) }, () => ""),
		theme.fg("borderMuted", "─".repeat(previewWidth)),
		...renderConversationPreview(selected, previewWidth, detailRows),
	];
	return joinColumns(left, right, listWidth, previewWidth, theme.fg("borderMuted", "│"));
}

/** Single column: the roster, then a bounded preview panel under it when the budget allows. */
function renderStackedTable(
	view: HomeViewModel,
	width: number,
	visible: number[],
	selected: HomeAgentEntry,
	headings: string[],
	bodyRows: number | undefined,
	budget: number | undefined,
): string[] {
	const panelRows = previewSlotRows(bodyRows);
	const rosterRows = bodyRows === undefined ? undefined : Math.max(0, bodyRows - panelRows);
	const roster = renderAgentRoster(view, width, rosterRows, visible);
	const lines = [...headings, theme.fg("borderMuted", "─".repeat(width)), ...roster];
	if (panelRows > 0) {
		lines.push(...renderPreviewPanel(selected, width, budget === undefined ? panelRows : budget - 1 - lines.length));
	}
	return lines;
}

/**
 * Outdated-package block above the roster: the heading, the command that updates
 * them, and one line per package. A trailing blank row separates it from the table.
 */
function renderPackageUpdateNotice(packages: readonly string[], width: number): string[] {
	if (packages.length === 0) return [];
	return [
		theme.fg("warning", theme.bold("Package Updates Available")),
		theme.fg("dim", PACKAGE_UPDATE_COMMAND),
		...packages.map((name) => theme.fg("dim", truncateToWidth(`- ${singleLinePreview(name)}`, width, "…"))),
		"",
	];
}

/** Hints joined by two spaces, dropping from the middle until the row fits; `hints` is not modified. */
function hintText(hints: readonly string[], width: number): string {
	const kept = [...hints];
	while (kept.length > KEPT_HINTS) {
		const joined = kept.join(HINT_GAP);
		if (visibleWidth(joined) <= width) return joined;
		kept.splice(Math.max(KEPT_HINTS, kept.length - 2), 1);
	}
	return kept.join(HINT_GAP);
}

/** Roster indices to draw, honouring the non-idle filter. */
function visibleIndices(view: HomeViewModel): number[] {
	return visibleRosterIndices(
		view.nonIdleOnly,
		view.agents.map((agent) => agent.card),
	);
}

/** Cards for the visible roster indices, windowed around the selection when the budget is short. */
function renderAgentRoster(
	view: HomeViewModel,
	width: number,
	budget: number | undefined,
	visible: number[],
): string[] {
	if (budget === 0) return [];
	const now = Date.now();
	const selectedPosition = Math.max(0, visible.indexOf(view.selectedIndex));
	const windowed = budget !== undefined && visible.length * AGENT_CARD_HEIGHT > budget;
	const markers = windowed && budget !== undefined && budget >= AGENT_CARD_HEIGHT + ROSTER_MARKER_ROWS;
	const count =
		budget === undefined
			? visible.length
			: Math.max(1, Math.floor((budget - (markers ? ROSTER_MARKER_ROWS : 0)) / AGENT_CARD_HEIGHT));
	const start = windowStart(selectedPosition, visible.length, count);
	const end = Math.min(visible.length, start + count);
	const lines: string[] = [];
	if (markers && start > 0) lines.push(theme.fg("dim", "↑ older above"));
	for (let index = start; index < end; index++) {
		lines.push(...renderAgentCard(view.agents[visible[index]!]!, width, index === selectedPosition, now));
	}
	if (markers && end < visible.length) lines.push(theme.fg("dim", "↓ newer below"));
	return budget === undefined ? lines : lines.slice(0, budget);
}

/** Compact screens give rows to the roster before allocating a message preview. */
function previewSlotRows(budget: number | undefined): number {
	if (budget === undefined) return DEFAULT_PREVIEW_ROWS;
	const slot = Math.floor((budget * PREVIEW_HEIGHT_PERCENT) / 100);
	return slot >= MIN_PREVIEW_ROWS && budget >= AGENT_CARD_HEIGHT + slot ? slot : 0;
}

/** One card: title with its status group, meta line, newest-output line, blank row. */
function renderAgentCard(agent: HomeAgentEntry, width: number, selected: boolean, now: number): string[] {
	const card = agent.card;
	const marker = selected ? theme.fg("accent", "› ") : "  ";
	const status = statusChip(card);
	const spinner = spinnerFrame(card, now);
	const statusGroup = truncateToWidth(
		spinner ? `${spinner} ${status}` : status,
		Math.max(0, width - CARD_CHIP_RESERVE),
		"…",
	);
	const titleBudget = Math.max(1, width - visibleWidth(statusGroup) - CARD_TITLE_RESERVE);
	const textWidth = Math.max(0, width - visibleWidth(CARD_TEXT_PREFIX));
	const titleLabel = singleLinePreview(card.title);
	const titleText = `${tabStatusGlyph(card.status, card.unread)} ${truncateToWidth(titleLabel, titleBudget, "…")}`;
	// A colored tab paints the whole title with its own colour pair.
	const title = card.color ? tabColorPaint(card.color)(titleText) : titleSegment(card, titleText);
	const preview = cachedOutputPreview(card.id, agent.messages, textWidth, () =>
		latestOutputPreview(agent.messages, textWidth),
	);
	const rows = [
		lineEnds(`${marker}${title}`, statusGroup, width),
		padLine(`  ${cardMeta(card, now)}`, width),
		theme.fg("dim", padLine(`${CARD_TEXT_PREFIX}${preview}`, width)),
	];
	return [...rows.map((line) => (selected ? paintBackground("selectedBg", line) : line)), ""];
}

/** Conversation rows for the stacked layout, under a full-width rule. */
function renderPreviewPanel(agent: HomeAgentEntry, width: number, maxRows: number): string[] {
	if (maxRows <= 0) return [];
	const innerWidth = Math.max(0, width - 2);
	const divider = theme.fg("borderMuted", "─".repeat(width));
	if (maxRows === 1) return [divider];
	const rows = previewRows(agent.messages, maxRows - 1);
	if (rows.length === 0) return [divider, theme.fg("dim", "  No messages yet")].slice(0, maxRows);
	const lines = rows.map((row) => {
		const prefix = ` ${theme.fg("dim", `${row.role}:`)} `;
		const textBudget = Math.max(1, innerWidth - visibleWidth(prefix));
		const text =
			row.role === "tools"
				? formatToolCallPreview(row.count, textBudget)
				: truncateToWidth(singleLinePreview(row.text), textBudget, "...");
		return `${prefix}${row.role === "tools" ? theme.fg("dim", text) : text}`;
	});
	return [divider, ...lines];
}

/** Title and workdir above the newest wrapped messages for the split layout. */
function renderConversationPreview(agent: HomeAgentEntry, width: number, maxRows: number): string[] {
	if (maxRows <= 0) return [];
	const card = agent.card;
	const heading = [
		theme.bold(truncateToWidth(singleLinePreview(card.title), width, "…")),
		theme.fg("dim", compactWorkdir(singleLinePreview(card.workdir), width)),
		"",
	];
	const available = Math.max(0, maxRows - heading.length);
	const tail = cachedPreviewBlock(card.id, agent.messages, width, available, () =>
		conversationTail(agent, width, available),
	);
	return [...heading, ...tail].slice(0, maxRows);
}

/** Newest messages wrapped to `width`, clipped to `available` rows. */
function conversationTail(agent: HomeAgentEntry, width: number, available: number): string[] {
	const rows = previewRows(agent.messages, available + 1);
	const content: string[] = [];
	for (let index = rows.length - 1; index >= 0 && content.length <= available; index--) {
		const row = rows[index]!;
		if (content.length > 0) content.push("");
		const paint = (text: string) => (row.role === "user" ? theme.fg("accent", text) : theme.fg("dim", text));
		const prefix = `${paint(`${row.role}:`)} `;
		const indent = visibleWidth(prefix);
		const body =
			row.role === "tools"
				? [theme.fg("dim", formatToolCallPreview(row.count, Math.max(0, width - indent)))]
				: wrapPreviewTail(row.text, Math.max(1, width - indent), available + 1);
		for (let line = body.length - 1; line >= 0 && content.length <= available; line--) {
			content.push(`${line === 0 ? prefix : " ".repeat(indent)}${body[line]}`);
		}
	}
	content.reverse();
	if (content.length === 0) content.push(theme.fg("dim", "No messages yet"));
	if (content.length > available && available > 1) {
		return [theme.fg("dim", "↑ earlier messages"), ...content.slice(-(available - 1))];
	}
	return available === 0 ? [] : content;
}

// ---------------------------------------------------------------------------
// Card cells
// ---------------------------------------------------------------------------

/** `[done]`, `[error]`, or the status word, painted by severity. */
function statusChip(card: HomeCard): string {
	if (card.unread && (card.status === "idle" || card.status === "done")) {
		return theme.fg("toolTitle", "[done]");
	}
	if (card.status === "error") return theme.fg("error", "[error]");
	const text = `[${card.status}]`;
	if (isWorkingStatus(card.status)) return theme.fg("accent", text);
	if (card.status === "done") return theme.fg("toolTitle", text);
	return theme.fg("dim", text);
}

/** Card title colour for a tab without a `/color` of its own. */
function titleSegment(card: HomeCard, text: string): string {
	if (card.status === "error") return theme.fg("error", text);
	if (isWorkingStatus(card.status)) return theme.fg("accent", text);
	if (card.status === "done" || card.unread) return theme.fg("success", text);
	return text;
}

/** Current braille frame while the tab works; empty for any other status. */
function spinnerFrame(card: HomeCard, now: number): string {
	if (!isWorkingStatus(card.status)) return "";
	const start = card.workingStartedAt ? Date.parse(card.workingStartedAt) : Number.NaN;
	// Without a start stamp the spinner still animates off wall-clock time.
	const elapsed = Number.isFinite(start) ? Math.max(0, now - start) : now;
	const frame = SPINNER_FRAMES[Math.floor(elapsed / SPINNER_INTERVAL_MS) % SPINNER_FRAMES.length];
	return theme.fg("accent", frame ?? SPINNER_FRAMES[0]!);
}

/** `model · context · recency`, dropping the recency when the tab has never worked. */
function cardMeta(card: HomeCard, now: number): string {
	const model = card.model ?? "?";
	const context = theme.fg("dim", formatContextUsage(card.tokens, card.contextWindow));
	const updated = isWorkingStatus(card.status)
		? `${card.status} ${formatElapsed(card.workingStartedAt, now)}`
		: formatRelativeAge(card.lastWorkedAt, now);
	return updated ? `${model} · ${context} · ${updated}` : `${model} · ${context}`;
}
