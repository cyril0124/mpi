export type SettingsListRow = { kind: "header"; title: string } | { kind: "gap" } | { kind: "item"; itemIndex: number };

/**
 * Rows for one visible window. A heading is emitted where a section starts, so a
 * window that opens in the middle of a section does not repeat its heading.
 */
export function settingsListRows(
	items: readonly { section?: string }[],
	startIndex: number,
	endIndex: number,
	showSectionHeaders: boolean,
): SettingsListRow[] {
	const rows: SettingsListRow[] = [];
	for (let index = startIndex; index < endIndex; index += 1) {
		const item = items[index];
		if (!item) continue;
		const startsSection = index === 0 || items[index - 1]?.section !== item.section;
		if (showSectionHeaders && startsSection && item.section) {
			if (rows.length > 0) rows.push({ kind: "gap" });
			rows.push({ kind: "header", title: item.section });
		}
		rows.push({ kind: "item", itemIndex: index });
	}
	return rows;
}
