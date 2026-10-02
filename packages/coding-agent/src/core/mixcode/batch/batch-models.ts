/**
 * Model resolution against one batch invocation snapshot, with no I/O.
 */
import { type Api, getSupportedThinkingLevels, type Model } from "@earendil-works/pi-ai";
import type { BatchContext, BatchModelInfo, BatchResolvedModel } from "./types.ts";

/** Turn a snapshot row into a resolved model; the host catalog owns thinking levels. */
export function toResolvedModel(model: BatchModelInfo, thinkingLevels: readonly string[]): BatchResolvedModel {
	return { ...model, thinkingLevels };
}

/** Turn one catalog row into the snapshot row scripts read from `list_models()`. */
export function catalogModelToInfo<TApi extends Api>(model: Model<TApi>): BatchModelInfo {
	return {
		id: `${model.provider}/${model.id}`,
		provider: model.provider,
		modelId: model.id,
		displayName: model.name,
		contextWindow: model.contextWindow,
		reasoning: Boolean(model.reasoning),
	};
}

/** Turn one catalog row into a snapshot row, adding the thinking levels the host reports. */
export function catalogModelToResolved<TApi extends Api>(model: Model<TApi>): BatchResolvedModel {
	return toResolvedModel(catalogModelToInfo(model), getSupportedThinkingLevels(model));
}

/**
 * Resolve a reference to a snapshot model. A canonical `provider/modelId` wins over
 * a bare id; a bare id prefers the invocation's default provider, then the smallest
 * provider name, and skips disabled candidates. Throws for a malformed query, a
 * disabled explicit reference, or no enabled candidate.
 */
export function resolveBatchModel(query: unknown, context: BatchContext): BatchModelInfo {
	if (typeof query !== "string" || !query.trim()) {
		throw new Error("Error: Model query must be a non-empty string");
	}
	const normalized = query.trim();
	const disabled = new Set(context.disabledModelIds ?? []);
	let selected: BatchModelInfo | undefined;
	for (const model of context.models ?? []) {
		if (model.id === normalized) {
			if (disabled.has(model.id)) throw new Error(`Error: Model is disabled: ${normalized}`);
			return model;
		}
		if (model.modelId !== normalized || disabled.has(model.id)) continue;
		const preferred = model.provider === context.defaultProvider;
		const selectedPreferred = selected?.provider === context.defaultProvider;
		if (
			!selected ||
			(preferred && !selectedPreferred) ||
			(preferred === selectedPreferred && model.provider < selected.provider)
		) {
			selected = model;
		}
	}
	if (!selected) throw new Error(`Error: No available model matches: ${normalized}`);
	return selected;
}
