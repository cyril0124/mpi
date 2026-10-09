# 键位

[English Documentation](keybindings.md)

上游的 [Keybindings](../packages/coding-agent/docs/keybindings.md) 页面列出两边共有的
id。本页说明 fork 重新绑定了什么、新增了哪些 id、composer 按键的解析顺序，以及 `Escape` 做什么。
两页不一致时以上游页面为准是错的：上游页面已过期，原因记在 [上游漂移](upstream-drift.zh.md)。

## 重新绑定

覆盖写在 `<agentDir>/keybindings.json`，即 `~/.pi/agent/keybindings.json` 或
`$PI_CODING_AGENT_DIR/keybindings.json`。每个 id 接受一个按键字符串或一组按键：

```json
{
  "app.tab.next": ["tab", "alt+right"],
  "app.thinking.toggle": "ctrl+alt+t"
}
```

- `/reload` 无需重启即可重新读取该文件。
- `/hotkeys` 打印当前生效的常见编辑器与 app 按键，以及扩展注册的快捷键。它是人工挑选的清单，
  不是全量枚举：本页记录的若干 id 并不在其中。
- 两个 id 可以在各自界面不重叠时共用同一个默认键 —— `left` 同时是 `app.home.returnHome` 与
  `app.workdir.parent`。同一界面上两个 id 冲突时由注册顺序决定；下面 `ctrl+t` 与 `ctrl+u` 是两处需要在意的。

## 被重新绑定的 id

| id | 上游默认 | 本 fork | 原因 |
| --- | --- | --- | --- |
| `app.thinking.cycle` | `shift+tab` | `alt+t` | `shift+tab` 用于切换 agent 标签页 |
| `app.model.cycleForward` | `ctrl+p` | 无 | `ctrl+p` 打开命令面板 |
| `app.message.dequeue` | `alt+up`（Windows 与 WSL 为 `alt+q`） | `ctrl+u` | 该动作改为编辑单个队列而不是还原每一条，`ctrl+u` 与这个工作流相配；有排队消息时，该键先于 vim 入口被占用 |

`app.model.cycleForward` 失去默认键后，回退到上一个模型仍由 `app.model.cycleBackward` 承担
（`shift+ctrl+p`，Windows 与 WSL 为 `alt+p`）。

## 本 fork 新增的 id

以下都按界面生效，同一个键可以在不同界面各出现一次。

| id | 默认 | 界面 |
| --- | --- | --- |
| `app.quit` | `ctrl+q`（Windows 与 WSL 为 `ctrl+shift+q`） | 退出，先询问 —— 见 [命令面板](command-palette.zh.md) |
| `app.palette` | `ctrl+p` | 命令面板 |
| `app.notice.copy` | `c`、`y` | 输入框为空时复制控制台 Notice 文本 —— 见 [控制台历史](console-history.zh.md) |
| `app.notice.dismiss` | `escape`、`q` | 关闭控制台 Notice |
| `app.tab.next` | `tab`、`ctrl+shift+right` | 下一个 agent 标签页 —— 见 [Agent 标签页](tabs.zh.md) |
| `app.tab.previous` | `shift+tab`、`ctrl+shift+left` | 上一个 agent 标签页 |
| `app.tab.new` | 无 | 新建 agent 标签页 |
| `app.tab.close` | 无 | 关闭当前 agent 标签页 |
| `app.tab.jump` | `ctrl+t` | Tab Jump 浮层 |
| `app.tabJump.selectPrevious` | `up`、`ctrl+k`、`shift+tab` | Tab Jump：上移高亮 |
| `app.tabJump.selectNext` | `down`、`ctrl+j`、`tab` | Tab Jump：下移高亮 |
| `app.tabJump.toggleNonIdle` | `ctrl+f` | Tab Jump：只显示有内容的标签页 |
| `app.home.returnHome` | `left` | 输入框为空时回到 MixCode Home —— 见 [MixCode Home](home.zh.md) |
| `app.home.selectPrevious` | `up` | Home：上一个 agent |
| `app.home.selectNext` | `down` | Home：下一个 agent |
| `app.home.attach` | `right` | Home：接入高亮的 agent |
| `app.home.send` | `enter` | Home：把输入框内容发给高亮的 agent |
| `app.home.toggleNonIdle` | `ctrl+f` | Home：非空闲过滤 |
| `app.widgets.panel` | `right` | 输入框为空时切换挂件侧栏 —— 见 [组件布局](widget-layout.zh.md) |
| `app.workdir.parent` | `left` | 工作目录选择器：回到上级目录 |
| `app.workdir.enterDir` | `tab` | 工作目录选择器：进入高亮目录 |
| `app.workdir.toggleHidden` | `ctrl+h` | 工作目录选择器：显示或隐藏点目录 |
| `app.workdir.clearQuery` | `ctrl+u` | 工作目录选择器：清空过滤词 |
| `app.queueEdit.steer` | `s`、`shift+s` | 已武装的队列选择：把排队的消息改为 steer |
| `app.queueEdit.followUp` | `f`、`shift+f` | 已武装的队列选择：仍作为 follow-up |
| `app.queueEdit.cancel` | `escape` | 已武装的队列选择：取消 |
| `app.vim.enter` | `ctrl+u` | vim 模式：无排队消息时武装进入（输入框有草稿也可以），限 fullscreen 模式下的 agent 标签页 —— 见 [Vim 模式](vim-mode.zh.md) |
| `app.vim.enterConfirm` | `u` | vim 模式：武装后确认进入 |
| `app.vim.exit` | `q` | vim 模式：离开模态对话区 |
| `app.vim.lineUp` | `k`、`up` | vim 模式：向更早的输出滚动 3 行 |
| `app.vim.lineDown` | `j`、`down` | vim 模式：向更新的输出滚动 3 行 |
| `app.vim.pageUp` | `pageUp`、`ctrl+u` | vim 模式：向更早的输出滚动 10 行 |
| `app.vim.pageDown` | `pageDown`、`ctrl+d` | vim 模式：向更新的输出滚动 10 行 |
| `app.vim.top` | `home` | vim 模式：最早的输出 |
| `app.vim.topPrefix` | `g` | vim 模式：连按两次到最早的输出 |
| `app.vim.bottom` | `end`、`shift+g` | vim 模式：最新的输出 |
| `app.vim.nextUserMessage` | `right` | vim 模式：下一条用户消息 |
| `app.vim.previousUserMessage` | `shift+right` | vim 模式：上一条用户消息 |

有两个默认键与上游某个 id 同键，它们靠注册顺序而不是冲突解决：`ctrl+t` 在这里是
`app.tab.jump`，而 `app.thinking.toggle` 自己也默认 `ctrl+t`；`ctrl+u` 是 `app.message.dequeue`，
而 `tui.editor.deleteToLineStart` 自己也默认 `ctrl+u`。两种情况下 fork 都先注册自己的处理器，
所以按键落到 fork 的动作上，上游那个动作需要重新绑定；`/hotkeys` 会同时打印两者的按键，并把
`app.thinking.toggle` 标为被 Tab Jump 占用。

## 按键解析顺序

顺序固定在 composer 的输入处理里，只有第一个命中的分支会执行：

```text
来自终端的按键
  │
  ├─ vim 模式处于活动？ ─────► vim 模式独占，但放行六个动作（标签页、
  │                            Tab Jump、工具展开、thinking 开关、退出）；
  │                            其余被吞掉
  ├─ 队列为空 + ctrl+u？ ────► 武装 vim 入口（仅限 fullscreen 下的 agent
  │                            标签页；有排队消息时拒绝）
  ├─ 空输入框 + right？ ─────► 挂件侧栏
  ├─ 队列选择已武装？ ───────► s / f / escape
  ├─ 扩展快捷键？ ───────────► 扩展的处理器
  ├─ 粘贴图片键？ ───────────► 剪贴板粘贴
  ├─ escape？ ───────────────► 下面的 Escape 分派（自动补全弹窗
  │                            打开时拒绝）
  ├─ 空输入框 + ctrl+d？ ────► 退出
  ├─ 自动补全弹窗打开时的
  │  tab / shift+tab ────────► 交给编辑器
  ├─ 历史绑定？ ─────────────► 编辑器自身的历史
  ├─ 其它 app id？ ──────────► 它的处理器；返回 false 表示拒绝，
  │                            继续试下一个 id
  └─ 其余 ───────────────────► 编辑器
```

扩展快捷键排在 vim 模式、vim 入口武装、挂件侧栏和已武装的队列选择之后，所以这几项都不会被扩展抢走；
它排在其它所有 app id 之前。

## Escape

`Escape` 按固定顺序逐条判断，命中第一条就停止：

1. 屏幕上显示的是 MixCode Home：什么也不做。Home 是导航界面，输入框也是临时的，`Escape` 不会落到它背后的标签页；
   要中断那一轮就在它自己的标签页上按，离开 Home 则用选中行上的 `→` 或 `tab`。
2. 屏幕上显示的标签页正在压缩或正在生成分支摘要：取消它，正在压缩或正在总结的状态行也是这么提示的。发生在别的
   标签页上时不动它，切到那个标签页再取消。
3. 屏幕上显示的标签页正在自动重试：取消该重试，正在重试的状态行也是这么提示的。重试发生在别的标签页上时不动它，
   切到那个标签页再取消。
4. 队列里有 steer 消息：中止本次运行，并把 steer 队列作为一轮立即发出。follow-up 轮次不会这样被提升。
5. 会话正在流式输出：第一次 `Escape` 只武装 1 秒的确认窗口并提示；窗口内再按一次 `Escape` 才会中止运行，
   超出窗口则重新武装。若这一轮还没有产生任何可读内容（没有 assistant 文本、没有 thinking、没有工具调用，
   也没有扩展气泡或渲染出来的 custom 条目），且输入框为空、没有排队中的 follow-up 轮次，则改为回撤：
   会话分支的 leaf 回到本轮自己的用户消息之前，消息文本回到输入框，发送过早的提示可以修改后再发。
   其余情况照旧中止运行：排队中的 steer 文本回到输入框，排队中的 follow-up 轮次留在队列里并处于暂停状态。
6. bash 命令正在运行：中止该 bash 命令。
7. 输入框处于 `!` bash 模式：清空输入框并退出 bash 模式。
8. 输入框为空：500 ms 内再按一次 `Escape`，按 `doubleEscapeAction` 的取值打开会话树或 fork 选择器；
   取 `none` 时关闭该行为。

夺取焦点的浮层会先消费按键，composer 根本看不到它。确认窗口属于本轮运行：运行开始、运行结束、切换活动标签页，
以及压缩或自动重试接管该键时都会被清除。vim 模式活动时由它自己的按键表取代上面这套 —— `q` 离开。
