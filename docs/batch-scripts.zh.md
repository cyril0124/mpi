# Batch 脚本

Batch 脚本按名称收集 Agent Tab 请求，并从 CLI 或当前 TUI 执行。

## 入口

```text
mpi --batch script.ts -- arg1 "two words"
mpi --batch script.lua --batch-dry-run -- arg1
/batch script.ts -- arg1 "two words"
```

`--batch-dry-run` 只加载和校验脚本，打印计划后退出，不创建 Tab、不发送 Prompt。`--batch` 与 `--batch-dry-run` 需要终端；`--batch` 会打开 TUI 并在启动后应用计划。`/batch` 的相对路径基于当前 Tab 的工作目录解析，焦点在 Home 时使用实例工作目录。

## TypeScript API

脚本默认导出一个函数。`openTab` 支持 `name`、`prompt`、`prompts`、`workdir`、`model`、`thinking`、`contextLimit`、`systemPrompt` 和 `mode`（`append`、`clear`、`delete`）。`prompts` 按顺序执行，空项会跳过。同名请求保持顺序，不同名称的请求并行执行。

`mixcode` API 提供 `args()`、`currentWorkdir()`、`scriptDir()`、`tabExists()`、`listTabs()`、`listModels()`、`resolveModel()` 和 `render()`。

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

Lua 使用同样的行为和 snake_case 名称：`mixcode.open_tab`、`current_workdir`、`script_dir`、`tab_exists`、`list_tabs`、`list_models` 和 `resolve_model`。接口定义见 `mixcode-batch.d.lua`。

## Prompt 分发

Prompt 可以是普通文本、skill 或 template 命令、扩展命令，或 Tab 级本地命令。`/color`、`/name`、`/rename`、`/reset`、`/model`、`/thinking`、`/context-limit`、`/compact` 在拥有该请求的 Tab 上执行。其余输入交给该 Tab 的会话：已注册的扩展命令由会话执行，未匹配的斜杠输入作为消息文本发送。嵌套 `/batch` 会被拒绝。

新 Tab 会先应用请求的模型、思考档位与上下文上限，再绑定扩展；请求的名称在绑定成功后写入。因此 Tab 加载的扩展在 `session_start` 看到的就是请求中的配置。

## 报错

脚本失败时会指出脚本路径和出错行。Lua 报错为 `Lua error in <路径>:<行号>: <信息>`，其后是 `stack traceback:` 和每个 Lua 调用帧，因此在辅助函数里出错时也能看到调用者。TypeScript/JavaScript 运行时报错为 `Batch script error in <路径>: <信息>`，其后是脚本自身的调用栈帧。

`--batch` 在进入交互循环之前加载并校验脚本：此时失败会把信息打印到 stderr 并以 1 退出，坏脚本不会进入交互循环。已加载计划在应用阶段失败时，与之后的其他 batch 失败一样显示为错误提示。`--batch-dry-run` 不启动 TUI，把信息打印到 stderr 并以 1 退出。`/batch` 的失败一律显示为错误提示，因为 TUI 已经在运行。语法错误在触碰任何 Tab 之前就会终止脚本；非法请求也一样，因为计划会先完整加载并校验，再由 TUI 应用。

## 限制

- `systemPrompt` 只对新会话生效。交互式 `/batch` 会拒绝该字段，CLI dry-run 接受。
- 修改已有 Tab 的工作目录会被拒绝；如需其他工作目录，请新建 Tab 时指定。
- 上表列出的 Tab 级本地命令可以在后台 Tab 执行；其他内置命令会被拒绝，因为它们需要当前焦点 Tab 才有的交互界面。

## 信任

Batch 脚本在进程内执行，权限与交互式 Agent 相同。只运行可信脚本。
