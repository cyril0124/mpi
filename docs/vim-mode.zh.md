# 独立 Vim 模式

[English Documentation](vim-mode.md)

Vim 模式把全屏对话区变成一块模态的免鼠标阅读界面：主行滚动、翻页，以及按用户提问跳跃。

## 前提

Vim 模式驱动的是应用内的对话视口，只有**全屏模式**（默认的 TUI 模式）才有这个视口。普通模式下对话直接进终端回滚缓冲，没有
可滚动的视口，因此 `/vim` 会说明该前提并保持关闭。要退出全屏，在 `/settings` 的 `tuiMode` 里选 regular，或把设置文件里的
`"tuiMode"` 写成 `"regular"`。

## 进入与退出

| 进入方式 | 操作 |
| --- | --- |
| 命令 | `/vim` |
| 键盘 | 输入框为空且无排队消息时按 `ctrl+u`，再在一秒内按 `u` 或 `ctrl+u`（会话正在工作时也可） |
| 退出 | `q` |

键盘进入会开启一秒的确认窗口；按其它键即取消。进入的前提是输入框为空且无排队消息；会话正在工作时
也可以进入，此时正需要阅读界面来看正在到达的输出。否则 `ctrl+u` 交给它的其它绑定（有排队消息时用来编辑队列）。

Vim 模式开启期间输入框被锁定：边框改用强调色、忽略键入、拒绝提交。编辑器上下的扩展挂件不再
渲染，这些行让给对话区；挂件的注册与生命周期不受影响。

## 按键

下表每一项都是可配置动作，可在 `keybindings.json` 中按动作名改写。

| 动作 | 默认键 | 效果 |
| --- | --- | --- |
| `app.vim.lineUp` | `k`、`up` | 向更早的输出滚动 3 行 |
| `app.vim.lineDown` | `j`、`down` | 向更新的输出滚动 3 行 |
| `app.vim.pageUp` | `pageUp`、`ctrl+u` | 向更早的输出翻一页 |
| `app.vim.pageDown` | `pageDown`、`ctrl+d` | 向更新的输出翻一页 |
| `app.vim.top` | `home` | 跳到最早一行 |
| `app.vim.topPrefix` | `g` | 按两次（`gg`）跳到最早一行 |
| `app.vim.bottom` | `end`、`shift+g` | 跳到最新一行并跟随新输出 |
| `app.vim.nextUserMessage` | `right` | 跳到下一条用户消息；已是最后一条时跳到最新输出 |
| `app.vim.previousUserMessage` | `shift+right` | 跳到上一条用户消息 |
| `app.vim.exit` | `q` | 退出 Vim 模式 |
| `app.vim.enter` | `ctrl+u` | 空输入框下预备进入 |
| `app.vim.enterConfirm` | `u` | 确认预备进入 |

Vim 模式是模态的：上表之外的键一律被吞掉，不会进入编辑器。`tab` / `shift+tab`（切换标签页）、
`ctrl+o`（展开工具输出）、`ctrl+t`（thinking 块）仍然有效。Vim 模式下双击 `Esc` 不再打开会话树
或 fork；唯一的退出方式是 `q`。

## 多标签页行为

Vim 模式按标签页保存并随焦点转移：开启状态下切换标签页，模态状态交给新聚焦的标签页，原标签页被
清除。同一时刻至多一个标签页处于 Vim 模式。

MixCode Home 既不是标签页也不是对话记录，进入时即退出 Vim 模式。那里的输入框属于名册选中的
agent，继续留在模态界面会吞掉它的按键。

## 反馈

进入提示、跳跃与拒绝都会以短暂的 flash 行显示在对话区。目标不在当前对话中时会提示
`No older user message` 或 `Newest output`，而不是静默失败。
