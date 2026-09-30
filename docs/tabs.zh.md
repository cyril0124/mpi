# Agent 标签页

[English Documentation](tabs.md)

一个终端里并行运行多个 agent。每个标签页拥有自己的会话和自己的 `AgentSessionRuntime`，所以一个标签页在流式输出时，另一个可以完全空闲。上游只有一个 runtime host，想同时看 N 个 agent 就得开 N 个终端。

## 键位

| 动作 | 按键 |
| --- | --- |
| 下一个标签页 | `tab`、`ctrl+shift+right`（当前 agent 处于 [zen 专注模式](zen-mode.zh.md) 时不生效） |
| 上一个标签页 | `shift+tab`、`ctrl+shift+left`（同样例外） |
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
| `/workdir [path]` | 把当前标签页切到另一个工作目录。带路径时立即切换，不带路径时打开目录选择器。见 [工作目录](#工作目录)。 |
| `/color [name\|clear]` | 设置当前标签页底色；不带参数或传 `clear` 则清除。 |
| `/group-colored-tabs` | 重排标签页：有颜色的排前面，按调色板顺序聚合。 |
| `/mark-done` | 在标签栏把当前标签页标记为已完成。 |
| `/toggle-zen-mode` | 隐藏当前聚焦标签页的标签块，把这行让给对话区；分隔线保留并汇报其他 agent。开启期间 `tab` 与 `shift+tab` 不再切换。见 [Zen 专注模式](zen-mode.zh.md)。 |
| `/save-workspace <name>` | 把当前标签页布局存成命名工作区。 |
| `/restore-workspace <name>` | 恢复命名工作区，关闭不属于该布局的标签页。 |
| `/delete-workspace <name>` | 删除命名工作区。 |

会话确认框（`/close-session`、`/delete-session` 以及两个 all-sessions 变体）除方向键选择器外，
也可以按 `y` 确认、按 `n` 或 `esc` 取消。

## 工作目录

`/workdir <path>` 把当前标签页切到另一个工作目录。会话本身继续运行：对话记录不变，agent 的
与 cwd 绑定的服务在新目录下重建，会话头也记录新目录，因此之后恢复该会话会从同一位置开始。相对
路径按标签页当前工作目录解析，开头的 `~` 展开为家目录。切到标签页当前所在的目录会提示
`workdir unchanged` 并什么都不做；路径不是已存在的目录时报
`Error: workdir not found or not a directory: <path>`。

不带路径的 `/workdir` 打开选择器，也就是 meta 行上的工作目录徽标所打开的那个界面。它只浏览
目录，不列文件：

| 按键 | 行为 |
| --- | --- |
| `up` / `down` | 在列出的目录间移动高亮。 |
| `left`（`app.workdir.parent`） | 回到上级目录，并高亮刚离开的那个。位于 `/` 时无效。 |
| `tab`（`app.workdir.enterDir`） | 进入高亮的目录。 |
| `enter`（`tui.select.confirm`） | 应用当前正在浏览的目录 —— 而不是高亮的那一行。 |
| `ctrl+h`（`app.workdir.toggleHidden`） | 显示或隐藏点开头的目录。 |
| `ctrl+u`（`app.workdir.clearQuery`） | 清空过滤词。 |
| `esc`（`tui.select.cancel`） | 关闭选择器，不做任何切换。 |
| 任意可打印字符 | 按目录名做大小写不敏感的子串过滤。含 `/` 或以 `~` 开头的过滤词会变成单独的 `custom path` 行，回车即应用该路径。 |

面板第一行把正在浏览的目录显示为家目录折叠的面包屑，最后一行给出目录数量与按键说明，超过窗口
的列表用 `... (N more above)` / `... (N more below)` 标出。切换只作用于发起它的那个标签页，
其他标签页保持各自的工作目录。

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

当前标签页的标题上有一道高亮波：2 秒内扫到右端再折返，随后标题静止 1 秒，再开始下一轮。波在折返处减速，chip 自身的背景、前景和焦点标记保持不变；有颜色的 chip 以反色点亮，因为主题前景色在 chip 颜色上没有对比度。

聚焦的 agent 处于 [zen 专注模式](zen-mode.zh.md) 时，标签栏不渲染任何 chip。只保留一行分隔线，其上每个未聚焦标签页只要处于运行中、已完成或出错就画一个圆点，因此其他 agent 依然可见，而标签块占用的那一行还给了对话区。

## 颜色

`/color <name>` 接受 `red`、`green`、`yellow`、`blue`、`magenta`、`cyan`、`white`、`gray` 或 `clear`。颜色按 session id 存在 `tab_colors` 里，因此重启后保留；`/clear` 会生成新的会话文件，颜色随之丢失。调色板里已不存在的颜色名在读取状态文件时被忽略。`/group-colored-tabs` 按调色板顺序重排标签页并持久化新顺序。

## 标题

未指定标题的标签页命名为 `Agent-01`、`Agent-02`……跳过已被占用的标题。标题已存在时追加 `-1`、`-2`……，并把去重后的名字持久化。

## 持久化

标签页状态按工作目录存放，目录与 mixcode-pi（`mpi`）共用：

```text
<agentDir>/mixcode-pi/workdirs/<sha16(workdir)>/
  open_tabs.json      { version, sessionIds, updatedAt }   打开的集合与顺序（成员权威来源）
  mixcode_state.json  { children, workdirs, tab_titles, tab_colors, startup_workdir, unseen_done }
  workspaces.json     命名布局
```

`<agentDir>` 是 `PI_CODING_AGENT_DIR` 或 `~/.pi/agent`。工作目录的哈希算法与 mixcode-pi 一致，所以两者共用一个目录：在其中一个里打开的标签页，另一个也能看到。

标签页集合、顺序、标题、颜色发生变化时写这两个文件，进程退出时再写一次；切换焦点不会写。

保存的工作区包含 `name`、`startup_workdir`、`updated_at`、`active_session_id`，以及每个标签页一项（`session_id`、`session_path`、`title`、`workdir`、`model`、`thinking_level`）。

## 并发访问

共享同一工作目录的实例每 2 秒轮询 `open_tabs.json`。打开、关闭、重排和替换会话时，只发布相对于上次本地布局的变化，因此尚未看到对端新标签的实例不会把它删除。对端变化复用本地标签操作的队列，不抢编辑器焦点。正在运行或压缩的标签保留到空闲；会话文件尚不可用时，后续轮询重试。

标题、颜色、工作目录和未读标记只合并发生变化的 session 元数据，并由锁保护；未变的本地值不会覆盖对端的新值。命名工作区的读改写也在锁内完成。这些锁协调本 fork 的写入；写同一文件的其他应用也需要遵循相同加锁协议。

启动恢复加入已存布局，不丢弃对端条目。显式恢复工作区会替换共享集合与顺序，其他实例在下一次轮询跟随该布局。`--no-session` 会话不参与共享持久化和轮询。

## 启动恢复

启动时只有满足"起始会话已持久化且不含任何对话轮次"（即全新会话，不是 `-r`/`--continue`）才恢复上次布局。最多恢复 12 个标签页（`RESTORE_TAB_LIMIT`），超出的部分会提示而不是静默丢弃；读不出的会话文件跳过；恢复成功后关闭临时的启动标签页。标题和颜色从 `mixcode_state.json` 重新应用；默认命名的标签页会重新编号，避免被关掉的启动标签页占掉号段。

布局会在任何一个标签页建好之前就列进 tab 栏：每个持久化的标签页立刻有一个 chip，在自己的标签页就绪前显示旋转的 spinner。随后按记录的次序逐个构建，同一时刻只有一个 session 在内存里；打开后停在 MixCode Home，上一次聚焦的标签页只是 roster 里的选中项，不会被直接打开。

## 会话删除

`/delete-session`、`/delete-all-sessions` 以及会话选择器都会拒绝删除"所属标签页正在执行一轮对话"的会话文件，并说明原因：可能还有另一个标签页在写它。
