# Agent 标签页

[English Documentation](tabs.md)

一个终端里并行运行多个 agent。每个标签页拥有自己的会话和自己的 `AgentSessionRuntime`，所以一个标签页在流式输出时，另一个可以完全空闲。上游只有一个 runtime host，想同时看 N 个 agent 就得开 N 个终端。

## 键位

| 动作 | 按键 |
| --- | --- |
| 下一个标签页 | `tab`、`ctrl+shift+right` |
| 上一个标签页 | `shift+tab`、`ctrl+shift+left` |
| 新建标签页 | 无 —— 用 `/new-session` |
| 关闭标签页 | 无 —— 用 `/close-session` |

`app.tab.previous` 占用了 `shift+tab`，而上游把 `shift+tab` 绑给 `app.thinking.cycle`，因此本 fork 把思考等级循环改到 `alt+t`。见 [上游漂移](upstream-drift.zh.md)。

## 命令

| 命令 | 行为 |
| --- | --- |
| `/new-session [--focus\|--no-focus] [title]` | 新建标签页，可选标题。默认聚焦新标签页，`--no-focus` 保持当前标签页聚焦。参数非法时报 `Usage: /new-session [--focus\|--no-focus] [title]`。 |
| `/close-session [yes]` | 关闭当前标签页，保留会话文件。`yes` 跳过确认。 |
| `/close-all-sessions` | 关闭除当前标签页外的所有标签页，需确认。 |
| `/delete-session [yes]` | 关闭当前标签页并删除其会话文件。`yes` 跳过确认。 |
| `/delete-all-sessions` | 删除所有标签页的会话文件并重新开始，需确认。 |
| `/rename <title>` | 重命名当前标签页及其会话。 |
| `/tabs` | 列出已打开的标签页。 |
| `/tab <index\|title>` | 聚焦指定标签页。 |
| `/color [name\|clear]` | 设置当前标签页底色；不带参数或传 `clear` 则清除。 |
| `/group-colored-tabs` | 重排标签页：有颜色的排前面，按调色板顺序聚合。 |
| `/mark-done` | 在标签栏把当前标签页标记为已完成。 |
| `/save-workspace <name>` | 把当前标签页布局存成命名工作区。 |
| `/restore-workspace <name>` | 恢复命名工作区，关闭不属于该布局的标签页。 |
| `/delete-workspace <name>` | 删除命名工作区。 |

## 标签栏

编辑器上方的标签栏最前面固定一个 `MixCode Home` chip，其后每个 agent 标签页一个 chip：状态字形、标题、颜色。Home chip 没有状态字形；`tab` 与 `shift+tab` 会把它纳入循环，点击它打开 [MixCode Home](home.zh.md)。状态与字形：

| 状态 | 字形 | 含义 |
| --- | --- | --- |
| `idle` | `-` | 已打开，未工作 |
| `running` | `●` | 正在流式输出 |
| `thinking` | `●` | 输出前正在推理，字形与 running 相同 |
| `error` | `x` | 上一轮失败 |
| `done` | `✓` | 已标记完成，或有未读输出 |

字形颜色取自主题：`error` 用错误色，未读标签页用成功色，`running`/`thinking` 用强调色。完成或未读的标签页保持强调（标题加粗），直到被聚焦。当前标签页带前置焦点标记 `▌`，有颜色时用 `▐`。

## 颜色

`/color <name>` 接受 `red`、`green`、`yellow`、`blue`、`magenta`、`cyan`、`white`、`gray` 或 `clear`。颜色按 session id 存在 `tab_colors` 里，因此重启后保留；`/clear` 会生成新的会话文件，颜色随之丢失。调色板里已不存在的颜色名在读取状态文件时被忽略。`/group-colored-tabs` 按调色板顺序重排标签页并持久化新顺序。

## 标题

未指定标题的标签页命名为 `Agent-01`、`Agent-02`……跳过已被占用的标题。标题已存在时追加 `-1`、`-2`……，并把去重后的名字持久化。

## 持久化

标签页状态按工作目录存放，目录与 mixcode-pi（`mpi`）共用：

```text
<agentDir>/mixcode-pi/workdirs/<sha16(workdir)>/
  open_tabs.json      { version, sessionIds, updatedAt }   打开的集合与顺序
  mixcode_state.json  { children, workdirs, tab_titles, tab_colors, startup_workdir, unseen_done }
  workspaces.json     命名布局
```

`<agentDir>` 是 `PI_CODING_AGENT_DIR` 或 `~/.pi/agent`。工作目录的哈希算法与 mixcode-pi 一致，所以两者共用一个目录：在其中一个里打开的标签页，另一个也能看到。

保存的工作区包含 `name`、`startup_workdir`、`updated_at`、`active_session_id`，以及每个标签页一项（`session_id`、`session_path`、`title`、`workdir`、`model`、`thinking_level`）。

## 启动恢复

启动时只有满足"起始会话已持久化且不含任何对话轮次"（即全新会话，不是 `-r`/`--continue`）才恢复上次布局。最多恢复 12 个标签页（`RESTORE_TAB_LIMIT`），超出的部分会提示而不是静默丢弃；读不出的会话文件跳过；恢复成功后关闭临时的启动标签页。标题和颜色从 `mixcode_state.json` 重新应用；默认命名的标签页会重新编号，避免被关掉的启动标签页占掉号段。

## 会话删除

`/delete-session`、`/delete-all-sessions` 以及会话选择器都会拒绝删除"所属标签页正在执行一轮对话"的会话文件，并说明原因：可能还有另一个标签页在写它。
