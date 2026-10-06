/**
 * Vim mode locks the composer to a reading surface: accent frame, swallowed typing and a
 * refused submit. The caret is part of that lock, since an insertion point says the
 * composer takes typing.
 */
import type { TUI } from "@earendil-works/pi-tui";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { KeybindingsManager } from "../../src/core/keybindings.ts";
import {
	type EditorCardChrome,
	MixcodePromptEditor,
} from "../../src/modes/interactive/components/mixcode/input-dock/prompt-editor.ts";
import { getEditorTheme, initTheme, theme } from "../../src/modes/interactive/theme/theme.ts";

/** Terminal width every composer below is rendered at. */
const WIDTH = 80;
/** The editor's caret: reverse video around the character under it. */
const CARET = "\x1b[7m";

const VIM_HINT = "Vim: → newer · Shift+→ older · j/k scroll · q exit";
const DRAFT_HINT = "Describe your next change...";

/** A carded composer whose tab is in vim mode or not, with its hint and its card labels. */
function createComposer(vimMode: boolean): MixcodePromptEditor {
	const tui = {
		requestRender: vi.fn(),
		terminal: { rows: 20, columns: WIDTH },
	} as unknown as TUI;
	const editor = new MixcodePromptEditor(tui, getEditorTheme(), KeybindingsManager.create());
	editor.getPlaceholder = () => theme.fg("dim", vimMode ? VIM_HINT : DRAFT_HINT);
	const chrome: EditorCardChrome = { title: "Agent-01", contextText: "", vimMode };
	editor.setCardChrome(() => chrome);
	return editor;
}

/** The rendered row carrying `text`, which is the row the editor draws its caret on. */
function bodyRow(editor: MixcodePromptEditor, text: string): string {
	const row = editor.render(WIDTH).find((line) => line.includes(text));
	expect(row, `no rendered row contains ${JSON.stringify(text)}`).toBeDefined();
	return row!;
}

describe("composer caret while vim mode holds the editor", () => {
	beforeAll(() => {
		initTheme("dark");
	});

	it("draws no caret on the empty composer's vim hint", () => {
		expect(bodyRow(createComposer(true), VIM_HINT)).not.toContain(CARET);
	});

	it("draws no caret on a draft the modal surface locked", () => {
		const composer = createComposer(true);
		composer.setText("hello draft");
		expect(bodyRow(composer, "hello draft")).not.toContain(CARET);
	});

	it("keeps the caret on a composer vim mode does not own", () => {
		const composer = createComposer(false);
		expect(bodyRow(composer, DRAFT_HINT)).toContain(CARET);

		composer.setText("hello draft");
		expect(bodyRow(composer, "hello draft")).toContain(CARET);
	});
});
