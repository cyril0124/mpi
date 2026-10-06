# 控制台历史

[English Documentation](console-history.md)

交互模式自己绘制终端、把帧写到 stdout。扩展代码调用 `console.log`、`console.warn` 等控制台方法时，会向同一个终端写原始文本，破坏画面并重复出现标签栏。因此只改写这五个方法：输出按 Node 控制台的格式格式化，加上 `[console.<method>]:` 前缀，画进输入框上方的 Notice 弹窗。`console.group`、`console.table`、`console.count`、`console.time*`、`console.assert`、`console.trace` 仍会走到桥接，因为 Node 在 `log`、`warn`、`error` 之上实现它们；`console.dir` 与不输出内容的辅助方法保持原生。

桥接在交互模式启动的最开始安装，早于 runtime 加载任何扩展，所以扩展的第一行日志也会被捕获。TUI 出现之前产生的行先排队，TUI 启动后按顺序进入弹窗；如果进程在此之前结束（例如启动报错），排队的行会写到它们原本应到达的输出流。

只有交互模式会安装桥接。`-p`、RPC、`--help`、`--list-models`、`--export` 等命令行路径保持普通的控制台输出。未被 TUI 捕获的崩溃会在 TUI 拆除后把报告直接写到 stderr，因此即使其他地方的 `console.error` 已被桥接，报告仍能在终端中看到。

## `/console-history`

有可用编辑器时，捕获到的行会交给外部编辑器打开：

- 候选顺序：`externalEditor` 设置（项目作用域优先，其次全局）、`$VISUAL`、`$EDITOR`、`nvim`、`vim`。每个候选都要在一秒内响应 `--version`，所以失效的路径或卡住等待输入的包装脚本会被跳过。配置的编辑器探测失败时不会再回退到 `nvim`/`vim`，避免用户的明确设置被忽略。
- 编辑器接管终端期间 TUI 让出，退出后恢复。文本只是交给它阅读：编辑器写回的内容会被丢弃。
- 所有候选都不可用时，改为把记录打印成对话记录块。

| 命令 | 行为 |
| --- | --- |
| `/console-history` | 用外部编辑器打开本进程捕获的行，按时间从早到晚，每行格式为 `YYYY-MM-DD HH:MM:SS [<标签页>] <内容>`；没有可用编辑器时改为对话记录块。带任何参数时报 `Error: Usage: /console-history`。 |

交互进程保留最近 1000 行，每行带有产生时间，以及（当某标签页的工作产生该行时）该标签页的标题。历史只存在于内存中：重启 MixCode 即清空。还没有任何记录时报 `No console history in this process.`

跨多行的消息算一条记录，其中的换行原样保留，所以多行诊断信息保持原有排版。

## 标签页标记

标记来自产生该行时正在工作的标签页：agent 回合、扩展命令或 shell 命令。不属于任何标签页的工作（启动过程、扩展定时器）不带标记，该行只显示时间戳。两个标签页同时工作时各自保留自己的标记，即使用户在两者运行期间切到第三个标签页。

## Notice 弹窗

被改写的行进入同一个弹窗，位置在输入框上方、水平居中：

- 它浮在画面之上且不抢焦点，所以弹窗在时输入框仍能正常输入。
- 同一批连续的行会继续加进同一个弹窗；关掉之后再有人写日志，就新开一个。
- 超长的行折行而不是截断，弹窗最高长到终端高度的约 60%：更早的行被丢掉，替换为一行灰字 `(N earlier lines hidden · c/y copy all)`。
- `c` 或 `y`（`app.notice.copy`）复制弹窗全文；`Esc` 或 `q`（`app.notice.dismiss`）关闭。当有回合或 bash 命令正在跑时，`Esc` 归该运行所有（运行中第一次按下只武装确认窗口，见[按键绑定](keybindings.zh.md#escape)），弹窗留到下一次 `Esc`。
- 两个按键都是本 fork 的普通按键绑定，可以在 `keybindings.json` 里改。

弹窗只是临时显示，不存记录；`/console-history` 才是捕获内容的清单。
