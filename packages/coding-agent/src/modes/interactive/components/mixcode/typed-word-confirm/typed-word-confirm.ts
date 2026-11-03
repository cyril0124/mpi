/**
 * A typed-word confirmation panel: the given word has to be typed in full
 * before the action runs, so no single key confirms it, whether a stray `y`,
 * Enter or a key another process sends into the terminal. `n` or the cancel
 * chord dismisses the panel, backspace removes the last letter, and every other
 * key is ignored. A pasted word arrives wrapped in bracketed-paste markers,
 * which this panel drops: only typing the word confirms.
 *
 * A floating overlay rather than an editor-slot selector, because a confirmation
 * must not replace the draft being typed behind it.
 */
import { type Component, getKeybindings, matchesKey } from "@earendil-works/pi-tui";
import { keyHint, rawKeyHint } from "../../keybinding-hints.ts";
import { panel } from "../panel.ts";

export interface TypedWordConfirmOptions {
	/** Panel title, also used as the blocked-status label while it is open. */
	title: string;
	/** Word that must be typed into the panel before the action runs. */
	word: string;
	/** Static body lines rendered above the type-the-word line. */
	body: string[];
	onConfirm: () => void;
	onCancel: () => void;
}

export class TypedWordConfirmComponent implements Component {
	private readonly options: TypedWordConfirmOptions;
	private input = "";

	constructor(options: TypedWordConfirmOptions) {
		this.options = options;
	}

	invalidate(): void {
		// No cached state to invalidate currently.
	}

	render(width: number): string[] {
		return panel(
			this.options.title,
			[
				...this.options.body,
				"",
				`Type ${this.options.word.toUpperCase()} to confirm: ${this.input}`,
				`${rawKeyHint("n", "cancel")}   ${keyHint("tui.select.cancel", "cancel")}`,
			],
			width,
		);
	}

	handleInput(data: string): void {
		if (data.toLowerCase() === "n" || getKeybindings().matches(data, "tui.select.cancel")) {
			this.options.onCancel();
			return;
		}
		if (matchesKey(data, "backspace")) {
			this.input = this.input.slice(0, -1);
			return;
		}
		// Letters extend the typed word; several letters in one chunk (an `mpi ctl
		// send-keys` token) count as typing them at once. Only a prefix of the word is
		// accepted, so a stray or out-of-order letter cannot move the input, and
		// non-letter keys (Enter, arrows) do nothing.
		const typed = data.toLowerCase();
		if (!/^[a-z]+$/.test(typed)) return;
		const candidate = this.input + typed;
		if (!this.options.word.startsWith(candidate)) return;
		this.input = candidate;
		if (candidate === this.options.word) this.options.onConfirm();
	}
}
