# Thinking 尾窗预览

[English Documentation](thinking-tail-preview.md)

开启隐藏 thinking 时（`/settings` 里的 `Hide thinking`，或 pi 设置里的 `hideThinkingBlock`；`ctrl+t` 现在是 [标签页跳转](tabs.zh.md#标签页跳转)），每个 thinking 块本会折叠成一行斜体 `Thinking...`。尾窗预览把这一行换成跟随流式输出的 3 行尾窗：既能看到模型正在推演什么，又不会让该块占满整个对话区。该预览默认开启。

```text
  Thinking                            1.4s
  │ 思考内容的最后三行可见内容，
  │ 按对话宽度折行，
  │ 缩进在左侧竖线之后
```

标题行在右端预留一列。耗时在思考仍在流式输出时实时走动，思考停止增长后冻结 —— 后续出现正文或工具调用，或消息结束。不足 1 秒显示整数毫秒（`320ms`），1 分钟以内显示一位小数的秒（`1.4s`），更长则显示整秒（`1m 05s`、`1h 02m 03s`）。从历史记录恢复的块渲染器从未接过流，因此标题不带耗时。

尾窗取该块**最后**三行可见内容，每行先按正文宽度折行；丢弃了更早内容时首行加 `…` 标记。剥掉 provider 的 `thinking:` 标签后文本为空的块，回退为 `Thinking...` 占位符。

## 开关

| 位置 | 作用 |
| --- | --- |
| `mixcode_settings.json` 的 `ui.boxedHiddenThinking` | 取值本身；启动时读取，每次切换即时生效。`true`（默认）显示尾窗，`false` 显示占位符 |
| `/settings` → `Thinking tail preview`（MixCode 分组） | 等同于改文件：写入该键并立即重绘已打开的消息 |

预览只在隐藏 thinking 时生效。它不会向模型渲染任何内容，思考块的发送与缓存也与之前一致。

## 标签覆盖

扩展调用 `ctx.ui.setHiddenThinkingLabel(label)` 时，整个块替换为该标签，尾窗与占位符都不生效；标签按去除首尾空白后渲染，空串或纯空白视为未覆盖。用 `setHiddenThinkingLabel()` 清空标签后，该块交回尾窗。

点击隐藏的 thinking 块仍可展开/折叠该段，与占位符时一致。
