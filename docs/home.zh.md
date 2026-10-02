# MixCode Home

[English Documentation](home.md)

MixCode Home 是本 fork 的起始页面：一页列出所有已打开的 agent 标签页，显示所选 agent 的对话预览，并提供两个开启会话的动作。它以伪标签页（`home`）的身份存在于标签页循环中，本身不拥有会话，也没有 runtime。

## 如何进入

| 当前位置 | 操作 | 结果 |
| --- | --- | --- |
| agent 标签页 | 输入框为空时按 `left` | 进入 Home，并选中刚才所在的 agent |
| 任意位置 | `tab` / `shift+tab` | 在 `[Home, ...agent 标签页]` 中循环，可回绕；但当前 agent 处于 [zen 专注模式](zen-mode.zh.md) 时不生效 |
| 任意位置 | 点击 `MixCode Home` 标签块 | 进入 Home；若已在 Home，同一下点击会打开 [标签页跳转](tabs.zh.md#标签页跳转) |

输入框中有内容时 `left` 不会切页：这时该键属于编辑器，光标移动照常工作。

## 页面

```text
   MixCode / HOME                                                            v0.87.1
   ~/project                                                             1 working
   ──────────────────────────────────────────────────────────────────────────────
   Agents 3                                                     + New session  [ Resume ]
   ──────────────────────────────────────────────────────────────────────────────
   › ● Worker-01                                                        ⠹ [running]
     faux-1 · 21k/200k · running 1m 05s
     ⎿ Running the test suite
     ✓ Research                                                        [done]
     grok-4.6 · 8k/500k · 3m ago
     ⎿ Found the parser bug

   ↑/↓: select  →: attach  Enter: send  Tab: cycle tabs  Ctrl+F: non-idle
```

每张卡片占三行加一个空行：标题与状态标签、`模型 · 上下文 · 最近时间`、以及最新的一条 assistant（其次 system、user）文本。选中的卡片带选中背景。列表会围绕选中项开窗，并在隐藏的两侧标记 `↑ older above` / `↓ newer below`。

启动恢复期间，列表从第一帧就列出整个持久化布局。运行时尚不存在的标签页保留 spinner，状态标签改报所处阶段：`session`、`resources` 或 `waiting for input`（阶段未知时显示通用的 `loading`）。

启动检查发现扩展包有更新时，Home 会在名册上方列出：`Package Updates Available`、说明行 `Package updates are available. Run pi update --extensions`、`Packages:` 标签，以及每个包一行。该提示只在 Home 出现：chat 记录里没有它，pi 也不会提示自身的版本更新。视口放不下时保留开头几条，并在末尾显示 `… more package updates · pi update --extensions`。

Home 上不画 footer：工作目录、用量与模型行、扩展状态以及编辑器上下的扩展 widget 都属于某个 agent，因此工作指示器同样隐藏；附着到 agent 后全部恢复。

当表格可用宽度至少 114 列、可用高度至少 18 行时（约等于 120 列的终端，且高度已扣掉 masthead 与标签栏）页面分栏：左侧列表，右侧所选 agent 的对话。窄于此时对话收成列表下方的预览面板；视口极矮时所有行都留给列表。

## 键位

| 按键 | 动作 id | 行为 |
| --- | --- | --- |
| `up` / `down` | `app.home.selectPrevious` / `app.home.selectNext` | 在可见列表中移动选中项 |
| `right` | `app.home.attach` | 附着到所选 agent（要求输入框为空） |
| `enter` | `app.home.send` | 把输入框内容发给所选 agent，仍停留在 Home |
| `ctrl+f` | `app.home.toggleNonIdle` | 只显示正在工作、出错、已完成或未读的 agent |
| `left` | `app.home.returnHome` | 在 agent 标签页且输入框为空时返回 Home |

这些绑定在不适用时会主动放弃该按键，因此在 agent 标签页上，`up`/`down`（历史）、`left`/`right`（光标）、`ctrl+f`（光标右移）与 `enter`（提交）仍由编辑器处理。`@` / `/` 补全弹窗打开时，上述 Home 键同样会主动放弃，让弹窗独占这些按键；`ctrl+j` 在输入框里插入换行而不是发送。

## 在 Home 上发送

输入框是临时的：进入 Home 会清空它，其中的文本也永远不会变成标签页草稿。为空时它会写出这条消息将发给谁（`Send to <agent>...  @ files  / commands`，名册为空时为 `Select an agent...`），并且 Home 上的输入框使用中性的 thinking 边框色，而不是当前绑定会话的颜色。`enter` 发普通文本时直接提交到所选标签页的会话，Home 保持焦点，因此不用附着就能给某个 agent 派活；发给正在工作的 agent 会作为 steer 处理。`/命令` 与 `!shell` 作用于当前绑定的会话，所以会先附着到所选标签页，再走正常分发。`MPI_DISPLAY_WORKDIR` 会替换 masthead 与每张卡片上的工作目录，`MPI_DISPLAY_MODEL` 替换模型标签，便于录制时隐藏真实路径与提供方；两者默认不设置。发送不会清除目标标签页的未读标记，只有附着才会。

## 动作按钮

` + New session ` 与 `[ Resume ]` 分别执行 `/new-session` 和 `/resume`。鼠标在按下的按钮上抬起时才触发；拖出会取消，悬停只重绘，窗口尺寸变化或弹窗出现会重置捕获状态。这两个命令也可以直接在输入框里输入。

## 已知差异

凡是 mixcode-pi 的 Home 依赖、而本 fork 没有的机制，本 fork 都保留自己的做法：

- 没有 toast 浮层、标题 shimmer；
- 没有 zen 模式；vim 模式是"每个标签页的对话区"状态，Home 既不进入它也不传递它；
- 空输入框的提示按各自界面来写，而不是照抄 mixcode-pi：Home 写出目标 agent，agent 标签页是
  `Describe your next change...  @ files  / commands`，Vim 模式列出它的导航键位；
- masthead 的 `N input` 计数永远不会出现，因为没有东西跟踪"等待用户输入"的标签页；
- 启动落在恢复出来的标签页而不是 Home，以免覆盖本 fork 的标签页恢复；
- 扩展的终端输入处理器优先于 Home 的按键，且 Home 上的文件补全使用当前绑定标签页的工作目录，而不是所选标签页的。
