import type { Component } from "../tui.ts";

/**
 * The child painted at `row` of a parent's own line space, and the row inside that child, from the
 * children the parent's last render measured. Shared by `Container` and `Box`, which differ only in
 * the padding the caller subtracts from `row` first. Undefined for a row no child covers.
 */
export function childAtRow(
	children: ReadonlyArray<{ component: Component; height: number }> | undefined,
	row: number,
): { component: Component; offset: number } | undefined {
	if (!children) return undefined;
	let start = 0;
	for (const { component, height } of children) {
		if (row >= start && row < start + height) return { component, offset: row - start };
		start += height;
	}
	return undefined;
}
