# Widget Layout: Row Budget and Side Panel

[中文文档](widget-layout.zh.md)

Extension widgets are drawn in two places: the fixed dock above and below the editor, and, when
[inline widgets mode](inline-widgets.md) is on, the tail of the chat. Both places bound how many
rows a widget stack may take, so widgets cannot push the rest of the interface off the screen. Each
bound has its own marker row, so a trimmed stack always says that it was trimmed.

## The dock budget

The widgets above and below the editor share one budget, because both come out of the same fixed
dock:

```text
budget = terminal rows
       - rows of the tab bar, pending messages, status line and footer
       - the editor's own minimum (3 rows)
       - the chat's minimum (6 rows)
       - the dock's own separating row above the editor
```

Rows are handed to the above-editor widgets first and the remainder to the below-editor widgets, in
registration order. When the stack does not fit:

- the rows that fit render normally and one dim row `… (widgets truncated)` marks the cut;
- a widget whose rows are cut in half keeps the rows that are shown;
- a budget of zero or less hides every widget row;
- with no terminal size yet, the widgets render uncapped.

The budget is applied per frame, so resizing the terminal re-decides it without anything having to
notify the layout. Mouse rows still reach the widget under the pointer, including a widget that is
only partly shown.

## The two caps

| Cap | Applies to | Marker |
| --- | --- | --- |
| This budget | the widget stack in the dock (above and below together) | `… (widgets truncated)` |
| The 10-row cap on `setWidget(key, string[])` content | one array-content widget, before it reaches the layout | `... (widget truncated)` |

They are independent: the per-widget cap protects the dock from a single long widget, and the stack
budget protects it from many widgets, or from component widgets that have no per-widget cap. A
widget registered as a component renders whatever height it likes, so only the stack budget bounds
it.

## Inline mode

While a tab renders its widgets in the chat tail, both dock slots render no widget rows and the
tail's own budget takes over. The above-editor slot keeps its separating row, so the chat tail does
not end against the editor. See [Inline Widgets](inline-widgets.md) for the tail's rules, including
the priority order and the jitter guard.

## Side panel

`→` (`app.widgets.panel`) on an empty composer opens the tab's side panel: a right-hand column that
collects every above- and below-editor widget beside the chat, so the dock stops rendering them.
The composer keeps the full width — only the transcript's row region is split. `→` again closes
the panel. The toggle is per tab and needs nothing persisted; a session starts with it closed.

Opening requires at least one widget and a terminal of at least 80 columns; a refused open says
why with a toast. Below 80 columns an already-open panel stops splitting instead of crushing the
chat, and the widgets return to the dock.

The column is one third of the terminal width (at least 30 cells) with a muted left border, a
pinned dim `Widgets` title, a dim `─ key ─` rule heading each widget, and a dim `→ to close` hint
as its last row. Wide widget lines wrap instead of truncating, and content taller than the panel
scrolls at the wheel (3 rows per event) with `↑ more` / `↓ more` marking hidden rows; the wheel
over the chat keeps scrolling the chat. A drag that starts on the panel selects within the panel
only — points clamp to its body cells, and releasing copies the selected text without the frame,
like any other copy.

While an extension interaction (a selector, input, editor, or custom component) owns the
composer, the panel stays open but leaves the wheel to the chat, and its toggle key goes to the
focused component instead. In [inline mode](inline-widgets.md) the chat-tail widget block stands
down while the panel is open; the tail and its collapse state return when it closes.
