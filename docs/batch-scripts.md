# Batch scripts

Batch scripts collect named agent tab requests and execute them from the CLI or the interactive TUI.

## Entry points

```text
mpi --batch script.ts -- arg1 "two words"
mpi --batch script.lua --batch-dry-run -- arg1
/batch script.ts -- arg1 "two words"
```

`--batch-dry-run` loads and validates the script, prints the request plan, and exits before applying tabs or prompts. `--batch` and `--batch-dry-run` need a terminal; `--batch` opens the TUI and applies the plan after startup. `/batch` resolves relative paths from the active tab workdir, or the instance workdir when Home is focused.

## TypeScript API

Scripts default-export a function. `openTab` accepts `name`, `prompt`, `prompts`, `workdir`, `model`, `thinking`, `contextLimit`, `systemPrompt`, and `mode` (`append`, `clear`, or `delete`). `prompts` is an ordered sequence; blank entries are skipped. Requests with the same name run in order. Different names run concurrently.

The `mixcode` API exposes `args()`, `currentWorkdir()`, `scriptDir()`, `tabExists()`, `listTabs()`, `listModels()`, `resolveModel()`, and `render()`.

```ts
/// <reference path="/path/to/mixcode-batch.d.ts" />
export default (mixcode: MixCodeBatchApi) => {
  for (const packageName of mixcode.args()) {
    mixcode.openTab({
      name: packageName,
      prompt: `Review ${packageName}`,
    });
  }
};
```

## Lua API

Lua uses the same behavior with snake_case names: `mixcode.open_tab`, `current_workdir`, `script_dir`, `tab_exists`, `list_tabs`, `list_models`, and `resolve_model`. The API is defined in `mixcode-batch.d.lua`.

## Prompt dispatch

A prompt can be plain text, a skill or template command, an extension command, or a tab-scoped local command. `/color`, `/name`, `/rename`, `/reset`, `/model`, `/thinking`, `/context-limit`, and `/compact` run on the tab that owns the request. Every other input goes through that tab's session, which runs registered extension commands itself and treats unmatched slash input as message text. A nested `/batch` is rejected.

A new tab applies its requested model, thinking level and context limit before its extensions bind, and the requested name is written after the bind succeeds. Extensions a tab loads therefore see the requested configuration at `session_start`.

## Limitations

- `systemPrompt` applies to a new session only. The interactive `/batch` host rejects it; the CLI dry-run accepts it.
- Changing the workdir of an existing tab is rejected. Create a tab with the workdir instead.
- A tab-scoped local command listed above runs on a background tab. Any other builtin command is rejected there, because it needs the interactive surface the focused tab owns.

## Trust

Batch scripts run in-process with the same trust level as the interactive agent. They can read files and execute code, so only run scripts you trust.
