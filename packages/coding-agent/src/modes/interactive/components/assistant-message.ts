import type { AssistantMessage } from "@earendil-works/pi-ai";
import { type Component, Container, Markdown, type MarkdownTheme, Spacer, Text } from "@earendil-works/pi-tui";
import type { MarkdownTransformer } from "../../../core/extensions/types.ts";
import { getActiveThemeName, getMarkdownTheme, theme } from "../theme/theme.ts";
import { createMarkdownTransform } from "./markdown-transform.ts";
import { HoverRegion } from "./mixcode/hover/hover-region.ts";
import {
	HIDDEN_THINKING_PLACEHOLDER,
	stripThinkingPresentation,
	ThinkingTailComponent,
	type ThinkingTailTimer,
} from "./mixcode/thinking-tail/thinking-tail.ts";

const OSC133_ZONE_START = "\x1b]133;A\x07";
const OSC133_ZONE_END = "\x1b]133;B\x07";
const OSC133_ZONE_FINAL = "\x1b]133;C\x07";

/**
 * Component that renders a complete assistant message
 */
export class AssistantMessageComponent extends Container {
	private contentContainer: Container;
	private hideThinkingBlock: boolean;
	private markdownTheme: MarkdownTheme;
	private hiddenThinkingLabel: string | undefined;
	private outputPad: number;
	private markdownTransformers: readonly MarkdownTransformer[];
	private lastMessage?: AssistantMessage;
	private hasToolCalls = false;
	private isStreaming = false;
	private thinkingVisibilityOverrides = new Map<number, boolean>();
	/** Per thinking run: the stamps the live/frozen duration is read from. */
	private thinkingTailTimers = new Map<number, ThinkingTailTimer>();
	/** Last rendered block, reused while the width and the content are unchanged. */
	private renderedLines: string[] | undefined;
	private renderedWidth = -1;
	private renderedTheme: string | undefined;
	private boxedHiddenThinking: boolean;

	constructor(
		message?: AssistantMessage,
		hideThinkingBlock = false,
		markdownTheme: MarkdownTheme = getMarkdownTheme(),
		hiddenThinkingLabel?: string,
		outputPad = 1,
		markdownTransformers: readonly MarkdownTransformer[] = [],
		boxedHiddenThinking = false,
	) {
		super();

		this.hideThinkingBlock = hideThinkingBlock;
		this.markdownTheme = markdownTheme;
		this.hiddenThinkingLabel = hiddenThinkingLabel;
		this.outputPad = outputPad;
		this.markdownTransformers = markdownTransformers;
		this.boxedHiddenThinking = boxedHiddenThinking;

		// Container for text/thinking content
		this.contentContainer = new Container();
		this.addChild(this.contentContainer);

		if (message) {
			this.updateContent(message);
		}
	}

	/**
	 * Drop the memo so the next paint rebuilds the block.
	 *
	 * Rebuilding eagerly (calling updateContent here) would flush the rendered
	 * lines on every tree invalidation, which arrives on each relayout and on
	 * every tab-bind via the extension adapter path. Content is unchanged in
	 * those cases, so the eager rebuild would make the first visit to a tab
	 * re-render all its assistant blocks from scratch, exactly like the problem
	 * in ToolExecutionComponent. Letting render() rebuild lazily is correct:
	 * callers that change content (updateContent, setters) clear the memo
	 * directly, so the lazy path never serves stale lines.
	 */
	override invalidate(): void {
		if (this.renderedTheme !== undefined && this.renderedTheme !== getActiveThemeName()) {
			super.invalidate();
		}
		this.renderedLines = undefined;
	}

	setHideThinkingBlock(hide: boolean): void {
		this.hideThinkingBlock = hide;
		this.thinkingVisibilityOverrides.clear();
		if (this.lastMessage) {
			this.updateContent(this.lastMessage);
		}
	}

	setHiddenThinkingLabel(label?: string): void {
		if (this.hiddenThinkingLabel === label) return;
		this.hiddenThinkingLabel = label;
		if (this.lastMessage) {
			this.updateContent(this.lastMessage);
		}
	}

	setBoxedHiddenThinking(boxed: boolean): void {
		this.boxedHiddenThinking = boxed;
		if (this.lastMessage) {
			this.updateContent(this.lastMessage);
		}
	}

	setOutputPad(padding: number): void {
		this.outputPad = padding;
		if (this.lastMessage) {
			this.updateContent(this.lastMessage);
		}
	}

	override render(width: number): string[] {
		const themeName = getActiveThemeName();
		if (this.renderedLines && this.renderedWidth === width && this.renderedTheme === themeName) {
			return this.renderedLines;
		}
		const lines = super.render(width);
		if (this.hasToolCalls || lines.length === 0) {
			return lines;
		}

		lines[0] = OSC133_ZONE_START + lines[0];
		lines[lines.length - 1] = OSC133_ZONE_END + OSC133_ZONE_FINAL + lines[lines.length - 1];
		this.renderedLines = lines;
		this.renderedWidth = width;
		this.renderedTheme = themeName;
		return lines;
	}

	updateContent(message: AssistantMessage, isStreaming = this.isStreaming): void {
		this.renderedLines = undefined;
		this.lastMessage = message;
		this.isStreaming = isStreaming;

		// Clear content container
		this.contentContainer.clear();

		const hasVisibleContent = message.content.some(
			(c) => (c.type === "text" && c.text.trim()) || (c.type === "thinking" && c.thinking.trim()),
		);

		if (hasVisibleContent) {
			this.contentContainer.addChild(new Spacer(1));
		}

		// Render content in order
		let thinkingRunIndex = 0;
		for (let i = 0; i < message.content.length; i++) {
			const content = message.content[i];
			if (content.type === "text" && content.text.trim()) {
				// Assistant text messages with no background - trim the text
				// Set paddingY=0 to avoid extra spacing before tool executions
				this.contentContainer.addChild(
					new Markdown(content.text.trim(), this.outputPad, 0, this.markdownTheme, undefined, {
						transform: createMarkdownTransform("assistant", this.isStreaming, this.markdownTransformers),
					}),
				);
			} else if (content.type === "thinking") {
				const thinkingBlocks: string[] = [];
				for (; i < message.content.length; i++) {
					const thinkingContent = message.content[i];
					if (thinkingContent.type !== "thinking") {
						break;
					}
					const thinking = thinkingContent.thinking.trim();
					if (thinking) {
						thinkingBlocks.push(thinking);
					}
				}
				i--;

				if (thinkingBlocks.length === 0) {
					continue;
				}

				// Add spacing only when another visible assistant content block follows.
				// This avoids a superfluous blank line before separately-rendered tool execution blocks.
				const hasVisibleContentAfter = message.content
					.slice(i + 1)
					.some((c) => (c.type === "text" && c.text.trim()) || (c.type === "thinking" && c.thinking.trim()));

				const runIndex = thinkingRunIndex++;
				const hidden = this.thinkingVisibilityOverrides.get(runIndex) ?? this.hideThinkingBlock;
				// A run stays live until a later block (answer text or tool call) arrives or
				// the message ends; only a streamed run gets a start stamp, so history and
				// replay show the tail without a timer.
				const timer = this.thinkingTailTimers.get(runIndex) ?? {};
				if (this.isStreaming && timer.startedAt === undefined) timer.startedAt = Date.now();
				const runClosed =
					!this.isStreaming ||
					message.content.slice(i + 1).some((c) => c.type === "toolCall" || (c.type === "text" && c.text.trim()));
				if (runClosed && timer.endedAt === undefined) timer.endedAt = Date.now();
				this.thinkingTailTimers.set(runIndex, timer);
				const thinkingComponent = hidden
					? hiddenThinkingComponent(thinkingBlocks.join("\n\n"), timer, {
							boxed: this.boxedHiddenThinking,
							label: this.hiddenThinkingLabel,
							outputPad: this.outputPad,
						})
					: new Markdown(
							thinkingBlocks.join("\n\n"),
							this.outputPad,
							0,
							this.markdownTheme,
							{
								color: (text: string) => theme.fg("thinkingText", text),
								italic: true,
							},
							{
								transform: createMarkdownTransform(
									"assistant-thinking",
									this.isStreaming,
									this.markdownTransformers,
								),
							},
						);
				this.contentContainer.addChild(
					new HoverRegion(
						thinkingComponent,
						(event) => {
							if (event.type !== "click" || event.button !== "left") return undefined;
							this.thinkingVisibilityOverrides.set(runIndex, !hidden);
							if (this.lastMessage) this.updateContent(this.lastMessage);
							return { handled: true };
						},
						// The memo caches this region's painted cue, and a move does not invalidate.
						() => {
							this.renderedLines = undefined;
						},
					),
				);
				if (hasVisibleContentAfter) {
					this.contentContainer.addChild(new Spacer(1));
				}
			}
		}

		// Check if incomplete/failed - show after partial content.
		// For aborted/error tool calls, tool execution components show the error.
		// Length stops can happen before a tool call is complete, so surface them here too.
		const hasToolCalls = message.content.some((c) => c.type === "toolCall");
		this.hasToolCalls = hasToolCalls;
		if (message.stopReason === "length") {
			this.contentContainer.addChild(new Spacer(1));
			this.contentContainer.addChild(
				new Text(theme.fg("error", "Response was truncated before completion."), this.outputPad, 0),
			);
		} else if (!hasToolCalls) {
			if (message.stopReason === "aborted") {
				const abortMessage =
					message.errorMessage && message.errorMessage !== "Request was aborted"
						? message.errorMessage
						: "Operation aborted";
				this.contentContainer.addChild(new Spacer(1));
				this.contentContainer.addChild(new Text(theme.fg("error", abortMessage), this.outputPad, 0));
			} else if (message.stopReason === "error") {
				const errorMsg = message.errorMessage || "Unknown error";
				this.contentContainer.addChild(new Spacer(1));
				this.contentContainer.addChild(new Text(theme.fg("error", `Error: ${errorMsg}`), this.outputPad, 0));
			}
		}
	}
}

interface HiddenThinkingOptions {
	boxed: boolean;
	/** Extension-provided label; absent means the tail owns the block. */
	label: string | undefined;
	outputPad: number;
}

/**
 * A hidden thinking run: an extension's label replaces the whole block, else the
 * streaming tail when the setting is on and the text survives stripping, else the
 * italic placeholder. A whitespace-only label counts as absent.
 */
function hiddenThinkingComponent(text: string, timer: ThinkingTailTimer, options: HiddenThinkingOptions): Component {
	const label = options.label?.trim();
	if (options.boxed && !label) {
		const stripped = stripThinkingPresentation(text);
		if (stripped) return new ThinkingTailComponent(stripped, timer);
	}
	return new Text(theme.italic(theme.fg("thinkingText", label || HIDDEN_THINKING_PLACEHOLDER)), options.outputPad, 0);
}
