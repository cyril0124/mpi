/**
 * TypeScript/JavaScript batch executor.
 *
 * Scripts run in-process with full host privileges. The public stub users reference
 * is `mixcode-batch.d.ts` at the repository root, and the alias, field, and method
 * names here mirror it.
 */
import { createJiti } from "jiti";
import { resolveBatchScriptDir } from "./batch-lua.ts";
import { resolveBatchModel } from "./batch-models.ts";
import { parseBatchContextLimit, parseBatchPrompts, renderTemplate } from "./batch-plan.ts";
import type { BatchContext, BatchModelInfo, BatchPlan, BatchReuseMode, BatchTabRequest } from "./types.ts";

/** Options accepted by `mixcode.openTab`. camelCase mirror of the Lua snake_case table. */
export interface MixCodeBatchOpenTabOptions {
	name: string;
	prompt?: string;
	prompts?: string[];
	workdir?: string;
	model?: string;
	thinking?: string;
	/** Positive integer tokens, /context-limit text (e.g. "32k"), or "reset". */
	contextLimit?: number | string;
	systemPrompt?: string;
	mode?: BatchReuseMode;
}

/** The `mixcode` global object exposed to a TypeScript batch script. */
export interface MixCodeBatchApi {
	openTab(options: MixCodeBatchOpenTabOptions): void;
	/** Arguments after `--` in the CLI or /batch command. */
	args(): string[];
	currentWorkdir(): string;
	scriptDir(): string;
	tabExists(name: string): boolean;
	listTabs(): BatchContext["tabs"];
	listModels(): BatchModelInfo[];
	/** Resolve an exact id to provider/modelId using the invocation snapshot. */
	resolveModel(query: string): string;
	render(template: string, vars: Record<string, unknown>): string;
}

export type MixCodeBatchScript = (mixcode: MixCodeBatchApi) => void | Promise<void>;

const OPEN_TAB_FIELDS = [
	"name",
	"prompt",
	"prompts",
	"workdir",
	"model",
	"thinking",
	"contextLimit",
	"systemPrompt",
	"mode",
] as const satisfies ReadonlyArray<keyof MixCodeBatchOpenTabOptions>;

/**
 * Load and run a TypeScript/JavaScript batch script through jiti, collecting every
 * `mixcode.openTab()` call into a BatchPlan. The module must default-export a
 * function, which may be async. Throws when there is no callable default export or
 * an `openTab` call passes malformed options; load and run failures are rewrapped as
 * `Batch script error in <path>`.
 */
export async function runTsScript(
	scriptPath: string,
	context: BatchContext = { workdir: "", tabs: [] },
): Promise<BatchPlan> {
	// A batch script is re-read on every invocation, so the module cache stays off; the extension
	// loader does the same. With it on, a second `/batch` of an edited file replays the first
	// evaluation instead of reading the file again.
	const jiti = createJiti(import.meta.url, { moduleCache: false });
	const module = await withScriptPath(scriptPath, () => jiti.import(scriptPath, { default: true }));
	const script = module as unknown;
	if (typeof script !== "function") {
		throw new Error(`Batch script must default-export a function: ${scriptPath}`);
	}

	const scriptDir = resolveBatchScriptDir(scriptPath);
	const requests: BatchTabRequest[] = [];
	const api: MixCodeBatchApi = {
		openTab(options) {
			requests.push(toTabRequest(options, scriptPath));
		},
		args: () => [...(context.args ?? [])],
		currentWorkdir: () => context.workdir,
		scriptDir: () => scriptDir,
		tabExists: (name) => context.tabs.some((tab) => tab.name === name),
		listTabs: () => context.tabs.map((tab) => ({ ...tab })),
		listModels: () => (context.models ?? []).map((model) => ({ ...model })),
		resolveModel: (query) => resolveBatchModel(query, context).id,
		render: (template, vars) =>
			renderTemplate(template, (name) => {
				const value = vars[name];
				return value === undefined || value === null ? undefined : String(value);
			}),
	};

	await withScriptPath(scriptPath, () => (script as MixCodeBatchScript)(api));
	return { requests };
}

/**
 * Run `action`, rewrapping any thrown error with the script path. Errors this
 * module raises itself already name the path and pass through unchanged.
 */
async function withScriptPath<T>(scriptPath: string, action: () => Promise<T> | T): Promise<T> {
	try {
		return await action();
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		if (message.includes(scriptPath)) throw error;
		throw new Error(`Batch script error in ${scriptPath}: ${message}`, { cause: error });
	}
}

/**
 * Validate one `openTab` argument. Unknown keys are rejected rather than dropped, so
 * a misspelled field fails loudly instead of silently changing the resulting session.
 */
function toTabRequest(options: MixCodeBatchOpenTabOptions, scriptPath: string): BatchTabRequest {
	if (typeof options !== "object" || options === null) {
		throw new Error(`mixcode.openTab expects an options object (${scriptPath})`);
	}
	const unknownKeys = Object.keys(options).filter((key) => !(OPEN_TAB_FIELDS as ReadonlyArray<string>).includes(key));
	if (unknownKeys.length > 0) {
		throw new Error(
			`mixcode.openTab: unknown field(s) ${unknownKeys.join(", ")} (${scriptPath}). ` +
				`Valid fields: ${OPEN_TAB_FIELDS.join(", ")}`,
		);
	}
	const name = options.name;
	if (typeof name !== "string" || name.length === 0) {
		throw new Error(`mixcode.openTab: 'name' must be a non-empty string (${scriptPath})`);
	}
	const contextLimit = parseBatchContextLimit(options.contextLimit, name);
	const prompts = parseBatchPrompts(options.prompts, options.prompt, name);
	return {
		name,
		...(prompts !== undefined ? { prompts } : {}),
		...(contextLimit !== undefined ? { contextLimit } : {}),
		prompt: readOptionalString(options.prompt, "prompt", name, scriptPath),
		workdir: readOptionalString(options.workdir, "workdir", name, scriptPath),
		model: readOptionalString(options.model, "model", name, scriptPath),
		thinking: readOptionalString(options.thinking, "thinking", name, scriptPath),
		systemPrompt: readOptionalString(options.systemPrompt, "systemPrompt", name, scriptPath),
		mode: readOptionalString(options.mode, "mode", name, scriptPath) as BatchReuseMode | undefined,
	};
}

function readOptionalString(value: unknown, field: string, tabName: string, scriptPath: string): string | undefined {
	if (value === undefined || value === null) return undefined;
	if (typeof value !== "string") {
		throw new Error(`mixcode.openTab: '${field}' must be a string for tab '${tabName}' (${scriptPath})`);
	}
	return value;
}
