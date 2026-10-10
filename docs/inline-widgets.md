# Inline Widgets

[中文文档](inline-widgets.zh.md)

Extension widgets (`ui.setWidget`) normally sit in a fixed dock above the editor, where a tall
widget steals rows from everything else. Inline widgets mode renders them at the tail of the chat
instead: they scroll with the conversation, so they leave the viewport when you scroll up and are
simply the newest rows while you are at the bottom. The mode is on by default.

```text
┌─ Docked (ui.inlineWidgets = false) ────────┐   ┌─ Inline (default) ─────────────────────────┐
│ message 1                                  │   │ message 1                                  │
│ message 2                                  │   │ message 2                                  │
│ ┌ widget: goal ──────────────────────────┐ │   │ ▸ Inline · goal ────────────────────────── │
│ │ 3 tasks remaining                      │ │   │ 3 tasks remaining                          │
│ └────────────────────────────────────────┘ │   │ ▸ Inline · loop ────────────────────────── │
│ [ steered message ]                        │   │ every 5m                                   │
│ > editor                                   │   │ [ steered message ]                        │
└────────────────────────────────────────────┘   │ > editor                                   │
                                                 └────────────────────────────────────────────┘
```

## Turning it on and off

| Where | Effect |
| --- | --- |
| `ui.inlineWidgets` in `mixcode_settings.json` | Global default for new tabs; changing it from `/settings` also switches every open tab immediately |
| `/settings` → `Inline widgets` (MixCode section) | Same as editing the file, without leaving the TUI |
| `/toggle-inline-widgets` | Toggles the active tab only |

The per-tab mode and the collapse state below are session-only: a restored session starts from the
global default, exactly like vim mode.

`mixcode_settings.json` lives in `<agentDir>/mixcode-pi/`, the state directory this fork shares
with mixcode-pi, so both agents read the same file:

```json
{
  "ui": {
    "inlineWidgets": true
  }
}
```

The file is JSON with comments and trailing commas allowed. A write keeps every key this fork does
not own, both at the top level and inside `ui`, so the keys mixcode-pi keeps there survive. A
`ui.inlineWidgets` that is not a boolean is reported as a warning at startup and the default is
used; a malformed file is reported the same way.

## Placement

The inline block is the last block of the document: after every message, before the steer and
follow-up queue, which keeps its docked position. In fullscreen mode the block therefore scrolls
out of the viewport with the chat it follows; in regular mode it is simply the end of the rendered
document. Widget input still works — mouse events reach the widget under the pointer.

Above-editor widgets come before below-editor ones, each in registration order.

## Row budget

A stack of tall widgets must not squeeze the transcript off screen, so the block is capped by a
budget derived from the chat viewport:

| Viewport | Budget |
| --- | --- |
| Any | `clamp(floor(viewport * 0.7), 6, 24)` |

The visible window is the fullscreen transcript viewport, or the terminal's own row count in
regular mode. Below a 12-row viewport the 6-row floor shrinks to half the viewport so the
transcript keeps the other half, and above 34 rows the 24-row ceiling binds before the share does.
A frame rendered before the transcript has been laid out has no viewport at all, and then only your
manual collapse state applies.

Over budget, collapse works on whole widgets:

1. Every body renders complete or not at all; a body is never cut to fit.
2. Complete bodies are handed out in priority order: widgets you expanded yourself first, then the
   most recently updated widget, then registration order. The first widget whose whole body no
   longer fits is the cut: it and every lower-priority widget collapse to their `▸ Inline` header.
3. If even a header-only stack exceeds the budget, the whole block renders as one row:
   `▸ Inline · N widgets · /widgets expand`, shortened on a narrow column to `/widgets expand` and
   then `/widgets`.

A collapsed header is marked `(auto)` when the budget collapsed it and keeps its
`/widgets expand <key>` hint. On a column too narrow for the full hint the header gives up pieces
in this order: the `(auto)` marker, then the widget key, then the `expand` argument, leaving
`/widgets` as the shortest form. A column too narrow even for that shows no hint at all. Headers
are clipped, never wrapped, and two collapsed headers stack without a blank row between them while
an expanded neighbour keeps its separating blank row.

Three details matter when widget heights change:

- **Decisions are held against jitter, not against change.** Automatic decisions carry over while
  the same widgets (same keys and recency, same budget, same width) are on screen and the fully
  expanded block's height moves by no more than a deadband of 2 rows or 20% of the budget,
  whichever is larger. A resize, a width change, a widget update, a widget added or removed, or a
  bigger content change recomputes, so the most recently updated widget takes the body rows. Held
  decisions are also dropped once the expanded block has fit the budget for two frames in a row,
  so content that keeps shrinking expands again while a one-row dip cannot re-expand a tail that
  immediately overflows.
- **A manual expand wins.** A widget you expanded with `/widgets expand <key>` is never
  auto-collapsed and keeps its complete body even when the pinned widgets alone exceed the budget:
  the block overflows rather than contradicting the command or cutting a body.
- **Automatic decisions are disposable.** They live in session-only state, a `/widgets` command
  takes over its key immediately, and the next recomputation discards the rest.

## `/widgets`

| Command | Action |
| --- | --- |
| `/widgets` | Toggle every widget between collapsed and expanded. An auto-collapsed tail counts as collapsed, so this expands it; repeating the command hands the widgets back to the row budget instead of pinning them. |
| `/widgets expand [key]` | Expand all widgets, or the one with that key |
| `/widgets collapse [key]` | Collapse all widgets, or the one with that key |
| `/widgets toggle [key]` | Toggle all widgets, or the one with that key |

A key is matched exactly and may contain spaces. An unknown key and a tab with no widgets are both
reported as errors. The argument completes the action, then the keys the active tab has registered.

## Behaviour limits

Nothing in inline mode itself suppresses the block, and the editor border carries no inline-mode
badge; the [widget side panel](widget-layout.md) is the one exception, standing the chat-tail block
down while it owns the widgets. A widget keeps the colours its own component renders, and its text is
reduced to one printable row per line: colour sequences survive, every other escape sequence and
control character is dropped, so a widget cannot move the cursor, clear the screen, or split a row.
Bodies are drawn at the chat column width, so they wrap differently than a narrow dock would.

The 10-row cap on array-content widgets applies in the tail as well: a widget registered with more
than 10 lines arrives already truncated with a muted marker, because the cap belongs to registration
rather than to the dock. Widgets registered as components have no such cap.
