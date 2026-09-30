import type { AssistantMessage } from "../types.ts";

export interface RecordResponseModelOptions {
	/**
	 * Whether a new report replaces the name already recorded. `true` for a provider that reports
	 * the authoritative model last, `false` for per-chunk reports where the first differing name wins.
	 */
	overwrite: boolean;
}

/**
 * Record the model the provider reports on an assistant message, so a caller can tell the user a
 * gateway routed or substituted the requested model. The field only ever names a model different
 * from the requested id, so a report that matches `requestedModelId` clears it. A missing or blank
 * report leaves the field alone.
 */
export function recordResponseModel(
	output: AssistantMessage,
	reportedModel: string | undefined,
	requestedModelId: string,
	options: RecordResponseModelOptions,
): void {
	if (typeof reportedModel !== "string" || reportedModel.trim().length === 0) return;
	if (reportedModel === requestedModelId) {
		if (options.overwrite) delete output.responseModel;
		return;
	}
	if (!options.overwrite && output.responseModel !== undefined) return;
	output.responseModel = reportedModel;
}
