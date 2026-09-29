/**
 * The default prompt editor, wrapped in the input card.
 *
 * The editor underneath draws two flat rules; this subclass renders it three columns
 * narrower, turns those rules into the card's rounded edges, frames every body row with
 * the side borders and holds the body one column off the left border. The frame colour is
 * the editor's own `borderColor`, so vim mode, bash mode and the thinking level keep the
 * colours they had.
 *
 * Autocomplete rows stay outside the card, indented to the column the body starts in: they
 * belong to the editor's menu, not to its body.
 */
import { type TuiMouseEvent, type TuiMouseEventResult, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { theme } from "../../../theme/theme.ts";
import { CustomEditor } from "../../custom-editor.ts";
import type { StatusIndicator } from "../../status-indicator.ts";
import { renderEditorCardEdge } from "./editor-card.ts";

/**
 * Narrowest width that keeps the card readable. The card needs two corners, two
 * dashes of frame and room for the working status, which outlives every other
 * label while a turn runs; below this the plain editor is kept.
 */
const MIN_CARD_WIDTH = 10;

export interface EditorCardChrome {
	/** Tab or session name shown on the right of the top edge. */
	title: string;
	/** Exact usage for the top edge, e.g. `12.3k/200k`; empty hides it. */
	contextText: string;
	/** Paint the context text as a warning: usage is close to the model's limit. */
	contextWarning?: boolean;
	vimMode?: boolean;
	/** The draft starts with `!`, so it runs as a shell command. */
	shellMode?: boolean;
}

/** NUL-wrapped sentinel identifying the rendered bottom edge among the body rows. */
const SENTINEL = "\u0000";

/** Columns of space between a side border and the body's first cell. */
const BODY_INSET = 1;
/** One body inset as spaces, for the rows that carry no side border of their own. */
const BODY_INSET_TEXT = " ".repeat(BODY_INSET);

export class MixcodePromptEditor extends CustomEditor {
	private chrome: () => EditorCardChrome = () => ({ title: "", contextText: "" });
	/** The embedded working status, tracked because the base class keeps it private. */
	private status: StatusIndicator | undefined;
	private hiddenAbove = 0;
	private hiddenBelow = 0;
	private bottomSentinel = "";
	/** True while the carded render is running, so the base top border is skipped. */
	private cardRendering = false;

	/** Live card labels; read once per frame, so a caller can hand over current state. */
	setCardChrome(provider: () => EditorCardChrome): void {
		this.chrome = provider;
	}

	override setWorkingStatusIndicator(indicator: StatusIndicator | undefined): void {
		super.setWorkingStatusIndicator(indicator);
		this.status = indicator;
	}

	protected override renderTopBorder(width: number, hiddenLineCount: number): string {
		this.hiddenAbove = hiddenLineCount;
		// The card builds its own top edge and discards this row, so the working
		// status it would embed here is drawn once, by the card, instead of twice.
		if (this.cardRendering) return this.borderColor("─".repeat(Math.max(0, width)));
		return super.renderTopBorder(width, hiddenLineCount);
	}

	protected override renderBottomBorder(width: number, hiddenLineCount: number): string {
		this.hiddenBelow = hiddenLineCount;
		this.bottomSentinel = `${SENTINEL}${super.renderBottomBorder(width, hiddenLineCount)}${SENTINEL}`;
		return this.bottomSentinel;
	}

	override render(width: number): string[] {
		if (width < MIN_CARD_WIDTH) return super.render(width).map(withoutSentinel);

		const innerWidth = width - 2 - BODY_INSET;
		this.cardRendering = true;
		let lines: string[];
		try {
			lines = super.render(innerWidth);
		} finally {
			this.cardRendering = false;
		}
		const bottomIndex = lines.indexOf(this.bottomSentinel, 1);
		// No bottom edge means the base editor changed shape; show it unframed
		// rather than guessing which row is the frame.
		if (bottomIndex < 0) return lines.map(withoutSentinel);

		const body = lines.slice(1, bottomIndex);
		const completion = lines.slice(bottomIndex + 1);
		const chrome = this.chrome();
		const frame = this.borderColor;

		const title = theme.fg("accent", chrome.title);
		const context = chrome.contextText ? theme.fg(chrome.contextWarning ? "warning" : "dim", chrome.contextText) : "";
		// A status in the title slot leaves the edge no separate mode label.
		const { label, asTitle } = this.topLabel(width, chrome);
		const top = renderEditorCardEdge(width, "top", asTitle ? label : title, context, frame, asTitle ? "" : label);

		const hint = !chrome.vimMode && this.hiddenBelow > 0 ? theme.fg("dim", `↓ ${this.hiddenBelow} more`) : "";
		const bottom = renderEditorCardEdge(width, "bottom", hint, "", frame);

		const side = frame("│");
		return [
			top,
			...body.map((line) => `${side}${BODY_INSET_TEXT}${theme.fg("text", line)}${side}`),
			bottom,
			// The menu carries no side border, so it repeats the inset itself to start its
			// first cell where the body's starts.
			...completion.map((line) => `${BODY_INSET_TEXT} ${line} `),
		];
	}

	/**
	 * The card insets the editing surface by two columns on the left and three in total,
	 * so a click has to be translated before the base editor sees it.
	 */
	override handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
		if (event.width < MIN_CARD_WIDTH) return super.handleMouse(event);
		return super.handleMouse({ ...event, x: event.x - 1 - BODY_INSET, width: event.width - 2 - BODY_INSET });
	}

	/**
	 * Left side of the top edge: the mode badges, the working status while a turn
	 * runs, and both while they fit together.
	 *
	 * The status degrades rather than disappearing: the message first, then the
	 * spinner, then a truncated spinner. The badges are dropped before the status,
	 * because a turn in flight is what this row is there to report, and when the
	 * status still cannot share the edge with the name it takes the name's slot.
	 */
	private topLabel(width: number, chrome: EditorCardChrome): { label: string; asTitle: boolean } {
		const badges = this.badgeText(chrome);
		if (!this.embedWorkingStatus || !this.status) return { label: badges, asTitle: false };
		const available = Math.max(0, width - 6);
		const full = this.status.renderInBorder(Math.max(1, width - 5));
		const spinner = this.status.renderSpinnerInBorder(Math.max(1, width - 5));
		// Richest layout first: badges beside the message, the message, badges beside
		// the spinner, then the spinner alone.
		const candidates: string[] = [];
		for (const part of [full, spinner]) {
			if (visibleWidth(part) === 0) continue;
			if (badges) candidates.push(`${badges} ${part}`);
			candidates.push(part);
		}
		for (const candidate of candidates) {
			if (labelFits(candidate, chrome.title, available)) return { label: candidate, asTitle: false };
		}
		// Title slot: the edge keeps ` label ` while the corners and one dash fit.
		const room = available - 2;
		if (room < 1 || visibleWidth(spinner) === 0) return { label: badges, asTitle: false };
		return {
			label: visibleWidth(spinner) <= room ? spinner : truncateToWidth(spinner, room, ""),
			asTitle: true,
		};
	}

	/** Mode badges for the top edge: vim or shell mode, and the hidden-row count. */
	private badgeText(chrome: EditorCardChrome): string {
		const badges: string[] = [];
		if (chrome.vimMode) badges.push(theme.fg("borderAccent", "[VIM]"));
		else if (chrome.shellMode) badges.push(theme.fg("bashMode", "[SHELL]"));
		if (this.hiddenAbove > 0) badges.push(theme.fg("dim", `↑ ${this.hiddenAbove}`));
		return badges.join(" ");
	}
}

/** The sentinel is a row marker for the carded path only; it must never reach the screen. */
function withoutSentinel(line: string): string {
	return line.replaceAll(SENTINEL, "");
}

/** True when a left label still leaves room for the title and its dashes. */
function labelFits(label: string, title: string, available: number): boolean {
	const padded = visibleWidth(label) + 2;
	const titleRoom = Math.min(visibleWidth(title), 16);
	return padded + titleRoom + 1 <= available;
}
