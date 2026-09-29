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
 */
import type { AgentSession } from "../../../../../core/agent-session.ts";
import type { ReadonlyFooterDataProvider } from "../../../../../core/footer-data-provider.ts";
import { FooterComponent } from "../../footer.ts";
import { type InputMetaData, renderInputMeta } from "./input-meta.ts";

export class MixcodeDockFooter extends FooterComponent {
	private readonly meta: () => InputMetaData;

	constructor(session: AgentSession, footerData: ReadonlyFooterDataProvider, meta: () => InputMetaData) {
		super(session, footerData);
		this.meta = meta;
	}

	override render(width: number): string[] {
		return renderInputMeta(this.meta(), width);
	}
}
