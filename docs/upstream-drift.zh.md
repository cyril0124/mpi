# 上游漂移

[English Documentation](upstream-drift.md)

本 fork 与上游 pi 存在分歧的地方。上游页面**不做修改** —— 那会在每次合并上游时产生冲突 —— 所以分歧记录在这里，并与造成分歧的改动放在同一个 commit。

## 行为差异

| 方面 | 上游 | 本 fork | 原因 |
| --- | --- | --- | --- |
| `install.sh` | 通过 `scripts/build-binaries.sh` 构建发布归档 | 在 `<prefix>/lib/<name>/` 安装 standalone 运行时，并在 `<prefix>/bin/<name>` 安装包装脚本；`<name>` 默认为 `mpi`，也可通过 `--name` 或 `MIXCODE_INSTALL_NAME` 设置 | 单机安装可以使用自定义命令名，同时保持运行时目录与包装脚本名称一致 |
| 内置主题发现 | `getBuiltinThemes()` 按名字读取 `dark.json` 与 `light.json`，丢进主题目录的 JSON 不会被发现；主题选择器只列出它们与用户主题 | 主题目录下每个 `*.json` 都会被加载，并以文件内的 `name` 作为键（跳过 `theme-schema.json`）；某个文件解析或校验失败时只是被丢弃，不会带掉其余内置主题。`aurora` 即由此提供 | 一个主题一个文件，新增主题就是新增文件，无需改动加载器 |
| `app.thinking.cycle` 默认键 | `shift+tab` | `alt+t` | `shift+tab` 改作 `app.tab.previous` |
| Agent 标签页 | 一个终端一个会话 | 多个并发标签页，各自持有 `AgentSessionRuntime` | [Agent 标签页](tabs.zh.md) |
| `/fork` 消息选择 | 替换当前会话 | 在原标签页后创建独立标签页，标题追加 `-fork` 并自动去重，输入框填入所选消息 | 原对话与新分支可以并排保留 |
| 会话删除 | 直接删除所选会话文件 | 所属标签页有对话进行中时拒绝 | 可能还有另一个标签页在写该文件 |
| `app.model.cycleForward` 默认键 | `ctrl+p` | 无默认键 | `ctrl+p` 改作打开命令面板 |
| `app.tab.jump` 默认键 | 无此动作；`ctrl+t` 切换 thinking 块显示 | `ctrl+t` 打开 Tab Jump 切换浮层，`app.thinking.toggle` 保留 `ctrl+t` 默认值但在 composer 中按注册顺序把该键让给跳转 | 有多个 agent 时应当直接跳过去，而不是逐个循环；见 [Agent 标签页](tabs.zh.md#标签页跳转) |
| 退出 | `ctrl+d` 直接退出，不询问 | `ctrl+q`（Windows 与 WSL 为 `ctrl+shift+q`）先询问；`ctrl+d` 不变 | [命令面板与退出确认](command-palette.zh.md) |
| 全屏对话区渲染 | 每帧渲染全部消息组件再裁剪到视口 | 只渲染可见窗口（上下各 20 行余量），未测块按 4 行估算 | 否则帧开销随整段对话增长 |
| 对话区滚动键 | 仅 `tui.altScreen.*` | 全屏模式下另有模态界面（`/vim`、`j`/`k`/`gg`/`G`、提问跳转） | 长对话免鼠标阅读 |
| 默认 TUI 模式 | `regular` | `fullscreen`；`settings.json` 里显式写 `tuiMode: "regular"` 仍会回到普通对话区 | 本 fork 的阅读功能（窗口化对话区、Vim、鼠标选中）只存在于备选屏幕；上游 `packages/coding-agent/docs/settings.md` 的默认值仍写作 `"regular"` |
| 模态下的输入框边框 | thinking/bash 边框色 | 强调色边框，输入与提交被锁定 | Vim 模式独占输入 |
| Zen 专注模式 | 无此模式；上游没有可隐藏的标签栏 | `/toggle-zen-mode` 去掉标签块，只留分隔线继续显示其他 agent 的状态圆点；agent 标签页处于 zen 时 `tab`/`shift+tab` 不再切换标签页 | 标签块占用的那一行要让给对话区，而标签栏仍需汇报其他 agent 的动向；见 [Zen 专注模式](zen-mode.zh.md) |
| 扩展组件 | 固定在编辑器上/下方的坞区 | 默认放在对话流末尾，带行预算与 `/widgets`，因为 [`ui.inlineWidgets`](inline-widgets.zh.md) 默认开启 | 过高的组件否则会占用整个编辑器坞区的行 |
| 按标签页的设置项 | 无 | `Inline widgets` 读写 `mixcode_settings.json`，在 `/settings` 的 `MixCode` 分组中单独展示 | MixCode 的设置不写进 pi 的 `settings.json`，也不混进它的分组 |
| 设置列表行 | 单一平铺列表 | `SettingItem` 新增可选 `section`，渲染为分组标题行 | 同上 |
| `/settings` 面板 | 上游 `SettingsList` 放在带边框的 selector 里并替换编辑器区域：`→` 光标、搜索输入框、原始的 `true`/`false` 取值、平直的分组标题 | 居中浮层面板，标题为 `Settings`：surface 背景的列表配一条暗色 `filter: type to filter  N/N` 行，每个配置文件上方是 `Pi` / `MixCode` 标题加该文件路径，`›` 行分为标签列与取值列，布尔值显示为 `On`/`Off`，选中项下方显示其说明，底部一行按键提示 | 面板因此像浮在工作内容之上的一层表面，并直接说明某项设置存在哪个文件里；打开面板时输入框保留草稿。选择 `TUI mode` 会先收起面板再切换，因为浮层打开时模式切换会被拒绝 |
| Follow-up 输入（`alt+enter`） | 排入 SDK follow-up 队列，由 agent 在运行结束后投递 | 改为宿主侧的轮次：`/follow-up <message>` 产生独占轮次，`alt+enter` 与 `/follow-up --batch <message>` 产生合并轮次，空闲时每轮投递一次，失败时暂停直到 `/follow-up` 恢复 | follow-up 轮次需要暂停/恢复、批量合并，以及可排队的本地命令 |
| 手动压缩模型 | `/compact` 只接受自定义指令并使用当前模型 | `/compact [provider/modelId] [instructions]` 仅为摘要请求使用指定模型，会话模型与 thinking 等级保持不变，并在工作状态中显示指定模型；压缩原因分别使用 accent/warning/error 颜色 | 手动摘要有时需要使用另一个模型，临时状态需要区分手动、阈值和溢出压缩 |
| 排队消息显示 | 对话区下方的平铺 `Steering:`/`Follow-up:` 行 | 带边框的 `Steer (n)`/`Follow-up (n)` 预览，含轮次编号（`Round k · next/command ·`）、`SDK ·` 伴随标记、只显示最近五条、暂停提示，以及 `Esc->send now`/编辑提示 | 队列现在是有序轮次列表，而不是文本堆 |
| Esc 时有排队的 steer 文本 | 把每一条排队消息还原到输入框并中止 | 中止，然后把 steer 队列作为一次立即轮次发送；follow-up 轮次保持排队（暂停） | `Esc->send now` 不应把 follow-up 轮次一并发出 |
| `AgentSession`/`Agent` 队列 API | 只有 `clearQueue()`/`clearAllQueues()` | 新增 `removeQueuedMessages(kind, texts)`/`restoreQueuedMessages(kind, removed)`：从镜像与待发队列中按精确文本出队（最后匹配优先），返回按队列顺序排列的条目供还原 | flush 与 pop 需要移除指定文本，而不是整个队列 |
| 出队键（`app.message.dequeue`） | `alt+up`（Windows 与 WSL 为 `alt+q`）；把每一条排队消息还原到输入框；编辑器保留 `ctrl+u` 做删除到行首 | `ctrl+u`，与空输入框的 vim 入口共用（排队消息先占用该键，队列为空时落入 vim 入口），在 agent 标签页上无论如何都会被消费，因此不再到达编辑器；两个队列都有内容时 `ctrl+u` 后按 `s`/`f` 选一个，单个队列则把最后一条弹入输入框并重建 `/follow-up`（及 `--batch`）形式，镜像文本也会离开 SDK 队列 | 按队列编辑归为一个快捷键，且 `ctrl+u` 与队列工作流相配 |
| 坞区组件堆叠 | 无上限；空间不够时由布局压缩槽位 | 上方与下方两个槽位共用一个行预算，被裁掉的行用 `… (widgets truncated)` 标出 | 否则很高的组件堆叠会挤掉对话区与坞区其他部分 |
| 鼠标拖拽选中 | 屏幕上任意格子都可选中，原样复制该格子，用反显上色，拖动期间继续跟随新输出 | 只在对话区、输入卡片与 Notice 面板内生效；复制文本会去掉这些区域自身的边框、内缩与按键提示行；高亮使用主题的 `selectedBg`，开启 copy-on-select（默认）时随松手清除，关闭该设置时保留供复制命令取用，并在带指针悬停提示的块内的卡片行上加下划线（悬停提示用的是同一个背景色）；按下会钉住对话区，使流式输出挪不动选中行，松开时若期间有输出或用户滚动过则停在那里 | [鼠标拖拽选中](mouse-selection.zh.md) |
| 隐藏的 thinking | 关闭隐藏时显示完整思考文本，开启时只显示斜体 `Thinking...` | 开启隐藏时，每个块渲染为跟随流式输出的 3 行尾窗：`Thinking` 标题的耗时在流式期间实时走动、思考停止增长后冻结，左侧竖线后是最后三行可见内容，丢弃了更早内容时首行加 `…`。扩展的 `setHiddenThinkingLabel` 仍整块替换；`/settings` 的 `Thinking tail preview` 行可关闭，默认开启 | 尾窗让思考在流式期间保持可读，又不让该块占满整个对话区 |
| MixCode Home | 没有此页面；transcript 始终显示当前会话 | `home` 伪标签页列出所有已打开 agent 并给出对话预览 | [MixCode Home](home.zh.md) |
| `left`/`right`/`up`/`down`/`enter`/`ctrl+f` | 编辑器光标、历史、提交 | 在 Home 上用于选择/附着/发送/过滤列表；在 agent 标签页仍归编辑器 | [MixCode Home](home.zh.md) |
| 应用动作键处理器 | 命中的处理器直接消费该按键 | 处理器可返回 `false` 主动放弃该键，并会收到原始按键数据 | Home 的绑定不能抢走输入框的 `up`/`down`/`left`/`right`/`enter`，而 `enter` 同时匹配裸换行（`ctrl+j`） |
| 历史回溯 | 回溯到的条目，`up` 时光标在其开头、`down` 时在末尾；浏览多行条目时方向键在条目内移动光标 | 回溯到的条目光标一律在末尾；浏览期间方向键继续在条目间步进 | 光标应落在下一次输入的位置，唤回后是追加而不是从头覆盖；浏览也不该被多行条目卡住 |
| 空输入框 | 不显示任何内容 | agent 标签页提示 `Describe your next change...  @ files  / commands  ← Home · → widgets`，Vim 标签页列出导航键位，Home 上写出目标 agent 并用中性的 thinking 边框色 | 名册明确了目标；Home 自身没有 thinking 等级；输入框也说明它能接受什么。两个按键提示取自实际键位绑定，在不会分栏的 TUI 模式下不显示侧栏那一半 |
| 交互模式下的控制台输出 | `console.log` 等方法直接写到终端 | 画进底部居中的 `Notice` 弹窗（不进对话记录）；`/console-history` 把最近 1000 行交给外部编辑器打开，带时间戳与产生它的标签页 | [控制台历史](console-history.zh.md) |
| 输入框边框 | 输入框上下各一条平直的分隔线 | 圆角卡片，上边框承载工作状态、模式徽标、标签页名与精确上下文用量，卡片内文字与左边框之间空出一格 | 输入区无需额外表头即可说明当前 agent 与上下文；见 [输入坞区](input-dock.zh.md) |
| 编辑器被替换后的 chrome | 无标签栏；扩展替换的编辑器自行绘制边框，不显示 agent 标签 | 当 `setEditorComponent` 提供编辑器时，标签栏下方的分隔线承载标签页名、`[VIM]`/`[ZEN]` 徽标与 `/context-limit` 覆写读数 | 原本承载 agent 名与上下文的卡片随编辑器一同消失，而分隔线每帧都会绘制；见 [输入坞区](input-dock.zh.md) |
| 编辑器坞区页脚 | 两行：工作目录与会话名，然后是 token 与费用合计加 `percent (auto)`，同一行右侧是模型名与 thinking 等级；注册了扩展状态时再加一行 | 一行 meta：模型、thinking 与工作目录、八格上下文进度条与 git 分支，再接扩展状态行；模型、thinking 与工作目录都可点击，按下即打开各自的选择器 | 标签页名与精确 token 数已由卡片上边框承载，模型标签带 provider，进度条也比百分比更易读；见 [输入坞区](input-dock.zh.md) |
| meta 行图标 | 页脚以文字写出模型与 thinking 等级，其他内容不带任何字形 | meta 行的两种完整布局给模型与 thinking 各加一个 Nerd Font 图标，上下文进度条与 git 分支同样带图标；`ui.icons.mode`（`nerd`、`ascii`、`auto`）选择字形集，`auto` 会探测终端 | 图标让字段一眼可辨；ASCII 回退保证没有该字体的终端不会画出方框。见 [图标](icons.zh.md) |
| 工作目录 | 启动时确定：`--workdir` 或进程 cwd；会话整个生命周期都用它 | `/workdir [path]` 把活动标签页切到另一个目录，meta 行上的工作目录徽标打开同一个选择器 | 把标签页指向另一个项目不该意味着重启 agent；见 [工作目录](tabs.zh.md#工作目录) |
| Home 上的页脚 | 无此页面 | Home 会收起坞区页脚，因此没有 meta 行 | 名册已经列出每个 agent 及其上下文，而 Home 自身没有会话 |
| 用户消息块 | 带背景的消息文本块 | 同一块内容，但在首行右端显示发送时间（`Sep 29, 9:29 PM`：短月份、日、时、分，取终端自身区域设置），以暗色绘制，正文渲染宽度相应收窄，任何文字都不会压到时间上 | 消息块自身说明了发送时刻，长对话无需打开会话列表就能按时间阅读 |
| 指针 hover 反馈 | 无提示：列表忽略指针移动，消息区域只响应点击，跳到底部标签只有一种样式 | 指针下的单元格获得选中背景与下划线（标签页 chip、命令面板行、坞区 meta 行的模型与 thinking 字段）；响应点击的消息块整块填充为一个矩形；全屏渲染器在指针离开后告知对应组件，捕获型浮层打开时保持其下方界面无高亮，非捕获型浮层区域外仍保持 hover，终端尺寸变化时清除所有 hover | 本 fork 的可点击界面需要一个不改变键盘选择与活动标签页的提示 |
| 扩展模块解析 | bun 跑构建产物时保留 jiti 的 `tryNative`（原生 TS 导入），扩展的 `@earendil-works/*` 裸导入因此从环境 `node_modules` 解析 | bun 跑构建产物时改走 `virtualModules`，清单内的 specifier 一律取运行中宿主自己的那份；bun 跑 TypeScript 源码不受影响 | 第二份 `@earendil-works/pi-tui` 会让 `ToolExecutionComponent.prototype` 的补丁打在宿主从未渲染的类上，渲染扩展于是静默退回内置工具行 |

| 新版本提示 | 启动时请求 `pi.dev/api/latest-version`，打印带 changelog 链接的 `Update Available` 块，由 `PI_SKIP_VERSION_CHECK` 关闭 | 不再提示 pi 自身的新版本：启动检查、`checkForNewPiVersion` 与 `PI_SKIP_VERSION_CHECK` 均已删除 | 本 fork 改为只在 [MixCode Home](home.zh.md) 报告过期的扩展包 |
| 退出恢复提示 | 已持久化的会话在交互式退出时打印 `To resume this session: pi --session <id>` | 不再打印该输出，负责拼装它的 `formatResumeCommand` 辅助函数也已删除 | MixCode 在一个进程里保留多个会话并通过自己的标签页进入，pi 的 `--session` 命令不是恢复会话的方式 |
| 设置覆盖 | `applyOverrides` 把值叠加到生效设置上，下一次从各作用域重新组合（`save`、`reload`、信任状态变化）时就会丢失 | 覆盖层会被保留，并在每次重新组合时重新合并；`clearOverrides` 用于释放指定字段 | 标签页的 `/context-limit` 会收窄压缩预算，否则中途一次设置写入就会在无提示的情况下恢复完整预算 |

## 已过期的上游页面与源码文案

有意不打补丁：

| 页面 | 原文 | 实际 |
| --- | --- | --- |
| `packages/coding-agent/docs/usage.md:49` | "Press `Shift+Tab` to cycle through supported levels" | 循环键是 `alt+t` |
| `packages/coding-agent/docs/keybindings.md:155` | `app.thinking.cycle` 默认 `shift+tab` | 默认是 `alt+t` |
| `packages/coding-agent/src/experimental/micro/README.md:30` | "Shift+Tab: cycle the current model's supported thinking levels" | micro 的状态行读的是实时绑定，只有这行硬编码文本是错的 |
| `packages/coding-agent/docs/keybindings.md:152` | `app.model.cycleForward` 默认 `ctrl+p` | 无默认键；`ctrl+p` 是 `app.palette` |
| `packages/coding-agent/docs/models.md:33` | "`Ctrl+P` cycles through available models" | `ctrl+p` 打开命令面板；只有 `shift+ctrl+p` 仍可循环，且只能回到上一个模型 |
| `packages/coding-agent/src/cli/args.ts:303`（源码文案） | `--models` 帮助说是 "patterns for Ctrl+P cycling" | `ctrl+p` 打开命令面板；循环键是 `shift+ctrl+p`（Windows 与 WSL 为 `alt+p`） |
| `packages/coding-agent/docs/slash-commands.md:30` | `/compact [instructions]` | 本 fork 还接受前置的 `provider/modelId`，让摘要只用该模型执行 |
| `packages/coding-agent/docs/compaction.md:41` | "trigger manually with `/compact [instructions]`" | 同上：可在指令前指定摘要模型 |
| `packages/coding-agent/docs/environment-variables.md:85` | `PI_SKIP_VERSION_CHECK` 关闭 `pi.dev` 最新版本请求 | 该变量与读取它的启动检查已删除 |
| `packages/coding-agent/src/utils/version-check.ts`（源码文案） | 导出 `checkForNewPiVersion`，即读取 `PI_SKIP_VERSION_CHECK` 的启动检查 | 已删除；`getLatestPiRelease` 与 `isNewerPackageVersion` 保留供 `pi update --self` 使用 |
| `packages/coding-agent/docs/usage.md:23` | "Press `Ctrl+T` to show or hide thinking blocks" | `ctrl+t` 打开 Tab Jump；`app.thinking.toggle` 默认键不变，但 composer 在跳转处理器之后不再响应它 |
| `packages/coding-agent/docs/keybindings.md:157` | `app.thinking.toggle` 默认 `ctrl+t` | 同一个键属于 `app.tab.jump`，composer 先注册跳转处理器；thinking 开关需重新绑定后才可用 |
| `packages/coding-agent/docs/settings.md:79` | `fullscreenExitOutput` 取 `resume-hint` 时选择 "only a session resume hint" 作为退出输出 | 该取值仍然跳过退出时的对话记录输出，且不再打印任何内容 |

上面这些页面也都没有列出标签页键位和标签页斜杠命令 —— 包括 `/jump` 及其 `ctrl+t`；这些以 [Agent 标签页](tabs.zh.md) 为准。

## 本 fork 修改的上游文件

以下每一个都是潜在冲突点，因此改动要压缩到"调用 `mixcode/` 代码的接线"这一层：

- `packages/coding-agent/src/modes/interactive/interactive-mode.ts`
- `packages/coding-agent/src/modes/interactive/components/status-indicator.ts`：摘要模型标签与按压缩原因区分的文案颜色
- `packages/coding-agent/src/modes/interactive/components/session-selector.ts`
- `packages/coding-agent/src/modes/interactive/components/custom-editor.ts`
- `packages/coding-agent/src/core/keybindings.ts`
- `packages/coding-agent/src/core/slash-commands.ts`
- `packages/coding-agent/src/core/extensions/runner.ts`
- `packages/coding-agent/src/modes/interactive/chat-viewport.ts`
- `packages/coding-agent/src/main.ts`
- `packages/coding-agent/src/core/agent-session.ts`：手动压缩请求独立指定模型，以及 steering 与 follow-up 队列的摘除
- `packages/coding-agent/src/core/settings-manager.ts`：fork 的 fullscreen `tuiMode` 默认值，以及保留的覆盖层（`applyOverrides` 的覆盖在每次重新组合时都会保留，`clearOverrides` 释放指定字段）
- `packages/coding-agent/src/core/extensions/loader.ts`：让 bun 发行版的扩展导入走 `virtualModules`
- `packages/coding-agent/src/modes/interactive/tui-renderer.ts`：把宿主的复制回调与选中选项转发给备用屏幕
- `packages/coding-agent/src/modes/interactive/theme/theme.ts`、`theme/dark.json`、`theme/light.json`、
  `theme/theme-json.ts`、`theme/theme-schema.json`：带框卡片填充用的 `panelBg` 背景色
- `packages/coding-agent/test/extensions-runner.test.ts`
- `packages/coding-agent/test/interactive-tui.test.ts`：复制确认改为断言 toast
- `packages/coding-agent/src/modes/interactive/tui-renderer.ts`：指针位于跳到底部标签上时加下划线
- `packages/coding-agent/src/modes/interactive/components/tool-execution.ts`、`assistant-message.ts`、
  `compaction-summary-message.ts`、`branch-summary-message.ts`、`skill-invocation-message.ts`：可点击区域改用 fork 的 `HoverRegion`，框架自带的 `MouseRegion` 不会绘制高亮
- `packages/coding-agent/src/modes/interactive/components/user-message.ts`：消息首行右端的发送时间
- `packages/ai/src/api/openai-responses-shared.ts`：把 Responses 流中服务器报告的模型名记录到
  `AssistantMessage.responseModel`
- `packages/ai/src/api/anthropic-messages.ts`、`packages/ai/src/api/openai-completions.ts`：与 Responses 适配器共用同一个助手记录服务端报告的模型，让覆盖规则只有一处定义
- `packages/agent/src/agent.ts`：steering 与 follow-up 队列 API
- `packages/tui/src/layout-node.ts`：窗口化布局节点与滚动行提供者
- `packages/tui/src/components/settings-list.ts`：`SettingItem` 的可选 `section` 标题行
- `packages/coding-agent/src/modes/interactive/components/settings-selector.ts`：`MixCode` 分组条目，以及 `Fullscreen exit output` 的描述
- `packages/coding-agent/src/modes/interactive/theme/theme.ts`：`getSettingsListTheme` 的分组标题样式
- `packages/tui/src/layout.ts`：窗口化滚动子组件、滚动盒上的行提供者、把组件解析到它在已提交帧里盒子的 `getComponentBox`，以及被挂起的滚动视图传给窗口化子组件的 `honorOffset` 参数
- `packages/tui/src/components/scroll-view.ts`：`setFollowSuspended` / `isFollowSuspended` / `resumeFollowEnd`，让指针手势能钉住它正在选中的那些行
- `packages/tui/src/tui.ts`：浮层鼠标派发会返回命中的浮层，以便区分“在浮层外”与“在浮层上”；`TuiSelectionOptions` 契约（含 `clearOnRelease` 与带绘制行信息的 `highlight`）、把某一行解析到画出它的组件的 `Container.componentAtRow`、`hasCapturingOverlay`，以及区域解析所需的浮层矩形查询
- `packages/tui/src/components/box.ts`：`componentAtRow`，让带内缩的卡片里的行也能解析到画出它的子组件
- `packages/tui/src/tui-alt-screen.ts`：经提供者读取内容行；`scrollToPrompt` 改为公开；
  `onCopyResult` 选项让宿主自行确认复制结果，替代该屏幕自带的一行 flash，并按 grapheme 数报告复制长度；
  跟踪被 hover 的组件，以便后续移动到别处、打开浮层或指针被捕获时向其发送 leave 事件；
  `scrollToEndIndicator` 会收到指针是否在标签上；`selection` 选项把拖拽限定到宿主公布的区域，并交给宿主做文本清洗、着色，以及在复制那次松手时清除高亮
- `packages/tui/src/utils.ts`：`countGraphemes` 从备选屏幕移到这里，让 coding-agent 的 toast 能用同一单位报告复制长度
- `packages/tui/src/index.ts`：导出窗口化节点、鼠标派发、grapheme 计数器与图片行判定，以及选中选项
- `packages/coding-agent/src/cli/args.ts`：`--tui-mode` 帮助行写出 fork 的默认值
- `packages/coding-agent/test/settings-manager.test.ts`：TUI 模式断言改为 fork 的 fullscreen 默认值
- `packages/coding-agent/test/keybindings.test.ts`、`packages/coding-agent/test/interactive-mode-compaction.test.ts`：队列绑定与压缩路径
- `packages/coding-agent/src/utils/version-check.ts`：删除 `checkForNewPiVersion`，启动提示是它唯一的调用方
- `scripts/profile-coding-agent-node.mjs`：`--offline` 不再设置已删除的 `PI_SKIP_VERSION_CHECK`
- `packages/coding-agent/test/version-check.test.ts`、`packages/coding-agent/test/package-command-paths.test.ts`：用例中去掉已删除的检查与对应环境变量
- `packages/coding-agent/test/suite/regressions/5080-signal-shutdown-extension-cleanup.test.ts`：随提示一并删掉恢复提示用例，保留它原本要覆盖的退出顺序
- `packages/coding-agent/test/format-resume-command.test.ts`：随其覆盖的 `formatResumeCommand` 一并删除
- `AGENTS.md`、`.gitignore`

本 fork 还给 `keybindings.ts` 加了键位绑定 —— 工作目录选择器响应的 `app.workdir.*`、排队消息编辑响应的 `app.queueEdit.*`，以及 Tab Jump 浮层响应的 `app.tab.jump` / `app.tabJump.toggleNonIdle`；`core/mixcode/multi-tab/tab-manager.ts` 与 `tab-state.ts` 是 fork 自有文件。

## 只存在于本 fork 的路径

上游不引用它们，因此永不冲突：

- `MIXCODE.md` —— fork 规则
- `MIXCODE_CHANGELOG.md` —— fork 改动记录
- `UPSTREAM.json` —— fork 所基于的上游版本
- `.agents/skills/` —— fork 专用 agent skill，包括[手动 TUI 演示](../.agents/skills/mixcode-manual-e2e/SKILL.md)
- `docs/` —— 本目录
- `test-all.sh`、`run.sh`、`install.sh` —— fork 测试入口、开发启动脚本与本地安装脚本
- `packages/*/src/**/mixcode/`、`packages/*/test/mixcode/`、`packages/tui/test/mixcode-*.test.ts` —— fork 代码与其测试
- `packages/coding-agent/src/modes/interactive/components/clickable-card.ts` —— 位于 `mixcode/` 目录之外的 fork 模块
