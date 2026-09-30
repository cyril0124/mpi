import type { Component } from "@earendil-works/pi-tui";
import { theme } from "../../src/modes/interactive/theme/theme.ts";

/** The hover cue's background-open SGR, the sequence a hovered row is painted with. */
export function hoverBackgroundOpen(): string {
	return theme.getBgAnsi("selectedBg");
}

/**
 * A widget stand-in: body rows, a render counter, and a replaceable body. A keyed
 * body names its rows `<key>-body-<index>`, the shape the dock and inline tests assert.
 */
export class WidgetBody implements Component {
	renders = 0;
	private readonly key: string | undefined;
	private rows: string[];

	static keyed(key: string, count: number): WidgetBody {
		return new WidgetBody(key, count);
	}

	static lines(lines: string[]): WidgetBody {
		return new WidgetBody(lines);
	}

	private constructor(rowsOrKey: string | string[], count?: number) {
		if (typeof rowsOrKey === "string") {
			this.key = rowsOrKey;
			this.rows = keyedRows(rowsOrKey, count ?? 0);
		} else {
			this.rows = rowsOrKey;
		}
	}

	/** Replace a keyed body with `count` rows. A literal-row body has no key to rebuild from. */
	setRowCount(count: number): void {
		if (this.key === undefined) throw new Error("WidgetBody.lines has no key to rebuild rows from");
		this.rows = keyedRows(this.key, count);
	}

	render(_width: number): string[] {
		this.renders += 1;
		return this.rows;
	}

	invalidate(): void {}
}

function keyedRows(key: string, count: number): string[] {
	return Array.from({ length: count }, (_, index) => `${key}-body-${index}`);
}

/** The single screen row that contains `marker`, trimmed of the padding the overlay adds. */
export function overlayPanelLine(screenLines: string[], marker: string): string {
	return screenLines
		.find((line) => line.includes(marker))!
		.trimEnd()
		.replace(/^\s*/, "");
}
