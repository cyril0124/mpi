# 上游漂移

[English Documentation](upstream-drift.md)

本 fork 与上游 pi 存在分歧的地方。上游页面**不做修改** —— 那会在每次合并上游时产生冲突 —— 所以分歧记录在这里，并与造成分歧的改动放在同一个 commit。

## 行为差异

| 方面 | 上游 | 本 fork | 原因 |
| --- | --- | --- | --- |
| `install.sh` | 通过 `scripts/build-binaries.sh` 构建发布归档 | 在 `<prefix>/lib/mpi/release.*/` 准备完整运行时后，原子替换 `<prefix>/bin/mpi`；保留旧运行时目录 | 升级失败时保留可用安装，NFS 上运行中的进程仍可访问自己的资源 |
| `app.thinking.cycle` 默认键 | `shift+tab` | `alt+t` | `shift+tab` 改作 `app.tab.previous` |
| Agent 标签页 | 一个终端一个会话 | 多个并发标签页，各自持有 `AgentSessionRuntime` | [Agent 标签页](tabs.zh.md) |
| 会话删除 | 直接删除所选会话文件 | 所属标签页有对话进行中时拒绝 | 可能还有另一个标签页在写该文件 |
| `app.model.cycleForward` 默认键 | `ctrl+p` | 无默认键 | `ctrl+p` 改作打开命令面板 |
| 退出 | `ctrl+d` 直接退出，不询问 | `ctrl+q`（Windows 与 WSL 为 `ctrl+shift+q`）先询问；`ctrl+d` 不变 | [命令面板与退出确认](command-palette.zh.md) |
| 全屏对话区渲染 | 每帧渲染全部消息组件再裁剪到视口 | 只渲染可见窗口（上下各 20 行余量），未测块按 4 行估算 | 否则帧开销随整段对话增长 |
| 对话区滚动键 | 仅 `tui.altScreen.*` | 全屏模式下另有模态界面（`/vim`、`j`/`k`/`gg`/`G`、提问跳转） | 长对话免鼠标阅读 |
| 默认 TUI 模式 | `regular` | `fullscreen`；`settings.json` 里显式写 `tuiMode: "regular"` 仍会回到普通对话区 | 本 fork 的阅读功能（窗口化对话区、Vim、鼠标选中）只存在于备选屏幕；上游 `packages/coding-agent/docs/settings.md` 的默认值仍写作 `"regular"` |
| 模态下的输入框边框 | thinking/bash 边框色 | 强调色边框，输入与提交被锁定 | Vim 模式独占输入 |
| 扩展组件 | 固定在编辑器上/下方的坞区 | 默认放在对话流末尾，带行预算与 `/widgets`，因为 [`ui.inlineWidgets`](inline-widgets.zh.md) 默认开启 | 过高的组件否则会占用整个编辑器坞区的行 |
| 按标签页的设置项 | 无 | `Inline widgets` 读写 `mixcode_settings.json`，在 `/settings` 的 `MixCode` 分组中单独展示 | MixCode 的设置不写进 pi 的 `settings.json`，也不混进它的分组 |
| 设置列表行 | 单一平铺列表 | `SettingItem` 新增可选 `section`，渲染为分组标题行 | 同上 |
| `/settings` 面板 | 上游 `SettingsList` 放在带边框的 selector 里并替换编辑器区域：`→` 光标、搜索输入框、原始的 `true`/`false` 取值、平直的分组标题 | 居中浮层面板，标题为 `Settings`：surface 背景的列表配一条暗色 `filter: type to filter  N/N` 行，每个配置文件上方是 `Pi` / `MixCode` 标题加该文件路径，`›` 行分为标签列与取值列，布尔值显示为 `On`/`Off`，选中项下方显示其说明，底部一行按键提示 | 面板因此像浮在工作内容之上的一层表面，并直接说明某项设置存在哪个文件里；打开面板时输入框保留草稿。选择 `TUI mode` 会先收起面板再切换，因为浮层打开时模式切换会被拒绝 |
| 坞区组件堆叠 | 无上限；空间不够时由布局压缩槽位 | 上方与下方两个槽位共用一个行预算，被裁掉的行用 `… (widgets truncated)` 标出 | 否则很高的组件堆叠会挤掉对话区与坞区其他部分 |
| 鼠标拖拽选中 | 屏幕上任意格子都可选中，原样复制该格子，用反显上色，拖动期间继续跟随新输出 | 只在对话区、输入卡片与 Notice 面板内生效；复制文本会去掉这些区域自身的边框、内缩与按键提示行；高亮使用主题的 `selectedBg`；按下会钉住对话区，使流式输出挪不动选中行，松开时若期间有输出或用户滚动过则停在那里 | [鼠标拖拽选中](mouse-selection.zh.md) |
| MixCode Home | 没有此页面；transcript 始终显示当前会话 | `home` 伪标签页列出所有已打开 agent 并给出对话预览 | [MixCode Home](home.zh.md) |
| `left`/`right`/`up`/`down`/`enter`/`ctrl+f` | 编辑器光标、历史、提交 | 在 Home 上用于选择/附着/发送/过滤列表；在 agent 标签页仍归编辑器 | [MixCode Home](home.zh.md) |
| 应用动作键处理器 | 命中的处理器直接消费该按键 | 处理器可返回 `false` 主动放弃该键，并会收到原始按键数据 | Home 的绑定不能抢走输入框的 `up`/`down`/`left`/`right`/`enter`，而 `enter` 同时匹配裸换行（`ctrl+j`） |
| 空输入框 | 不显示任何内容 | agent 标签页提示 `Describe your next change...  @ files  / commands`，Vim 标签页列出导航键位，Home 上写出目标 agent 并用中性的 thinking 边框色 | 名册明确了目标；Home 自身没有 thinking 等级；输入框也说明它能接受什么 |
| 交互模式下的控制台输出 | `console.log` 等方法直接写到终端 | 画进底部居中的 `Notice` 弹窗（不进对话记录）；`/console-history` 把最近 1000 行交给外部编辑器打开，带时间戳与产生它的标签页 | [控制台历史](console-history.zh.md) |
| 输入框边框 | 输入框上下各一条平直的分隔线 | 圆角卡片，上边框承载工作状态、模式徽标、标签页名与精确上下文用量 | 输入区无需额外表头即可说明当前 agent 与上下文；见 [输入坞区](input-dock.zh.md) |
| 编辑器坞区页脚 | 两行：工作目录与会话名，然后是 token 与费用合计加 `percent (auto)`，同一行右侧是模型名与 thinking 等级；注册了扩展状态时再加一行 | 一行 meta：模型、thinking 与工作目录、八格上下文进度条与 git 分支，再接扩展状态行 | 标签页名与精确 token 数已由卡片上边框承载，模型标签带 provider，进度条也比百分比更易读；见 [输入坞区](input-dock.zh.md) |
| Home 上的页脚 | 无此页面 | Home 会收起坞区页脚，因此没有 meta 行 | 名册已经列出每个 agent 及其上下文，而 Home 自身没有会话 |
| 指针 hover 反馈 | 无提示：列表忽略指针移动，消息区域只响应点击，跳到底部标签只有一种样式 | 指针下的单元格获得选中背景与下划线（标签页 chip、命令面板行）；响应点击的消息块整块填充为一个矩形；全屏渲染器在指针离开后告知对应组件，浮层打开期间保持整个界面无高亮，终端尺寸变化时清除所有 hover | 本 fork 的可点击界面需要一个不改变键盘选择与活动标签页的提示 |
| 扩展模块解析 | bun 跑构建产物时保留 jiti 的 `tryNative`（原生 TS 导入），扩展的 `@earendil-works/*` 裸导入因此从环境 `node_modules` 解析 | bun 跑构建产物时改走 `virtualModules`，清单内的 specifier 一律取运行中宿主自己的那份；bun 跑 TypeScript 源码不受影响 | 第二份 `@earendil-works/pi-tui` 会让 `ToolExecutionComponent.prototype` 的补丁打在宿主从未渲染的类上，渲染扩展于是静默退回内置工具行 |

## 已过期的上游页面与源码文案

有意不打补丁：

| 页面 | 原文 | 实际 |
| --- | --- | --- |
| `packages/coding-agent/docs/usage.md:49` | "Press `Shift+Tab` to cycle through supported levels" | 循环键是 `alt+t` |
| `packages/coding-agent/docs/keybindings.md:155` | `app.thinking.cycle` 默认 `shift+tab` | 默认是 `alt+t` |
| `packages/coding-agent/src/experimental/micro/README.md:30` | "Shift+Tab: cycle the current model's supported thinking levels" | micro 的状态行读的是实时绑定，只有这行硬编码文本是错的 |
| `packages/coding-agent/docs/keybindings.md:152` | `app.model.cycleForward` 默认 `ctrl+p` | 无默认键；`ctrl+p` 是 `app.palette` |
| `packages/coding-agent/docs/models.md:33` | "`Ctrl+P` cycles through available models" | `ctrl+p` 打开命令面板；只有 `shift+ctrl+p` 仍可循环，且只能向后 |
| `packages/coding-agent/src/cli/args.ts:303`（源码文案） | `--models` 帮助说是 "patterns for Ctrl+P cycling" | `ctrl+p` 打开命令面板；循环键是 `shift+ctrl+p`（Windows 与 WSL 为 `alt+p`） |

上面这些页面也都没有列出标签页键位和标签页斜杠命令；这些以 [Agent 标签页](tabs.zh.md) 为准。

## 本 fork 修改的上游文件

以下每一个都是潜在冲突点，因此改动要压缩到"调用 `mixcode/` 代码的接线"这一层：

- `packages/coding-agent/src/modes/interactive/interactive-mode.ts`
- `packages/coding-agent/src/modes/interactive/components/session-selector.ts`
- `packages/coding-agent/src/modes/interactive/components/custom-editor.ts`
- `packages/coding-agent/src/core/keybindings.ts`
- `packages/coding-agent/src/core/slash-commands.ts`
- `packages/coding-agent/src/core/extensions/runner.ts`
- `packages/coding-agent/src/modes/interactive/chat-viewport.ts`
- `packages/coding-agent/src/main.ts`
- `packages/coding-agent/src/modes/interactive/tui-renderer.ts`：把宿主的复制回调与选中选项转发给备用屏幕
- `packages/coding-agent/src/modes/interactive/theme/theme.ts`、`theme/dark.json`、`theme/light.json`、
  `theme/theme-json.ts`、`theme/theme-schema.json`：带框卡片填充用的 `panelBg` 背景色
- `packages/coding-agent/test/extensions-runner.test.ts`
- `packages/coding-agent/test/interactive-tui.test.ts`：复制确认改为断言 toast
- `packages/coding-agent/src/modes/interactive/tui-renderer.ts`：指针位于跳到底部标签上时加下划线
- `packages/coding-agent/src/modes/interactive/components/tool-execution.ts`、`assistant-message.ts`、
  `compaction-summary-message.ts`、`branch-summary-message.ts`、`skill-invocation-message.ts`：可点击区域改用 fork 的 `HoverRegion`，框架自带的 `MouseRegion` 不会绘制高亮
- `packages/ai/src/api/openai-responses-shared.ts`：把 Responses 流中服务器报告的模型名记录到
  `AssistantMessage.responseModel`
- `packages/tui/src/layout-node.ts`：窗口化布局节点与滚动行提供者
- `packages/tui/src/components/settings-list.ts`：`SettingItem` 的可选 `section` 标题行
- `packages/coding-agent/src/modes/interactive/components/settings-selector.ts`：`MixCode` 分组条目
- `packages/coding-agent/src/modes/interactive/theme/theme.ts`：`getSettingsListTheme` 的分组标题样式
- `packages/tui/src/layout.ts`：窗口化滚动子组件、滚动盒上的行提供者、把组件解析到它在已提交帧里盒子的 `getComponentBox`，以及被挂起的滚动视图传给窗口化子组件的 `honorOffset` 参数
- `packages/tui/src/components/scroll-view.ts`：`setFollowSuspended` / `isFollowSuspended` / `resumeFollowEnd`，让指针手势能钉住它正在选中的那些行
- `packages/tui/src/tui.ts`：浮层鼠标派发会返回命中的浮层，以便区分“在浮层外”与“在浮层上”；`TuiSelectionOptions` 契约、`hasCapturingOverlay`，以及区域解析所需的浮层矩形查询
- `packages/tui/src/tui-alt-screen.ts`：经提供者读取内容行；`scrollToPrompt` 改为公开；
  `onCopyResult` 选项让宿主自行确认复制结果，替代该屏幕自带的一行 flash，并按 grapheme 数报告复制长度；
  跟踪被 hover 的组件，以便后续移动到别处、打开浮层或指针被捕获时向其发送 leave 事件；
  `scrollToEndIndicator` 会收到指针是否在标签上；`selection` 选项把拖拽限定到宿主公布的区域，并交给宿主做文本清洗与着色
- `packages/tui/src/utils.ts`：`countGraphemes` 从备选屏幕移到这里，让 coding-agent 的 toast 能用同一单位报告复制长度
- `packages/tui/src/index.ts`：导出窗口化节点、鼠标派发、grapheme 计数器与图片行判定，以及选中选项
- `packages/coding-agent/src/cli/args.ts`：`--tui-mode` 帮助行写出 fork 的默认值
- `packages/coding-agent/test/settings-manager.test.ts`：TUI 模式断言改为 fork 的 fullscreen 默认值
- `AGENTS.md`、`.gitignore`

本 fork 还给 `keybindings.ts` 加了键位绑定；`core/mixcode/multi-tab/tab-manager.ts` 与 `tab-state.ts` 是 fork 自有文件。

## 只存在于本 fork 的路径

上游不引用它们，因此永不冲突：

- `MIXCODE.md` —— fork 规则
- `MIXCODE_CHANGELOG.md` —— fork 改动记录
- `UPSTREAM.json` —— fork 所基于的上游版本
- `.agents/skills/` —— fork 专用 agent skill，包括[手动 TUI 演示](../.agents/skills/mixcode-manual-e2e/SKILL.md)
- `docs/` —— 本目录
- `test-all.sh`、`run.sh`、`install.sh` —— fork 测试入口、开发启动脚本与本地安装脚本
- `packages/*/src/**/mixcode/`、`packages/*/test/mixcode/`、`packages/tui/test/mixcode-*.test.ts` —— fork 代码与其测试
