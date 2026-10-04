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
| 标签页跳转 | `ctrl+t`，也可用 `/jump` |

`app.tab.previous` 占用了 `shift+tab`，而上游把 `shift+tab` 绑给 `app.thinking.cycle`，因此本 fork 把思考等级循环改到 `alt+t`。见 [上游漂移](upstream-drift.zh.md)。

`app.tab.jump` 占用 `ctrl+t`，上游把该键绑给 `app.thinking.toggle`。后者保留 `ctrl+t` 默认值，但 composer 先注册的是跳转处理器，因此这个键打开 Tab Jump；thinking 开关在 composer 里没有可用按键，除非在 `keybindings.json` 里重新绑定。启动提示不再列出该开关，`/hotkeys` 仍会列出它并注明这个键已被占用。见 [标签页跳转](#标签页跳转) 与 [上游漂移](upstream-drift.zh.md)。

## 命令

| 命令 | 行为 |
| --- | --- |
| `/new-session [--focus\|--no-focus] [title]` | 新建标签页，可选标题。默认聚焦新标签页，`--no-focus` 保持当前标签页聚焦。参数非法时报 `Usage: /new-session [--focus\|--no-focus] [title]`。 |
| `/clone` | 把当前分支复制成一个新标签页，标题为 `<当前标题>-cloned`，并聚焦新标签页。原标签页保留会话文件并保持打开，之后两个标签页各自改动互不影响。 |
| `/close-session [yes]` | 关闭当前标签页，保留会话文件。`yes` 跳过确认。 |
| `/close-all-sessions` | 关闭除当前标签页外的所有标签页，需确认。 |
| `/delete-session [yes]` | 关闭当前标签页并把会话文件移入回收站，可用 `/resume-trash` 还原。`yes` 跳过确认。 |
| `/delete-all-sessions` | 把所有标签页的会话文件移入回收站并重新开始，需确认。 |
| `/resume-trash` | 打开回收站上的会话选择器：把已删除会话还原回原路径，或彻底移除。 |
| `/rename <title>` | 重命名当前标签页及其会话。 |
| `/tabs` | 列出已打开的标签页。 |
| `/tab <index\|title>` | 聚焦指定标签页。 |
| `/jump` | 打开 Tab Jump 切换浮层。带参数时报 `Usage: /jump`。 |
| `/workdir [path]` | 把当前标签页切到另一个工作目录。带路径时立即切换，不带路径时打开目录选择器。见 [工作目录](#工作目录)。 |
| `/context-limit [tokens\|reset]` | 给当前标签页设置独立的上下文窗口上限。不带参数时打开选择器，提供模型窗口的若干比例与自定义输入行。上限仅在本次会话内有效，切换模型、替换会话或重新加载后即失效；见 [输入面板](input-dock.zh.md)。 |
| `/reset` | 把当前标签页会话的叶子退回根节点。会话文件、标题与全部条目保留，被放弃的分支仍在 `/tree` 可达。对话进行中或 bash 运行中拒绝。见 [重置会话](#重置会话)。 |
| `/color [name\|clear]` | 设置当前标签页底色；不带参数或传 `clear` 则清除。 |
| `/group-colored-tabs` | 重排标签页：有颜色的排前面，按调色板顺序聚合。 |
| `/mark-done` | 在标签栏把当前标签页标记为已完成。 |
| `/toggle-zen-mode` | 隐藏当前聚焦标签页的标签块，把这行让给对话区；分隔线保留并汇报其他 agent。开启期间 `tab` 与 `shift+tab` 不再切换。见 [Zen 专注模式](zen-mode.zh.md)。 |
| `/save-workspace <name>` | 把当前标签页布局存成命名工作区。 |
| `/restore-workspace <name>` | 恢复命名工作区，关闭不属于该布局的标签页。 |
| `/delete-workspace <name>` | 删除命名工作区。 |

会话确认框（`/close-session`、`/delete-session` 以及两个 all-sessions 变体）除方向键选择器外，
也可以按 `y` 确认、按 `n` 或 `esc` 取消。

## 标签页跳转

`ctrl+t` 或 `/jump` 会在 composer 上方打开一个可搜索的浮层：MixCode Home 一行，每个打开的标签页一行，按标签页顺序排列，打开时高亮当前聚焦的那个。首行标注查询词并报告命中数（`命中/总数`，过滤器开启时多一个 `non-idle`）。每行带标签栏同款状态字形（Home 留空，它的 chip 也没有字形）、标题（标出过滤词命中的字符）和右对齐的标签 id；尚未就绪的标签页在这里也保持 spinner。

| 按键 | 行为 |
| --- | --- |
| `up` / `ctrl+k` / `shift+tab`（`app.tabJump.selectPrevious`） | 高亮上移，到顶后回到最后一行。 |
| `down` / `ctrl+j` / `tab`（`app.tabJump.selectNext`） | 高亮下移，到底后回到第一行。 |
| 任意可打印字符 | 按标签页标题过滤。 |
| `ctrl+f`（`app.tabJump.toggleNonIdle`） | 只保留有状态需要汇报的标签页 —— 运行中、出错、已完成未读。Home 永不被保留，尚未就绪的标签页还没有可汇报的内容。 |
| `enter`（`tui.select.confirm`） | 跳到高亮项并关闭；若已无可选项，仅关闭浮层。 |
| `esc`（`tui.select.cancel`） | 关闭，不切换。 |
| 指针 | 滚轮移动高亮，指针悬停的行加下划线，左键点击即跳到该行对应的标签页。 |

列表长于面板可显示的行数时围绕高亮截取，并用 `... (N more above)` / `... (N more below)` 标出；id 列在行内容得下时显示完整 id，否则显示前几个字符；超出行宽的行一律以 `...` 结尾。

不启用扩展按键协议的终端会把 `ctrl+j` 和换行符形式的 Enter 报成同一个字节。此浮层把这个字节当作 `ctrl+j`，因此它会移动高亮；回车符形式的 Enter 仍会正常跳转。

编辑器自带的 `/` 命令弹窗打开时该键无效。只要已有其他界面占着键盘 —— 浮层，或占用编辑器位置的 selector（会话树、模型选择、Resume）—— 该键与 chip 点击都不会生效，因此不会出现两层界面叠加。点击已聚焦标签页的 chip 打开的正是这个浮层。[zen 专注模式](zen-mode.zh.md) 下这个浮层就是切换器：`tab` 与 `shift+tab` 不再切换，但 `ctrl+t` 仍能打开它。

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

编辑器上方的标签栏最前面固定一个 `MixCode Home` chip，其后每个 agent 标签页一个 chip：状态字形、标题、颜色。Home chip 没有状态字形；`tab` 与 `shift+tab` 会把它纳入循环，点击它打开 [MixCode Home](home.zh.md)。点击已聚焦标签页的 chip 会打开 [标签页跳转](#标签页跳转)，而不是重复激活它；当其他界面占着键盘时（浮层，或占用编辑器位置的 selector，如会话树），chip 点击会被丢弃，而不会在它背后切换标签页。状态与字形：

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

标题对应它背后的会话：`/rename` 会把该名字写进会话，而把会话换成没有名字的会话（`/new`，或 `/resume` 打开一个没人命名的会话）会把自定义标题退回一个空闲的 `Agent-NN`。本来就是自动生成的标题保留原编号。

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

每个标签的输入框只把消息发给自己的会话，因此某个标签有一轮对话正在运行时，在另一个标签输入的消息仍然在它自己的标签里执行。只有没有标签的会话才会经过输入主循环及其共享队列；该循环一次只处理一个提示，解除阻塞后会把消息投给当时的焦点标签，在多标签下就会投错。

共享同一工作目录的实例每 2 秒轮询 `open_tabs.json`。打开、关闭、重排和替换会话时，只发布相对于上次本地布局的变化，因此尚未看到对端新标签的实例不会把它删除。对端变化复用本地标签操作的队列，不抢编辑器焦点。正在运行或压缩的标签保留到空闲；会话文件尚不可用时，后续轮询重试。

标题、颜色、工作目录和未读标记只合并发生变化的 session 元数据，并由锁保护；未变的本地值不会覆盖对端的新值。命名工作区的读改写也在锁内完成。这些锁协调本 fork 的写入；写同一文件的其他应用也需要遵循相同加锁协议。

启动恢复加入已存布局，不丢弃对端条目。显式恢复工作区会替换共享集合与顺序，其他实例在下一次轮询跟随该布局。`--no-session` 会话不参与共享持久化和轮询。

## 启动恢复

启动时只有满足"起始会话已持久化且不含任何对话轮次"（即全新会话，不是 `-r`/`--continue`）才恢复上次布局。记录中的每个标签页都会恢复，读不出的会话文件跳过；恢复成功后关闭临时的启动标签页——除非它的 id 就在布局里，那时它保留为布局中的那个标签页。标题和颜色从 `mixcode_state.json` 重新应用；默认命名的标签页会重新编号，避免被关掉的启动标签页占掉号段。

布局在任何标签页建好之前就整体出现：tab 栏立刻给每个持久化标签页一个 chip，Home（当前可见界面）也把每个持久化标签页列成卡片，各自带 spinner 与所处阶段。随后按记录的次序逐个构建，同一时刻只有一个 session 在内存里；打开后停在 MixCode Home，上一次聚焦的标签页只是 roster 里的选中项，不会被直接打开。

如果某个标签页的扩展在 `session_start` 里弹出了对话框，它会停在那里而不会构建完成，队列不再等它，直接构建下一个标签页。停住的标签页在 Home 卡片上显示 `waiting for input`，直到对话框被回答后才自行收尾：把重命名写入共享标签集合，并预热其对话记录。恢复失败的标签页标记为 `error`，排在它后面的标签页照常加载。

## 会话删除

`/delete-session`、`/delete-all-sessions` 以及会话选择器都会拒绝删除"所属标签页正在执行一轮对话"的会话文件，并说明原因：可能还有另一个标签页在写它。

## 重置会话

`/reset` 把当前对话退回会话根节点：叶子指针退回所有条目前，下一条消息从新的根开始。会话文件、已写入的条目、标签页与标题都保留，被放弃的分支仍能在 `/tree` 里列出。反方向是 `/new`，它用新文件替换会话。叶子已在根节点时 `/reset` 会提示无事可做；对话进行中或 bash 运行中则拒绝。
