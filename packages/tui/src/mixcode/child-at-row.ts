import type { ChildLines, Component } from "../tui.ts";

/**
 * The child painted at `row` of a parent's own line space, and the row inside that child, from the
 * children the parent's last render measured. Shared by `Container` and `Box`, which differ only in
 * the padding the caller subtracts from `row` first. Undefined for a row no child covers.
 */
export function childAtRow(
	layout: ChildLines | undefined,
	row: number,
): { component: Component; offset: number } | undefined {
	if (!layout) return undefined;
	let start = 0;
	for (let index = 0; index < layout.children.length; index++) {
		const end = start + layout.parts[index]!.length;
		if (row >= start && row < end) return { component: layout.children[index]!, offset: row - start };
		start = end;
	}
	return undefined;
}
