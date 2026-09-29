# 上游漂移

[English Documentation](upstream-drift.md)

本 fork 与上游 pi 存在分歧的地方。上游页面**不做修改** —— 那会在每次合并上游时产生冲突 —— 所以分歧记录在这里，并与造成分歧的改动放在同一个 commit。

## 行为差异

| 方面 | 上游 | 本 fork | 原因 |
| --- | --- | --- | --- |
| `app.thinking.cycle` 默认键 | `shift+tab` | `alt+t` | `shift+tab` 改作 `app.tab.previous` |
| Agent 标签页 | 一个终端一个会话 | 多个并发标签页，各自持有 `AgentSessionRuntime` | [Agent 标签页](tabs.zh.md) |
| 会话删除 | 直接删除所选会话文件 | 所属标签页有对话进行中时拒绝 | 可能还有另一个标签页在写该文件 |
| `app.model.cycleForward` 默认键 | `ctrl+p` | 无默认键 | `ctrl+p` 改作打开命令面板 |
| 退出 | `ctrl+d` 直接退出，不询问 | `ctrl+q`（Windows 与 WSL 为 `ctrl+shift+q`）先询问；`ctrl+d` 不变 | [命令面板与退出确认](command-palette.zh.md) |
| 全屏对话区渲染 | 每帧渲染全部消息组件再裁剪到视口 | 只渲染可见窗口（上下各 20 行余量），未测块按 4 行估算 | 否则帧开销随整段对话增长 |
| 对话区滚动键 | 仅 `tui.altScreen.*` | 全屏模式下另有模态界面（`/vim`、`j`/`k`/`gg`/`G`、提问跳转） | 长对话免鼠标阅读 |
| 模态下的输入框边框 | thinking/bash 边框色 | 强调色边框，输入与提交被锁定 | Vim 模式独占输入 |
| MixCode Home | 没有此页面；transcript 始终显示当前会话 | `home` 伪标签页列出所有已打开 agent 并给出对话预览 | [MixCode Home](home.zh.md) |
| `left`/`right`/`up`/`down`/`enter`/`ctrl+f` | 编辑器光标、历史、提交 | 在 Home 上用于选择/附着/发送/过滤列表；在 agent 标签页仍归编辑器 | [MixCode Home](home.zh.md) |
| 应用动作键处理器 | 命中的处理器直接消费该按键 | 处理器可返回 `false` 主动放弃该键，并会收到原始按键数据 | Home 的绑定不能抢走输入框的 `up`/`down`/`left`/`right`/`enter`，而 `enter` 同时匹配裸换行（`ctrl+j`） |
| 空输入框 | 不显示任何内容 | Home 上会写出目标 agent，并用中性的 thinking 边框色 | 名册已经明确了目标，而 Home 自身没有 thinking 等级 |

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
- `packages/coding-agent/test/extensions-runner.test.ts`
- `packages/ai/src/api/openai-responses-shared.ts`：把 Responses 流中服务器报告的模型名记录到
  `AssistantMessage.responseModel`
- `packages/tui/src/layout-node.ts`：窗口化布局节点与滚动行提供者
- `packages/tui/src/layout.ts`：窗口化滚动子组件、滚动盒上的行提供者
- `packages/tui/src/tui-alt-screen.ts`：经提供者读取内容行；`scrollToPrompt` 改为公开
- `packages/tui/src/index.ts`：导出窗口化节点与鼠标派发
- `AGENTS.md`、`.gitignore`

本 fork 还给 `keybindings.ts` 加了键位绑定；`core/mixcode/multi-tab/tab-manager.ts` 与 `tab-state.ts` 是 fork 自有文件。

## 只存在于本 fork 的路径

上游不引用它们，因此永不冲突：

- `MIXCODE.md` —— fork 规则
- `MIXCODE_CHANGELOG.md` —— fork 改动记录
- `UPSTREAM.json` —— fork 所基于的上游版本
- `docs/` —— 本目录
- `test-all.sh`、`run.sh` —— fork 测试入口与开发启动脚本
- `packages/*/src/**/mixcode/`、`packages/*/test/mixcode/` —— fork 代码及其测试
