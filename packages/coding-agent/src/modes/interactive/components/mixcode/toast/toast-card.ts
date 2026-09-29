/**
 * Toast card: a typed message in a rounded frame, sized to the terminal and
 * painted by the overlay renderer in the top-right corner.
 *
 * The card renders exactly the width it is handed, so the caller asks
 * {@link toastBoxWidth} for that width and the same rules decide whether a
 * toast fits at all.
 */
import { type Component, truncateToWidth, visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import type { ToastType } from "../../../../../core/mixcode/toast/toast.ts";
import { type ThemeColor, theme } from "../../../theme/theme.ts";
import { panel } from "../panel.ts";

/** Narrowest card that still reads as a box. */
const TOAST_MIN_BOX_WIDTH = 24;
/** Widest card, whatever the terminal. */
const TOAST_MAX_BOX_WIDTH = 48;
/** Share of the terminal width a card may take. */
const TOAST_MAX_WIDTH_RATIO = 0.45;
/** Message rows shown before the text is cut short. */
const TOAST_MAX_MESSAGE_ROWS = 3;
/** Margin the card keeps from the terminal edges; the caller passes the same value to the overlay. */
export const TOAST_MARGIN = 1;
/** Rows of text the wrap reads: the message rows plus one, past which nothing reaches the card. */
const WRAP_BUDGET_ROWS = TOAST_MAX_MESSAGE_ROWS + 1;

/**
 * Width of the card for `type` and `message` in a terminal `termWidth` columns
 * wide, or undefined when the card cannot fit and must not be painted.
 */
export function toastBoxWidth(type: ToastType, message: string, termWidth: number): number | undefined {
	const preferred = visibleWidth(`${toastIcon(type)} ${message}`) + 4;
	const maxBoxWidth = Math.min(
		termWidth - TOAST_MARGIN,
		Math.max(TOAST_MIN_BOX_WIDTH, Math.min(TOAST_MAX_BOX_WIDTH, Math.floor(termWidth * TOAST_MAX_WIDTH_RATIO))),
	);
	if (maxBoxWidth < TOAST_MIN_BOX_WIDTH) return undefined;
	return Math.min(maxBoxWidth, Math.max(TOAST_MIN_BOX_WIDTH, preferred));
}

/** Rows the card occupies for `message` at `boxWidth`, borders included. */
export function toastCardRows(type: ToastType, message: string, boxWidth: number): number {
	return 1 + toastMessageRows(type, message, cardContentWidth(boxWidth)).length + 1;
}

/**
 * Card body rows: the icon and message wrapped to `contentWidth`, at most
 * {@link TOAST_MAX_MESSAGE_ROWS} rows, with the last one cut short. Only the text
 * that can still reach a row is wrapped, so a long message costs what a short one
 * does.
 */
export function toastMessageRows(type: ToastType, message: string, contentWidth: number): string[] {
	const text = `${toastIcon(type)} ${message}`;
	const clipped = truncateToWidth(text, contentWidth * WRAP_BUDGET_ROWS, "");
	const wrapped = wrapTextWithAnsi(clipped, contentWidth);
	if (clipped === text && wrapped.length <= TOAST_MAX_MESSAGE_ROWS) return wrapped;

	const shown = wrapped.slice(0, TOAST_MAX_MESSAGE_ROWS);
	if (shown.length === 0) return shown;
	const last = shown.length - 1;
	const available = Math.max(0, contentWidth - visibleWidth("…"));
	shown[last] = `${truncateToWidth((shown[last] ?? "").trimEnd(), available, "")}…`;
	return shown;
}

export class ToastCardComponent implements Component {
	private readonly type: ToastType;
	private readonly message: string;

	constructor(type: ToastType, message: string) {
		this.type = type;
		this.message = message;
	}

	invalidate(): void {
		// The card renders from the current theme and message; nothing is cached.
	}

	render(width: number): string[] {
		const boxWidth = Math.max(1, Math.floor(width));
		const rows = toastMessageRows(this.type, this.message, cardContentWidth(boxWidth)).map((row, index) =>
			styleToastRow(row, index === 0 ? this.type : undefined),
		);
		return panel("", rows, boxWidth, {
			rounded: true,
			borderColor: toastColor(this.type),
			backgroundColor: "panelBg",
		});
	}
}

/** Content columns inside the frame: both borders and their padding take four. */
function cardContentWidth(boxWidth: number): number {
	return Math.max(1, Math.floor(boxWidth) - 4);
}

/** Paint the leading icon of the first row in the type color, the rest of that row in the text color. */
function styleToastRow(row: string, type: ToastType | undefined): string {
	if (type === undefined) return theme.fg("text", row);
	const icon = toastIcon(type);
	if (!row.startsWith(icon)) return theme.fg("text", row);
	return `${theme.fg(toastColor(type), icon)}${theme.fg("text", row.slice(icon.length))}`;
}

function toastIcon(type: ToastType): string {
	if (type === "success") return "✓";
	if (type === "warning") return "⚠";
	if (type === "error") return "✖";
	return "•";
}

function toastColor(type: ToastType): ThemeColor {
	if (type === "success") return "success";
	if (type === "warning") return "warning";
	if (type === "error") return "error";
	return "accent";
}
