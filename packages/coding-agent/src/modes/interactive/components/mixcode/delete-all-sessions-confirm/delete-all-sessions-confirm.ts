/**
 * Confirmation panel for `/delete-all-sessions`. The word DELETE has to be typed
 * in full before the deletion runs, so no single key confirms it, whether a stray
 * `y`, Enter or a key another process sends into the terminal. `n` or the cancel
 * chord dismisses the panel, backspace removes the last letter, and every other key
 * is ignored. A pasted word arrives wrapped in bracketed-paste markers, which this
 * panel drops: only typing the word confirms.
 *
 * A floating overlay rather than an editor-slot selector, because a confirmation
 * must not replace the draft being typed behind it.
 */
import { type Component, getKeybindings, matchesKey } from "@earendil-works/pi-tui";
import { theme } from "../../../theme/theme.ts";
import { keyHint, rawKeyHint } from "../../keybinding-hints.ts";
import { panel } from "../panel.ts";

/** Panel title, also used as the blocked-status label while it is open. */
export const DELETE_ALL_SESSIONS_CONFIRM_TITLE = "Delete all sessions";

/** Word that must be typed into the panel before it runs. */
export const DELETE_ALL_SESSIONS_CONFIRM_WORD = "delete";

/** Overlay width, the one the quit panel uses. */
export const DELETE_ALL_SESSIONS_CONFIRM_WIDTH = 72;

export class DeleteAllSessionsConfirmComponent implements Component {
	private readonly tabCount: number;
	private readonly onConfirm: () => void;
	private readonly onCancel: () => void;
	private input = "";

	constructor(tabCount: number, onConfirm: () => void, onCancel: () => void) {
		this.tabCount = tabCount;
		this.onConfirm = onConfirm;
		this.onCancel = onCancel;
	}

	invalidate(): void {
		// No cached state to invalidate currently.
	}

	render(width: number): string[] {
		const tabs = this.tabCount === 1 ? "1 open tab" : `${this.tabCount} open tabs`;
		return panel(
			DELETE_ALL_SESSIONS_CONFIRM_TITLE,
			[
				theme.fg("text", `Delete the session files of all ${tabs} and start fresh?`),
				theme.fg("text", "They move to the trash and can be restored with /resume-trash."),
				theme.fg("text", "A file already in the trash, or one whose move fails,"),
				theme.fg("text", "is deleted for good."),
				"",
				`Type ${DELETE_ALL_SESSIONS_CONFIRM_WORD.toUpperCase()} to confirm: ${this.input}`,
				`${rawKeyHint("n", "cancel")}   ${keyHint("tui.select.cancel", "cancel")}`,
			],
			width,
		);
	}

	handleInput(data: string): void {
		if (data.toLowerCase() === "n" || getKeybindings().matches(data, "tui.select.cancel")) {
			this.onCancel();
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
		if (!DELETE_ALL_SESSIONS_CONFIRM_WORD.startsWith(candidate)) return;
		this.input = candidate;
		if (candidate === DELETE_ALL_SESSIONS_CONFIRM_WORD) this.onConfirm();
	}
}
