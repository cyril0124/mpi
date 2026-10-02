/**
 * CLI entry helper for `--batch-dry-run`.
 *
 * The dry-run loads and validates a script against the startup model snapshot and
 * returns the plan text. It never creates a tab, writes a session, or starts the
 * TUI; the caller prints the text and exits.
 */
import * as path from "node:path";
import type { AgentSession } from "../../agent-session.ts";
import { loadBatchRequests } from "./batch-loader.ts";
import { catalogModelToInfo, catalogModelToResolved, resolveBatchModel } from "./batch-models.ts";
import { formatBatchPlan, validateBatchRequests } from "./batch-plan.ts";
import type { BatchContext } from "./types.ts";

export interface BatchDryRunRequest {
	/** Directory the invocation runs in; a relative script path resolves against it. */
	workdir: string;
	/** Script path as given on the command line. */
	scriptPath: string;
	/** Script arguments after `--`. */
	args: string[];
	/** Startup session: supplies the snapshot and the implicit model for same-name requests. */
	session: AgentSession;
}

/**
 * Build the invocation snapshot the script reads: the startup tab and the model
 * catalog, both as they stand before the script runs.
 */
function dryRunContext(input: BatchDryRunRequest): BatchContext {
	const { session } = input;
	const model = session.model;
	return {
		workdir: input.workdir,
		tabs: [
			{
				name: session.sessionManager.getSessionName() ?? "Agent-01",
				sessionId: session.sessionManager.getSessionId(),
				workdir: input.workdir,
				model: model ? `${model.provider}/${model.id}` : "",
				thinking: session.thinkingLevel,
				status: "idle",
			},
		],
		models: session.modelRuntime.getAvailableSnapshot().map(catalogModelToInfo),
		defaultProvider: model?.provider,
		args: input.args,
	};
}

/** Resolve a model reference against the dry-run catalog, or throw when the catalog lacks it. */
function resolveDryRunModel(session: AgentSession, query: string, context: BatchContext) {
	const resolved = resolveBatchModel(query, context);
	const model = session.modelRuntime
		.getAvailableSnapshot()
		.find((candidate) => candidate.provider === resolved.provider && candidate.id === resolved.modelId);
	if (!model) throw new Error(`Error: No available model matches: ${resolved.id}`);
	return catalogModelToResolved(model);
}

/**
 * Load and validate the batch plan, returning the text `--batch-dry-run` prints.
 * Throws with a user-facing message when the script, a request, or a model
 * reference is invalid.
 */
export async function loadBatchDryRunPlan(input: BatchDryRunRequest): Promise<string> {
	const context = dryRunContext(input);
	const plan = await loadBatchRequests(path.resolve(input.workdir, input.scriptPath), context);
	const sessionModel = input.session.model;
	validateBatchRequests(
		plan.requests,
		(query) => resolveDryRunModel(input.session, query, context),
		// A request without an explicit model inherits the startup session's model,
		// except under `delete`, where the tab starts from scratch on the default.
		(request) => (request.mode === "delete" || !sessionModel ? undefined : catalogModelToResolved(sessionModel)),
	);
	return formatBatchPlan(plan);
}
