# 图标

[English](icons.md)

坞区 meta 行会在模型、thinking 等级、上下文进度条与 git 分支前各画一个字形，取哪套字形由
`mixcode_settings.json` 的 `ui.icons.mode` 决定。改动该模式会立即重绘这一行。

默认的 Nerd Font 字形：

```text
 󰚩 anthropic/claude-sonnet-4-5     High   ~/proj/pi     [██░░░░░░] 24.1%    main
 ● pi-subagents
```

ASCII 字形：

```text
 M anthropic/claude-sonnet-4-5    ~ High   ~/proj/pi    # [##------] 24.1%   * main
 ● pi-subagents
```

两行是同一个会话。第二行是没有 Nerd Font 的终端所需要的：字体缺失时，私有区字形会画成方框。

| 字段 | Nerd Font | ASCII |
| --- | --- | --- |
| 模型 | `󰚩` | `M` |
| thinking 等级 | `` | `~` |
| 上下文进度条 | `` | `#` |
| git 分支 | `` | `*` |
| 进度条格 | `█` `░` | `#` `-` |

## 模式

| `ui.icons.mode` | 该行绘制 |
| --- | --- |
| `nerd`（默认） | Nerd Font 字形，不探测终端 |
| `ascii` | ASCII 字形 |
| `auto` | 已知自带 Nerd Font 的终端用 Nerd Font 字形，其余用 ASCII |

`auto` 从环境判断终端：`TERM_PROGRAM` 或 `LC_TERMINAL` 为 iTerm.app、Ghostty、WezTerm、kitty、
rio、tabby、WindowsTerminal、vscode 之一，`TERM=xterm-kitty`，或存在 `WT_SESSION` 标记。程序名
不区分大小写，因为各终端自己决定怎么拼写。

可在 `/settings` 的 MixCode 分区里以 **Icon mode** 这一行修改。该行写入 `ui.icons.mode`，并保留
`ui.icons` 下它不拥有的其他键，因为这个对象同样归 mixcode-pi 所有。三个取值之外的值会作为设置
错误报出，并指明文件名。

## 作用范围

只作用于 meta 行。它的两种完整布局会给模型与 thinking 等级各带一个字形；最紧凑的一种布局（终端窄到
放不下模型名、thinking 等级与工作目录三者）会连同内边距一起去掉这两个字形，因为它要服务于最窄的
终端，不会把单元格花在装饰上。上下文进度条与 git 分支在任何宽度下都保留自己的字形。在 `auto` 下，
不在上述名单里的终端拿到 ASCII 字形。

本 fork 其他位置的字形不受该模式影响：标签页 chip、zen 状态圆点与侧栏面板标记保持原有形状。
