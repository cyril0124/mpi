# MixCode Fork 文档

[English Documentation](README.md)

本目录是本 fork 自己的文档。上游页面 —— `packages/*/docs/`、各包的 `README.md` 与 `CHANGELOG.md`、以及 `src/**/*.md` —— **都不做修改**：改上游页面会在每次合并上游时产生冲突，所以 fork 的功能写在这里。凡是本 fork 的行为与上游文档不一致的地方，都记录在 [上游漂移](upstream-drift.zh.md)。

## 功能

- **[键位](keybindings.zh.md)**：fork 重新绑定了什么、按界面新增了哪些 id（标签页、Tab Jump、MixCode Home、工作目录选择器、排队消息、控制台 Notice、vim 模式）、composer 的按键解析顺序，以及 `Escape` 做什么。
- **[Agent 标签页](tabs.zh.md)**：一个终端里并行运行多个 agent —— 键位、命令、Tab Jump 切换浮层（`ctrl+t` / `/jump`）、标签栏状态、扩展对话框、颜色、持久化、启动恢复。
- **[命令面板与退出确认](command-palette.zh.md)**：`ctrl+p` 模糊搜索并列出所有可执行命令，`ctrl+q` 在结束会话前先询问。
- **[Vim 模式](vim-mode.zh.md)**：全屏对话区的模态导航（进入方式、按键、按标签页的行为、全屏前提）。
- **[Zen 专注模式](zen-mode.zh.md)**：`/toggle-zen-mode` 隐藏标签栏标签块，只留分隔线继续显示其他 agent 的状态圆点，并让 `tab`/`shift+tab` 不再切换标签页。
- **[窗口化对话渲染](windowed-transcript.zh.md)**：全屏对话区如何只渲染可见块、保持滚动范围正确，以及鼠标交互行为。
- **[鼠标拖拽选中](mouse-selection.zh.md)**：全屏拖动可以选中哪些区域、复制出的文本去掉了什么、选区如何着色。
- **[MixCode Home](home.zh.md)**：列出所有已打开 agent 的起始页面，展示所选 agent 的对话预览，并可新建或恢复会话。
- **[控制台历史](console-history.zh.md)**：控制台输出画进 Notice 弹窗而不是写到终端，`/console-history` 把最近 1000 行交给外部编辑器打开，带时间戳与产生它的标签页。
- **[模型请求错误诊断](provider-errors.zh.md)**：失败的模型请求把有界的 `[provider-error]` 事实记进控制台历史，`onProviderError` 让调用方拿到格式化消息背后的原始异常。
- **[内联组件](inline-widgets.zh.md)**：把扩展组件放到对话流末尾而不是编辑器坞区 —— 设置项、单标签页开关、行预算与 `/widgets`。
- **[Thinking 尾窗预览](thinking-tail-preview.zh.md)**：隐藏的 thinking 渲染为 3 行尾窗，耗时实时后冻结；含 `ui.boxedHiddenThinking` 设置项与标签覆盖。
- **[组件布局](widget-layout.zh.md)**：坞区如何限制组件堆叠、单组件行数上限，以及把挂件移到对话旁边的 `→` 侧栏。
- **[输入坞区](input-dock.zh.md)**：包住输入框的圆角卡片、上边框中的标签页名与精确上下文用量，以及取代 pi 状态页脚的 meta 行。
- **[图标](icons.zh.md)**：坞区 meta 行的字形集、`ui.icons.mode` 设置（`nerd`、`ascii`、`auto`），以及 `auto` 能识别的终端。
- **[Batch 脚本](batch-scripts.zh.md)**：用 Lua 或 TypeScript 脚本一次性铺开一批 agent 标签页并派发 Prompt，可从 CLI（`--batch`、`--batch-dry-run`）或 TUI 内的 `/batch` 命令执行。
- **[Skill 隔离](skill-isolation.zh.md)**：`MPI_PROJECT_SKILLS_ONLY` 让会话只使用 workdir 自带的 skill，丢弃用户根与祖先 `.agents/skills` 目录。
- **[Herdr 窗格上报](herdr.zh.md)**：fork 把自己标记为 MixCode，并在每个标签的 `pi.events` 上广播 `mpi:waiting-for-input` 与 `mpi:mark-done`，使 `mpi-herdr-report` 扩展能把窗格状态上报给 Herdr。

## Fork 机制

- **[上游漂移](upstream-drift.zh.md)**：本 fork 相对上游改了什么、哪些上游页面因此过期、哪些路径只存在于本 fork。
