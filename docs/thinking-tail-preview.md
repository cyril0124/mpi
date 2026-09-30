# Thinking Tail Preview

[中文文档](thinking-tail-preview.zh.md)

With thinking hidden (the `Hide thinking` row in `/settings`, or `hideThinkingBlock` in pi's
settings; `ctrl+t` opens [Tab Jump](tabs.md#tab-jump) instead), each thinking block would normally
collapse to a single italic `Thinking...` line.
The thinking tail preview replaces that line with a three-row tail that follows the stream, so you
can see what the model is working through without giving the block the whole transcript. The
preview is on by default.

```text
  Thinking                            1.4s
  │ the last three visible rows of the
  │ reasoning, wrapped to the chat width
  │ and indented under a left rail
```

The header keeps one column of padding at the right edge. Its duration ticks while the block
still streams and freezes once it stops growing — when answer text or a tool call follows, or the
message ends. Durations below one second read as whole milliseconds (`320ms`), the first minute as
tenths (`1.4s`), and anything longer as whole seconds (`1m 05s`, `1h 02m 03s`). A block restored
from history was never streamed by the renderer, so its header carries no duration.

The tail takes the **last** three visual rows of the block, each source line wrapped to the text
width first; the first visible row gets a `…` marker when earlier content was dropped. A block
whose text is empty after stripping the provider's `thinking:` labels falls back to the
`Thinking...` placeholder.

## Turning it on and off

| Where | Effect |
| --- | --- |
| `ui.boxedHiddenThinking` in `mixcode_settings.json` | The value itself; read at startup and on every toggle. `true` (default) shows the tail, `false` shows the placeholder |
| `/settings` → `Thinking tail preview` (MixCode section) | Same as editing the file: writes the key and re-renders every open message immediately |

The preview applies only while thinking is hidden, and it changes nothing the model receives: the
reasoning is sent and cached exactly as it was.

## Overriding the label

An extension that calls `ctx.ui.setHiddenThinkingLabel(label)` replaces the whole block with its
own label, tail and placeholder alike; the label is rendered trimmed, and an empty or
whitespace-only label counts as no override. Clearing the label with `setHiddenThinkingLabel()`
hands the block back to the tail.

Clicking a hidden thinking block still expands and collapses that run, as it does with the
placeholder.
