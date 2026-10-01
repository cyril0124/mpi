/**
 * The `/context-limit` picker: quarter/half/three-quarter/full rows plus a
 * free-text row for an arbitrary token count.
 *
 * One component owns both modes so the surface never nests: picking `Custom`
 * swaps the rows for a single-line input, and Escape steps back to the rows.
 */
import {
	type Component,
	Container,
	type Focusable,
	Input,
	type SelectItem,
	SelectList,
	type SelectListLayoutOptions,
	Spacer,
	Text,
} from "@earendil-works/pi-tui";
import {
	type ContextLimitValue,
	contextLimitPickerItems,
	parseContextLimitValue,
} from "../../../../../core/mixcode/context-limit.ts";
import { getSelectListTheme, theme } from "../../../theme/theme.ts";
import { DynamicBorder } from "../../dynamic-border.ts";
import { keyDisplayText } from "../../keybinding-hints.ts";

const CONTEXT_LIMIT_SELECT_LIST_LAYOUT: SelectListLayoutOptions = {
	minPrimaryColumnWidth: 10,
	maxPrimaryColumnWidth: 24,
};

const CUSTOM_PROMPT = "Enter context limit (e.g. 32k, 40000)";
const CUSTOM_ERROR = "Invalid: enter a number (e.g. 32k, 40000)";

/**
 * Renders the context limit selector. `onSelect` receives a parsed value; the
 * caller applies it and closes the selector.
 */
export class ContextLimitSelectorComponent extends Container implements Focusable {
	private readonly onSelect: (value: ContextLimitValue) => void;
	private readonly onCancel: () => void;
	private readonly items: SelectItem[];
	private readonly selectList: SelectList;
	private readonly customInput: Input;
	private readonly errorText: Text;
	private readonly hint: Text;
	/** Index in `children` where the mode-specific body starts. */
	private readonly bodyStart: number;
	private bodyLength = 0;
	private customMode = false;
	private _focused = false;

	get focused(): boolean {
		return this._focused;
	}

	set focused(value: boolean) {
		this._focused = value;
		// The rows take no text, so only the custom input has a cursor to focus.
		if (this.customMode) this.customInput.focused = value;
	}

	constructor(modelContextWindow: number, onSelect: (value: ContextLimitValue) => void, onCancel: () => void) {
		super();
		this.onSelect = onSelect;
		this.onCancel = onCancel;
		this.items = contextLimitPickerItems(modelContextWindow).map((item) => ({
			value: item.id,
			label: item.label,
			description: item.description,
		}));

		this.addChild(new DynamicBorder());
		this.addChild(new Spacer(1));
		this.addChild(new Text("Set Context Limit", 0, 0));
		this.addChild(new Spacer(1));
		this.bodyStart = this.children.length;

		this.selectList = this.buildSelectList();

		this.customInput = new Input({ prompt: "> " });
		this.customInput.onSubmit = (value) => this.submitCustomValue(value);
		this.customInput.onEscape = () => this.showList();
		this.errorText = new Text("", 0, 0);

		this.setBody(this.listBody());
		this.addChild(new Spacer(1));
		this.hint = new Text("", 0, 0);
		this.addChild(this.hint);
		this.addChild(new DynamicBorder());
		this.updateHint();
	}

	private buildSelectList(): SelectList {
		const list = new SelectList(
			this.items,
			Math.max(1, this.items.length),
			getSelectListTheme(),
			CONTEXT_LIMIT_SELECT_LIST_LAYOUT,
		);
		list.onSelect = (item) => this.onRowSelected(item.value);
		list.onCancel = () => this.onCancel();
		return list;
	}

	/** A preset row applies directly; the custom row switches the body to free-text entry. */
	private onRowSelected(id: string): void {
		if (id === "custom") {
			this.showCustomInput();
			return;
		}
		if (id === "reset") {
			this.onSelect("reset");
			return;
		}
		const value = Number.parseInt(id, 10);
		if (Number.isFinite(value) && value > 0) this.onSelect(value);
	}

	private submitCustomValue(text: string): void {
		const value = parseContextLimitValue(text);
		if (value === undefined) {
			this.errorText.setText(theme.fg("error", CUSTOM_ERROR));
			return;
		}
		this.onSelect(value);
	}

	private showCustomInput(): void {
		this.customMode = true;
		this.customInput.setValue("");
		this.errorText.setText("");
		this.setBody([new Text(CUSTOM_PROMPT, 0, 0), new Spacer(1), this.customInput, this.errorText]);
		this.customInput.focused = this._focused;
		this.updateHint();
	}

	private showList(): void {
		this.customMode = false;
		this.setBody(this.listBody());
		this.updateHint();
	}

	private listBody(): Component[] {
		return [this.selectList];
	}

	private updateHint(): void {
		const hint = this.customMode
			? `  ${keyDisplayText("tui.input.submit")} to confirm · ${keyDisplayText("tui.select.cancel")} to go back`
			: `  ${keyDisplayText("tui.select.confirm")} to select · ${keyDisplayText("tui.select.cancel")} to cancel`;
		this.hint.setText(theme.fg("dim", hint));
	}

	private setBody(children: Component[]): void {
		this.children.splice(this.bodyStart, this.bodyLength, ...children);
		this.bodyLength = children.length;
	}

	handleInput(keyData: string): void {
		if (this.customMode) {
			this.customInput.handleInput(keyData);
			return;
		}
		// The rows handle up/down, confirm and cancel, and ignore every other key.
		this.selectList.handleInput(keyData);
	}
}
