# 命令面板与退出确认

[English Documentation](command-palette.md)

两个快捷键：`ctrl+p` 列出界面能执行的所有命令，`ctrl+q` 在结束会话前先问一次。

## 命令面板

命令面板以带边框的面板悬浮在编辑器上方（宽为终端宽度的 78%，最高为终端高度的 80%），因此正在输入的草稿仍然可见。

| 动作 | 按键 |
| --- | --- |
| 打开命令面板 | `ctrl+p`（`app.palette`） |
| 移动高亮 | `up`、`down`（循环） |
| 执行高亮命令 | `enter` |
| 关闭且不执行任何命令 | `esc`、`ctrl+c` |
| 用鼠标执行某一行 | 点击该行（仅全屏模式；常规渲染器没有鼠标输入） |

`/palette` 打开同一份列表；`/palette <参数>` 报 `Usage: /palette`。

列表包含编辑器 `/` 补全所提供的全部命令来源：内置命令、扩展命令（与内置命令同名的会被丢弃）、
启用技能命令时的技能命令，以及提示词模板。命令面板本身不出现在列表里。

输入即过滤。查询只匹配命令名，描述只做展示、不参与匹配，因此高亮的字符一定落在决定该行存活的那一列。
匹配到的字符会在行内高亮，便于看出命令的哪一部分匹配成功。
结果按匹配质量排序，完全匹配或前缀匹配排在前面。

选中一行会把 `/<命令>` 走普通提交路径发出，所以参数解析、启用条件、确认流程和报错与手动输入该命令完全一致。
命令用完编辑器后，原先的草稿会写回，因此从命令面板执行命令不会丢掉已经输入的内容。`/editor` 是
例外：它把那份草稿交给外部编辑器，此后以外部编辑器写回的内容为准；只有启动失败时才保留原草稿。

`ctrl+p` 原本用于切换到下一个模型，现在它打开命令面板，`app.model.cycleForward` 不再带默认键；
`shift+ctrl+p`（Windows 与 WSL 为 `alt+p`）仍可向后切换模型，`ctrl+l` 仍打开模型选择器。

## 退出确认

| 动作 | 按键 |
| --- | --- |
| 确认后退出 | `ctrl+q`（`app.quit`） |
| 确认 | `y` |
| 取消 | `n`、`esc`、`ctrl+c` |
| 直接退出，不询问 | `ctrl+d`（`app.exit`），未改动 |

`ctrl+q` 在终端中央打开一个带边框的面板，说明动作并等待 `y`；`n`、`escape`、`ctrl+c` 取消，其余按键忽略。取消后会话、草稿和标签页都保持原样。

在 Windows 与 WSL 上，`ctrl+q` 仍属于 `app.message.followUp`，那是这些终端唯一能送达的追加上下文快捷键，因此那里的退出键是 `ctrl+shift+q`。

`/quit` 仍是立即退出，不弹面板。由于面板里也列出 `/quit`，执行那一行同样立即退出：面板守的是按键，不是命令。

## 文件

- `packages/coding-agent/src/modes/interactive/components/mixcode/command-palette/`：列表。
- `packages/coding-agent/src/modes/interactive/components/mixcode/quit-confirm/`：确认面板。
- `packages/coding-agent/src/modes/interactive/mixcode/command-list.ts`：命令面板与编辑器 `/` 补全共用的命令列表。

## 说明

这两个键位对扩展快捷键保留：扩展若注册 `ctrl+p` 或退出键会被跳过并给出警告，与 `ctrl+d`、`ctrl+c`、`escape` 的待遇相同。

编辑器自带的 `/` 命令弹窗打开时，键盘归那个弹窗所有，`ctrl+p` 不生效。
