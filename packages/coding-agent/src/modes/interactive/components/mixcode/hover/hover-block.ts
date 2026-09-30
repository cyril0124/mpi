/**
 * Hover state for a message block.
 *
 * The block is the pointer target, so the cue covers the whole card a click acts on
 * rather than only the part one of its inner components happened to render. The block
 * owns this state, hands it to the dispatcher from its own `handleMouse`, paints with
 * `paint` at the end of its `render`, and passes its click action in at construction.
 *
 * Owning a hover cue also means the card's rows already wear the cue's background, so the
 * constructor records the owner and the first row that carries the card: a text selection over
 * those rows has to add an underline to stay visible, and `hasPointerCueAt` is what says which
 * rows those are.
 */
import {
	type Component,
	dispatchMouseEvent,
	type TuiMouseDispatchResult,
	type TuiMouseEvent,
	type TuiMouseEventResult,
} from "@earendil-works/pi-tui";
import { paintRowBackground } from "./pointer-hover.ts";

/** First card row of every block that paints the pointer cue, by owning component. */
const pointerCueCards = new WeakMap<Component, number>();

/**
 * Whether `row` of `component`'s own lines is a card row of a block that paints the pointer cue.
 * The cue fills those rows, so a selection over them also underlines; the gap rows above a card
 * keep the plain selection background like any other row.
 */
export function hasPointerCueAt(component: Component, row: number): boolean {
	const cardFirstRow = pointerCueCards.get(component);
	return cardFirstRow !== undefined && row >= cardFirstRow;
}

export class BlockHover implements Component {
	private hovered = false;
	private readonly onClick: (event: TuiMouseEvent) => TuiMouseEventResult | undefined;
	private readonly cardFirstRow: number;

	/**
	 * `owner` is the block that paints the cue; it owns one hover, so a second
	 * instance registered for the same owner replaces its card row here.
	 * `cardFirstRow` is that block's first row carrying its own card: rows above it
	 * are the blank gap a block may render to the message before it, which holds no
	 * card for the cue to fill and no target for a click.
	 */
	constructor(
		owner: Component,
		onClick?: (event: TuiMouseEvent) => TuiMouseEventResult | undefined,
		cardFirstRow = 0,
	) {
		this.onClick = onClick ?? (() => undefined);
		this.cardFirstRow = Math.max(0, cardFirstRow);
		pointerCueCards.set(owner, this.cardFirstRow);
	}

	/** True while the pointer is over the block. */
	get active(): boolean {
		return this.hovered;
	}

	/**
	 * A passive move updates the hover; every other event goes to the block's own
	 * click action. A component that owns hover answers every move inside it, since the
	 * renderer reads "no component answered" as "the pointer left".
	 */
	handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
		const onCard = event.y >= this.cardFirstRow;
		const passiveMove = event.type === "move" && event.button === "none";
		if (!passiveMove) return onCard ? this.onClick(event) : undefined;
		const inside = onCard && event.x >= 0 && event.x < event.width && event.y < event.height;
		const changed = inside !== this.hovered;
		this.hovered = inside;
		return { handled: true, render: changed };
	}

	/** Hand this block's hover to the dispatcher, which is what lets it be left again. */
	dispatch(event: TuiMouseEvent): TuiMouseDispatchResult | undefined {
		return dispatchMouseEvent(this, event);
	}

	/** Paint a block's freshly rendered card while the pointer is over it. */
	paint(lines: string[], width: number): string[] {
		if (!this.hovered) return lines;
		return lines.map((line, row) => (row < this.cardFirstRow ? line : paintRowBackground(line, width)));
	}

	/** Never rendered: the block that owns this state paints the cue itself. */
	render(): string[] {
		return [];
	}

	invalidate(): void {}
}
