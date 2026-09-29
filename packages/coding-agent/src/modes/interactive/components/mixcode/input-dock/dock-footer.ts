/**
 * The dock footer: the meta row under the input card.
 *
 * pi's footer reports the same session from a different angle - working
 * directory, session name, token totals, cost and a context percentage. The dock
 * keeps one row instead: the meta row already carries the workdir, the model and
 * the context meter, and the card's top edge carries the session name and the
 * exact token counts, so the two would only repeat each other.
 *
 * The data is read through a provider rather than captured, because the active
 * tab's session changes under a footer that stays mounted.
 *
 * The model and the thinking level are click targets: the click opens that
 * field's picker, and the pointer lights the field up while it is over it. The
 * regions come from the row that was rendered last, so a truncated row never
 * answers for cells it no longer paints.
 */
import type { TuiMouseEvent, TuiMouseEventResult } from "@earendil-works/pi-tui";
import type { AgentSession } from "../../../../../core/agent-session.ts";
import type { ReadonlyFooterDataProvider } from "../../../../../core/footer-data-provider.ts";
import { FooterComponent } from "../../footer.ts";
import { PointerHover } from "../hover/pointer-hover.ts";
import { type InputMetaData, type MetaAction, type MetaRegion, renderInputMeta } from "./input-meta.ts";

export class MixcodeDockFooter extends FooterComponent {
	private readonly meta: () => InputMetaData;
	private readonly onMetaAction: (action: MetaAction) => void;
	private readonly hover = new PointerHover();
	/** Clickable fields of the row rendered last, in the footer's own coordinates. */
	private regions: MetaRegion[] = [];

	constructor(
		session: AgentSession,
		footerData: ReadonlyFooterDataProvider,
		meta: () => InputMetaData,
		onMetaAction: (action: MetaAction) => void,
	) {
		super(session, footerData);
		this.meta = meta;
		this.onMetaAction = onMetaAction;
	}

	override render(width: number): string[] {
		const rendered = renderInputMeta(this.meta(), width);
		this.regions = rendered.regions;
		this.hover.layout(
			this.regions.map((region) => ({ id: region.action, x: region.start, y: 0, width: region.width })),
		);
		return this.hover.paint(rendered.lines, width);
	}

	/** Drop the cue and the regions, so a swapped session cannot inherit either. */
	override invalidate(): void {
		super.invalidate();
		this.hover.reset();
		this.regions = [];
	}

	handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
		// Passive motion only moves the cue; it never opens a picker. The move is
		// always answered, so the dispatcher knows this component owns the pointer.
		if (event.type === "move" && event.button === "none") {
			return { handled: true, render: this.hover.move(event.x, event.y) };
		}
		// Every other pointer event drops a cue the pointer may have left behind.
		const cleared = this.hover.clear();
		const repaintIfCleared = (): TuiMouseEventResult | undefined =>
			cleared ? { handled: true, render: true } : undefined;
		// Only the press acts: the renderer synthesizes a click after an unmoved
		// release, so answering both would open the picker twice.
		if (event.button !== "left" || event.type !== "press") return repaintIfCleared();
		const region = this.regions.find(
			(candidate) => event.y === 0 && event.x >= candidate.start && event.x < candidate.start + candidate.width,
		);
		if (!region) return repaintIfCleared();
		this.onMetaAction(region.action);
		return { handled: true };
	}
}
