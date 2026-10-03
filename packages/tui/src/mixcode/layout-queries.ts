import type { ScrollView } from "../components/scroll-view.ts";
import { getScrollViewBox, type LayoutBox, type LayoutFrame } from "../layout.ts";
import type { Component } from "../tui.ts";
import type { ScrollLineProvider } from "./windowed-node.ts";

/** The box that rendered `component` in the committed frame, if any box matched. */
export function getComponentBox(frame: LayoutFrame, component: Component): LayoutBox | undefined {
	const visit = (box: LayoutBox): LayoutBox | undefined => {
		if (box.component === component) return box;
		for (const child of box.children) {
			const match = visit(child);
			if (match) return match;
		}
		return undefined;
	};
	return visit(frame.root);
}

/**
 * Content lines of a scroll view, whether it rendered them in full or exposes
 * them through a windowed child. Returns undefined when the view is not in the
 * committed frame.
 */
export function getScrollLineProvider(frame: LayoutFrame, scrollView: ScrollView): ScrollLineProvider | undefined {
	return getScrollViewBox(frame, scrollView)?.lineProvider;
}

/** Materialized content lines of a scroll view, or undefined when it has none. */
export function materializeScrollLines(frame: LayoutFrame, scrollView: ScrollView): string[] | undefined {
	const provider = getScrollLineProvider(frame, scrollView);
	if (!provider) return undefined;
	// A windowed source reports an estimated line count, which is short of the real
	// document until every part has been rendered; materializing renders them all.
	if (provider.materialize) return provider.materialize();
	return provider.getLines(0, provider.lineCount());
}
