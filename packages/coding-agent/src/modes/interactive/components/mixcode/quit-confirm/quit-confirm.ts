/**
 * Quit confirmation panel: `y` confirms, `n` or the cancel chord dismisses, and
 * every other key is ignored.
 *
 * A floating overlay rather than an editor-slot selector, because a confirmation
 * must not replace the draft being typed behind it.
 */
import { type Component, getKeybindings } from "@earendil-works/pi-tui";
import { APP_NAME } from "../../../../../config.ts";
import { theme } from "../../../theme/theme.ts";
import { keyHint, rawKeyHint } from "../../keybinding-hints.ts";
import { panel } from "../panel.ts";

export class QuitConfirmComponent implements Component {
	private readonly onConfirm: () => void;
	private readonly onCancel: () => void;

	constructor(onConfirm: () => void, onCancel: () => void) {
		this.onConfirm = onConfirm;
		this.onCancel = onCancel;
	}

	invalidate(): void {
		// No cached state to invalidate currently.
	}

	render(width: number): string[] {
		return panel(
			`Quit ${APP_NAME}`,
			[
				theme.fg("text", "Are you sure you want to quit?"),
				"",
				`${rawKeyHint("y", "quit")}   ${rawKeyHint("n", "cancel")}`,
				keyHint("tui.select.cancel", "cancel"),
			],
			width,
		);
	}

	handleInput(data: string): void {
		const key = data.toLowerCase();
		if (key === "y") {
			this.onConfirm();
			return;
		}
		if (key === "n" || getKeybindings().matches(data, "tui.select.cancel")) {
			this.onCancel();
		}
	}
}
