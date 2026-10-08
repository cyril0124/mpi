import { Box, Container, Markdown, type MarkdownTheme } from "@earendil-works/pi-tui";
import type { MarkdownTransformer } from "../../../core/extensions/types.ts";
import { getActiveThemeName, getMarkdownTheme, theme } from "../theme/theme.ts";
import { createMarkdownTransform } from "./markdown-transform.ts";
import { ClockedMessageBody, formatMessageClock } from "./mixcode/message-clock.ts";

/**
 * Lines a message block may hold before it is split into several blocks.
 *
 * The bound is on the message's own lines, and the conservative character bound below
 * keeps a chunk from wrapping into far more rows than that on a narrow terminal.
 */
export const OVERSIZED_MESSAGE_MAX_LINES = 200;
/** Characters a message block may hold before it is split. One very long line is cut too. */
export const OVERSIZED_MESSAGE_MAX_CHARS = 12_000;

/** Zone marks a block paints: a split message carries them only at its two ends. */
export type UserMessageZoneMarks = "both" | "start" | "end" | "none";

const OSC133_ZONE_START = "\x1b]133;A\x07";
const OSC133_ZONE_END = "\x1b]133;B\x07";
const OSC133_ZONE_FINAL = "\x1b]133;C\x07";

/**
 * Split a message body that is too large to render as one block, cutting at line
 * boundaries and at `maxChars` inside a line that is longer than that on its own.
 *
 * The transcript paints a windowed block as a whole, so one enormous block costs its
 * full render every time it is shown; chunks keep that cost proportional to the rows
 * on screen and let the transcript estimate the rest.
 */
export function splitOversizedUserMessage(
	text: string,
	maxLines = OVERSIZED_MESSAGE_MAX_LINES,
	maxChars = OVERSIZED_MESSAGE_MAX_CHARS,
): Array<{ text: string; marks: UserMessageZoneMarks }> {
	const sourceLines = text.split("\n");
	if (sourceLines.length <= maxLines && text.length <= maxChars) return [{ text, marks: "both" }];
	const pieces: string[] = [];
	let current: string[] = [];
	let size = 0;
	const flush = (): void => {
		if (current.length === 0) return;
		pieces.push(current.join("\n"));
		current = [];
		size = 0;
	};
	for (const line of sourceLines) {
		for (let offset = 0; offset < Math.max(1, line.length); offset += maxChars) {
			const slice = line.slice(offset, offset + maxChars);
			if (current.length >= maxLines || size + slice.length + 1 > maxChars) flush();
			current.push(slice);
			size += slice.length + 1;
		}
	}
	flush();
	return pieces.map((piece, index) => ({
		text: piece,
		marks: index === 0 ? "start" : index === pieces.length - 1 ? "end" : "none",
	}));
}

/**
 * Component that renders a user message
 */
export class UserMessageComponent extends Container {
	private text: string;
	private markdownTheme: MarkdownTheme;
	private outputPad: number;
	private markdownTransformers: readonly MarkdownTransformer[];
	/** Send time of the message, drawn at the right end of the block's first row. */
	private timestamp: number | undefined;
	/** Which ends of the message the shell prompt zone markers belong to. */
	private readonly marks: UserMessageZoneMarks;
	/** Last rendered block, reused while the width and the content are unchanged. */
	private renderedLines: string[] | undefined;
	private renderedWidth = -1;
	private renderedTheme: string | undefined;
	/** Set while `invalidate` has dropped the memo but the next paint has not rebuilt it yet. */
	private rebuildPending = false;

	constructor(
		text: string,
		markdownTheme: MarkdownTheme = getMarkdownTheme(),
		outputPad = 1,
		markdownTransformers: readonly MarkdownTransformer[] = [],
		timestamp?: number,
		marks: UserMessageZoneMarks = "both",
	) {
		super();
		this.text = text;
		this.marks = marks;
		this.markdownTheme = markdownTheme;
		this.outputPad = outputPad;
		this.markdownTransformers = markdownTransformers;
		this.timestamp = timestamp;
		this.rebuild();
	}

	setOutputPad(padding: number): void {
		this.outputPad = padding;
		this.rebuild();
	}

	/** The message text this block renders. */
	getText(): string {
		return this.text;
	}

	/**
	 * Drop the memo; the next paint rebuilds lazily. See AssistantMessageComponent.invalidate.
	 *
	 * Content is rebuilt from the fields this component keeps. A replaced Markdown transformer only
	 * takes effect through that rebuild: the body's own cache holds the lines the previous
	 * transformer chain produced.
	 *
	 * The subtree is flushed only when the theme changed: the children cache their
	 * rendered lines against content and width alone, so a theme switch would otherwise
	 * serve rows in the old colors. A plain relayout or a background tab bind leaves the
	 * theme alone and must not pay for a subtree walk.
	 */
	override invalidate(): void {
		if (this.renderedTheme !== undefined && this.renderedTheme !== getActiveThemeName()) {
			super.invalidate();
		}
		this.rebuildPending = true;
		this.renderedLines = undefined;
	}

	private rebuild(): void {
		this.rebuildPending = false;
		this.renderedLines = undefined;
		this.clear();
		const contentBox = new Box(this.outputPad, 1, (content: string) => theme.bg("userMessageBg", content));
		const body = new Markdown(
			this.text,
			0,
			0,
			this.markdownTheme,
			{
				color: (content: string) => theme.fg("userMessageText", content),
			},
			{
				preserveOrderedListMarkers: true,
				preserveBackslashEscapes: true,
				transform: createMarkdownTransform("user", false, this.markdownTransformers),
			},
		);
		contentBox.addChild(new ClockedMessageBody(body, formatMessageClock(this.timestamp)));
		this.addChild(contentBox);
	}

	override render(width: number): string[] {
		if (this.rebuildPending) this.rebuild();
		const themeName = getActiveThemeName();
		if (this.renderedLines && this.renderedWidth === width && this.renderedTheme === themeName) {
			return this.renderedLines;
		}
		const lines = super.render(width);
		if (lines.length === 0) {
			return lines;
		}

		if (this.marks === "both" || this.marks === "start") lines[0] = OSC133_ZONE_START + lines[0];
		if (this.marks === "both" || this.marks === "end") {
			lines[lines.length - 1] = OSC133_ZONE_END + OSC133_ZONE_FINAL + lines[lines.length - 1];
		}
		this.renderedLines = lines;
		this.renderedWidth = width;
		this.renderedTheme = themeName;
		return lines;
	}
}
