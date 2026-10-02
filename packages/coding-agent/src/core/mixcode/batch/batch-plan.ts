/**
 * Batch request parsing, validation, and application.
 *
 * Shared by the Lua and TypeScript executors and by the CLI dry-run. Everything
 * here is host-agnostic: the host interface carries all runtime access, so the
 * same plan applies identically in the TUI and in tests.
 */
import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import { parseContextLimitValue } from "../context-limit.ts";
import type { BatchExecutorHost, BatchPlan, BatchResolvedModel, BatchTabRequest } from "./types.ts";

/** True when an input would run as a shell command (`!` / `!!`) rather than a prompt. */
function isBatchShellInput(text: string): boolean {
	return text.trimStart().startsWith("!");
}

/**
 * Snapshot and validate a script's prompt sequence before any tab mutation.
 * Nullish values mean omitted. Requires an array of strings without gaps and at
 * least one nonblank entry. Omits blank entries without trimming retained text.
 * Rejects shell input and simultaneous prompt/prompts fields.
 */
export function parseBatchPrompts(input: unknown, prompt: unknown, tabName: string): string[] | undefined {
	if (input === undefined || input === null) return undefined;
	const invalid = (detail: string) => new Error(`Error: Invalid prompts for tab '${tabName}': ${detail}`);
	if (prompt !== undefined && prompt !== null) {
		throw invalid("prompt and prompts are mutually exclusive");
	}
	if (!Array.isArray(input) || input.length === 0) {
		throw invalid("expected a non-empty array of strings");
	}
	const prompts: string[] = [];
	for (let index = 0; index < input.length; index++) {
		const text: unknown = input[index];
		if (typeof text !== "string") {
			throw invalid(`entry ${index + 1} must be a string`);
		}
		if (!text.trim()) continue;
		if (isBatchShellInput(text)) {
			throw invalid(`entry ${index + 1} cannot execute !shell or !!shell`);
		}
		prompts.push(text);
	}
	if (prompts.length === 0) {
		throw invalid("expected at least one non-blank prompt or command");
	}
	return prompts;
}

/**
 * Normalize an external Lua/JS context limit. Nullish values mean omitted;
 * strings use /context-limit syntax, while numbers must be positive safe integers.
 * Throws with the tab name on unsupported types or out-of-range token counts.
 */
export function parseBatchContextLimit(input: unknown, tabName: string): BatchTabRequest["contextLimit"] {
	if (input === undefined || input === null) return undefined;
	const value = typeof input === "string" ? parseContextLimitValue(input) : input;
	if (value === "reset") return value;
	if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) return value;
	throw new Error(
		`Error: Invalid context limit for tab '${tabName}'. ` +
			`Use positive safe integer tokens, a token string (e.g. "32k"), or "reset".`,
	);
}

/** True when a request's thinking level is accepted by its resolved model. */
function isThinkingAvailable(level: string, model: BatchResolvedModel | undefined): boolean {
	if (!model) return true;
	if (model.thinkingLevels.length === 0) return false;
	return model.thinkingLevels.includes(level);
}

/** Comma-separated list of the thinking levels a model accepts, for an error message. */
function validThinkingLevelsMessage(model: BatchResolvedModel | undefined): string {
	return model && model.thinkingLevels.length > 0 ? model.thinkingLevels.join(", ") : "off";
}

/**
 * Validate all tab options and prompt sequences before the host mutates any
 * sessions. Returns the explicit model each request resolved to.
 */
export function validateBatchRequests(
	requests: BatchTabRequest[],
	resolveModel: (query: string) => BatchResolvedModel,
	resolveImplicitModel: (request: BatchTabRequest) => BatchResolvedModel | undefined = () => undefined,
): Map<BatchTabRequest, BatchResolvedModel> {
	const resolvedModels = new Map<BatchTabRequest, BatchResolvedModel>();
	const effectiveModels = new Map<string, BatchResolvedModel>();
	for (const request of requests) {
		// Guard plans supplied directly by callers before any session mutation.
		parseBatchPrompts(request.prompts, request.prompt, request.name);
		parseBatchContextLimit(request.contextLimit, request.name);
		if (request.mode === "clear" && request.systemPrompt !== undefined) {
			throw new Error(
				`Error: system_prompt for tab '${request.name}' cannot be used with mode="clear"; ` +
					`use mode="delete", or a new tab name without mode="clear"`,
			);
		}
		const explicitModel = request.model ? resolveModel(request.model) : undefined;
		if (explicitModel) resolvedModels.set(request, explicitModel);
		const model = explicitModel ?? effectiveModels.get(request.name) ?? resolveImplicitModel(request);
		if (model) effectiveModels.set(request.name, model);
		if (request.thinking && !isThinkingAvailable(request.thinking, model)) {
			throw new Error(
				`Invalid thinking level '${request.thinking}' for tab '${request.name}'. ` +
					`Valid values: ${validThinkingLevelsMessage(model)}`,
			);
		}
		if (request.mode && !["append", "clear", "delete"].includes(request.mode)) {
			throw new Error(
				`Invalid mode '${request.mode}' for tab '${request.name}'. Valid values: append, clear, delete`,
			);
		}
	}
	return resolvedModels;
}

/**
 * `system_prompt` only applies when a new session is created (new tab or delete).
 * Append and clear reuse keep the existing session base prompt.
 */
function validateSystemPromptRequests(requests: BatchTabRequest[], findExisting: (name: string) => boolean): void {
	const seenNames = new Set<string>();
	for (const request of requests) {
		if (!request.systemPrompt) {
			seenNames.add(request.name);
			continue;
		}
		if (seenNames.has(request.name)) {
			throw new Error(
				`Error: system_prompt for tab '${request.name}' only applies when creating a new session; ` +
					`later requests for the same tab reuse the session`,
			);
		}
		seenNames.add(request.name);
		const mode = request.mode ?? "append";
		if (findExisting(request.name) && mode === "append") {
			throw new Error(
				`Error: system_prompt for tab '${request.name}' requires a new session; ` +
					`use mode="delete", or a new tab name`,
			);
		}
	}
}

/**
 * Create/reuse tabs by exact title, then apply each tab's requests in order.
 * Distinct tab groups run concurrently. Setup failures stop dispatch; a failed
 * group leaves the other groups running and applied changes intact.
 */
export async function applyBatchRequests(requests: BatchTabRequest[], host: BatchExecutorHost): Promise<void> {
	if (requests.length === 0) return;

	const resolvedModels = validateBatchRequests(
		requests,
		(query) => host.resolveModel(query),
		(request) => (request.mode === "delete" ? host.defaultModel : host.resolveModelByTitle(request.name)),
	);
	validateSystemPromptRequests(requests, (name) => host.tabExists(name));

	const resolved: Array<{
		request: BatchTabRequest;
		existingSessionId: string | undefined;
		model: BatchResolvedModel | undefined;
		thinking: BatchTabRequest["thinking"];
	}> = [];

	for (const request of requests) {
		const existing = host.findTabByTitle(request.name);
		const model = resolvedModels.get(request);
		resolved.push({ request, existingSessionId: existing?.sessionId, model, thinking: request.thinking });
	}

	// Group by tab name: same-name requests execute sequentially (order matters).
	const groups = new Map<string, typeof resolved>();
	for (const entry of resolved) {
		const group = groups.get(entry.request.name);
		if (group) group.push(entry);
		else groups.set(entry.request.name, [entry]);
	}

	// Create, clear, or delete each tab serially: creating a runtime is not concurrency-safe.
	const groupSessions = new Map<string, string>();
	for (const [name, group] of groups) {
		let sessionId: string | undefined = group[0]!.existingSessionId;
		if (sessionId && group[0]!.request.mode === "delete") {
			await host.deleteTab(sessionId);
			sessionId = undefined;
		}
		if (!sessionId) {
			sessionId = await host.createNewTab(group[0]!.request);
		} else if (group[0]!.request.mode === "clear") {
			await host.clearTab(sessionId);
		}
		groupSessions.set(name, sessionId);
	}

	// Dispatch each tab's requests in order; distinct tabs drain concurrently.
	await Promise.all(
		[...groups.entries()].map(async ([name, group]) => {
			const sessionId = groupSessions.get(name)!;
			for (const { request, model, thinking } of group) {
				const { contextLimit } = request;
				if (model || thinking || contextLimit !== undefined || request.workdir !== undefined) {
					await host.configureTab(sessionId, {
						...(model ? { model } : {}),
						...(thinking ? { thinking: thinking as ThinkingLevel } : {}),
						...(contextLimit !== undefined ? { contextLimit } : {}),
						...(request.workdir !== undefined ? { workdir: request.workdir } : {}),
					});
				}
				if (request.prompts !== undefined) {
					await host.queuePrompts(
						sessionId,
						request.prompts.filter((text) => text.trim()),
					);
				}
				if (request.prompt !== undefined) await host.submitInput(sessionId, request.prompt);
			}
		}),
	);
}

/** Human-readable plan for `--batch-dry-run`. */
export function formatBatchPlan(plan: BatchPlan): string {
	const lines = [`Batch dry-run: ${plan.requests.length} request(s)`];
	plan.requests.forEach((req, index) => {
		const parts = [`${index + 1}. name=${req.name}`];
		if (req.mode) parts.push(`mode=${req.mode}`);
		if (req.model) parts.push(`model=${req.model}`);
		if (req.thinking) parts.push(`thinking=${req.thinking}`);
		if (req.contextLimit !== undefined) parts.push(`context_limit=${req.contextLimit}`);
		if (req.workdir) parts.push(`workdir=${req.workdir}`);
		if (req.systemPrompt) parts.push("system_prompt=yes");
		lines.push(parts.join(" "));
		if (req.prompts !== undefined) {
			const prompts = req.prompts.filter((text) => text.trim());
			lines.push(`   prompts: ${prompts.length} exclusive round(s)`);
			for (const [index, prompt] of prompts.entries()) lines.push(`     ${index + 1}. ${prompt}`);
		} else {
			lines.push(req.prompt === undefined ? "   prompt: (none)" : `   prompt: ${req.prompt}`);
		}
	});
	return lines.join("\n");
}

/**
 * `{{name}}` template interpolation shared by Lua `render(...)` and TS `render(...)`.
 * `{{` and `}}` are literal braces; `{name}` resolves through `resolveVar` and
 * fails when the variable is missing.
 */
export function renderTemplate(template: string, resolveVar: (name: string) => string | undefined): string {
	let output = "";
	for (let index = 0; index < template.length; index++) {
		const char = template[index];
		const next = template[index + 1];
		if (char === "{" && next === "{") {
			output += "{";
			index++;
			continue;
		}
		if (char === "}" && next === "}") {
			output += "}";
			index++;
			continue;
		}
		if (char === "}") throw new Error("Unexpected '}' in template");
		if (char !== "{") {
			output += char;
			continue;
		}
		const end = template.indexOf("}", index + 1);
		if (end < 0) throw new Error("Unclosed '{' in template");
		const name = template.slice(index + 1, end);
		if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
			throw new Error(`Invalid template variable: ${name || "<empty>"}`);
		}
		const value = resolveVar(name);
		if (value === undefined) throw new Error(`Missing template variable: ${name}`);
		output += value;
		index = end;
	}
	return output;
}
