import type { SessionEntry } from "../../../../core/session-manager.ts";

/** Place the context's leading compaction after retained history and before later entries. */
export function chronologicalTranscriptEntries(entries: SessionEntry[], branch: SessionEntry[]): SessionEntry[] {
	const compaction = entries[0];
	if (compaction?.type !== "compaction") return entries;

	const compactionIndex = branch.findIndex((entry) => entry.id === compaction.id);
	if (compactionIndex < 0) return entries;

	const laterIds = new Set(branch.slice(compactionIndex + 1).map((entry) => entry.id));
	const retained = entries.slice(1);
	const firstLaterEntry = retained.findIndex((entry) => laterIds.has(entry.id));
	const insertionIndex = firstLaterEntry < 0 ? retained.length : firstLaterEntry;
	return [...retained.slice(0, insertionIndex), compaction, ...retained.slice(insertionIndex)];
}
