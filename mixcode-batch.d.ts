/**
 * Batch script API for TypeScript/JavaScript scripts.
 *
 * Write a script file and run it with `mpi --batch script.ts` or `/batch script.ts`:
 *
 * ```ts
 * /// <reference path="/path/to/mixcode-batch.d.ts" />
 * const script: MixCodeBatchScript = (mixcode) => {
 *   mixcode.openTab({ name: "review", prompt: "Review the current branch." });
 * };
 * export default script;
 * ```
 *
 * The Lua counterpart is `mixcode-batch.d.lua`. Field names are camelCase here.
 */

type MixCodeBatchThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

/** How a request treats an existing tab with the same name. */
type MixCodeBatchReuseMode = "append" | "clear" | "delete";

interface MixCodeBatchOpenTabOptions {
  /** Tab title; matched exactly when reusing an existing tab. */
  name: string;
  /** One input to submit; mutually exclusive with `prompts`. Omit both to configure a tab without input. */
  prompt?: string;
  /** Ordered inputs, each its own round; mutually exclusive with `prompt`. Blank entries are skipped. */
  prompts?: string[];
  /** Workdir for a new tab; rejected when the named tab already exists with a different workdir. */
  workdir?: string;
  /** Model id or `provider/modelId` from `listModels()`; omitted keeps the tab's model. */
  model?: string;
  /** Thinking level; omitted keeps the tab's level. */
  thinking?: MixCodeBatchThinkingLevel;
  /** Context budget: positive tokens, a `/context-limit` string such as `"32k"`, or `"reset"`. */
  contextLimit?: number | string;
  /** Base system prompt for a new session. The interactive host rejects it; the CLI dry-run accepts it. */
  systemPrompt?: string;
  /** Reuse behavior; defaults to `append`. */
  mode?: MixCodeBatchReuseMode;
}

/** One open tab in the invocation snapshot. */
interface MixCodeBatchTabInfo {
  name: string;
  sessionId: string;
  workdir: string;
  model: string;
  thinking: string;
  status: string;
}

/** One model in the invocation catalog. */
interface MixCodeBatchModelInfo {
  /** Canonical `provider/modelId`, accepted by `openTab({ model })`. */
  id: string;
  provider: string;
  modelId: string;
  displayName: string;
  contextWindow: number;
  reasoning: boolean;
}

interface MixCodeBatchApi {
  /** Collect a tab request. Requests are applied after the script returns. */
  openTab(options: MixCodeBatchOpenTabOptions): void;
  /** Arguments after `--`, verbatim. */
  args(): string[];
  /** Directory the invocation runs in: the calling tab's workdir for `/batch`, else the instance workdir. */
  currentWorkdir(): string;
  /** Directory of the script file itself; differs from `currentWorkdir()` when the script lives elsewhere. */
  scriptDir(): string;
  /** Whether the snapshot holds a tab with this exact title. */
  tabExists(name: string): boolean;
  /** Tabs captured before this invocation. */
  listTabs(): MixCodeBatchTabInfo[];
  /** Model catalog captured before this invocation. */
  listModels(): MixCodeBatchModelInfo[];
  /** Resolve a model reference to a canonical id, or throw when no enabled model matches. */
  resolveModel(query: string): string;
  /** Fill `{name}` placeholders from `vars`; `{{` and `}}` are literal braces. */
  render(template: string, vars: Record<string, unknown>): string;
}

/** A batch script: a default-exported function, optionally async. */
type MixCodeBatchScript = (mixcode: MixCodeBatchApi) => void | Promise<void>;
