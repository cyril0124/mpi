/**
 * Agent chrome for the tab bar's rule row.
 *
 * When an extension replaces the prompt editor (`ctx.ui.setEditorComponent`),
 * the input card that normally carries the agent name, the context override and
 * the mode badges is gone. The rule under the tab bar is painted every frame
 * anyway, so it carries them instead: mode badges on the left, the title and the
 * context override right-aligned, dashes filling the slack. The replaced editor
 * paints no labels of its own, so this row is the only place the agent is named.
 *
 * A returned line is always exactly `width` columns wide, and a narrow row gives
 * labels up rather than overflowing instead of clipping them.
 */
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { theme } from "../../../theme/theme.ts";
import { RULE_CHAR } from "./tab-glyphs.ts";

/** What the rule row shows about the agent in front of a replaced editor. */
export interface TabRuleChrome {
	title: string;
	/** Exact context reading for an overridden limit, e.g. `12.3k/200k*`; empty hides it. */
	contextText?: string;
	vimMode?: boolean;
	zenMode?: boolean;
}

const VIM_BADGE = "[VIM]";
const ZEN_BADGE = "[ZEN]";
/** Trailing dashes of the right chunk. */
const TITLE_TRAILING_DASHES = 2;
/** One space either side of the title, plus its trailing dashes. */
const TITLE_FRAME_WIDTH = 2 + TITLE_TRAILING_DASHES;
/** Separator between the title and the context reading. */
const CONTEXT_SEPARATOR = " · ";
const CONTEXT_SEPARATOR_WIDTH = visibleWidth(CONTEXT_SEPARATOR);
/** A badge takes one leading space. */
const BADGE_SPACE = 1;
/** The left chunk leads with this many dashes, then the badges, then one space. */
const LEFT_LEAD_DASHES = 2;
/** Dashes kept between the left chunk and the title, so the two never touch. */
const MIN_BADGE_LEAD_DASHES = 1;
const MIN_TITLE_LEAD_DASHES = 3;

/**
 * The rule under the tab bar carrying the agent labels, exactly `width` columns.
 * `frame` paints the dashes in the rule's own color.
 */
export function renderTabRuleChrome(width: number, chrome: TabRuleChrome, frame: (text: string) => string): string {
	if (width <= 0) return "";
	const dashes = (count: number) => frame(RULE_CHAR.repeat(Math.max(0, count)));

	const title = chrome.title.trim();
	if (!title) return dashes(width);

	const vim = chrome.vimMode === true;
	const zen = chrome.zenMode === true;
	const context = chrome.contextText?.trim() ?? "";
	const showContext = context.length > 0;

	const leftWidth =
		vim || zen
			? LEFT_LEAD_DASHES +
				(vim ? BADGE_SPACE + visibleWidth(VIM_BADGE) : 0) +
				(zen ? BADGE_SPACE + visibleWidth(ZEN_BADGE) : 0) +
				1
			: 0;
	const contextWidth = showContext ? CONTEXT_SEPARATOR_WIDTH + visibleWidth(context) : 0;
	const minLead = vim || zen ? MIN_BADGE_LEAD_DASHES : MIN_TITLE_LEAD_DASHES;
	const titleBudget = width - leftWidth - minLead - TITLE_FRAME_WIDTH - contextWidth;
	if (titleBudget <= 0) return degrade(width, chrome, frame);

	let titleText = title;
	if (visibleWidth(titleText) > titleBudget) {
		titleText = truncateToWidth(titleText, titleBudget, "…");
	}
	const fill = width - leftWidth - TITLE_FRAME_WIDTH - visibleWidth(titleText) - contextWidth;
	if (fill < minLead) return degrade(width, chrome, frame);

	const contextChunk = showContext ? `${theme.fg("dim", CONTEXT_SEPARATOR)}${theme.fg("dim", context)}` : "";
	const rightChunk = ` ${theme.fg("accent", titleText)}${contextChunk} ${dashes(TITLE_TRAILING_DASHES)}`;
	if (!vim && !zen) return `${dashes(fill)}${rightChunk}`;

	const badges = [
		vim ? ` ${theme.fg("borderAccent", VIM_BADGE)}` : "",
		zen ? ` ${theme.fg("dim", ZEN_BADGE)}` : "",
	].join("");
	const leftChunk = `${dashes(LEFT_LEAD_DASHES)}${badges} `;
	return `${leftChunk}${dashes(fill)}${rightChunk}`;
}

/**
 * Drop the labels the row cannot hold, in the order `[ZEN]`, `[VIM]`, context,
 * until only the plain rule is left. The title truncates in
 * {@link renderTabRuleChrome} instead.
 */
function degrade(width: number, chrome: TabRuleChrome, frame: (text: string) => string): string {
	if (chrome.zenMode === true) return renderTabRuleChrome(width, { ...chrome, zenMode: false }, frame);
	if (chrome.vimMode === true) return renderTabRuleChrome(width, { ...chrome, vimMode: false }, frame);
	if ((chrome.contextText?.trim() ?? "").length > 0) {
		return renderTabRuleChrome(width, { ...chrome, contextText: undefined }, frame);
	}
	return frame(RULE_CHAR.repeat(Math.max(0, width)));
}
