# Icons

[中文文档](icons.zh.md)

The dock meta row paints a glyph before the model, the thinking level, the context meter and the
git branch, and `ui.icons.mode` in `mixcode_settings.json` picks the alphabet. Changing the mode
repaints the row immediately.

Nerd Font, the default:

```text
 󰚩 anthropic/claude-sonnet-4-5     High   ~/proj/pi     [██░░░░░░] 24.1%    main
 ● pi-subagents
```

ASCII:

```text
 M anthropic/claude-sonnet-4-5    ~ High   ~/proj/pi    # [##------] 24.1%   * main
 ● pi-subagents
```

Both rows are the same session. The second is what a terminal without a Nerd Font needs, since a
private-use glyph painted there is a box.

| Field | Nerd Font | ASCII |
| --- | --- | --- |
| model | `󰚩` | `M` |
| thinking level | `` | `~` |
| context meter | `` | `#` |
| git branch | `` | `*` |
| meter cells | `█` `░` | `#` `-` |

## The mode

| `ui.icons.mode` | Row paints |
| --- | --- |
| `nerd` (default) | the Nerd Font set, whatever the terminal reports |
| `ascii` | the ASCII set |
| `auto` | the Nerd Font set on a terminal known to ship one, the ASCII set otherwise |

`auto` reads the terminal from the environment: `TERM_PROGRAM` or `LC_TERMINAL` naming one of
iTerm.app, Ghostty, WezTerm, kitty, rio, tabby, WindowsTerminal or vscode, `TERM=xterm-kitty`, or
a `WT_SESSION` marker. The program names are matched without case, since a terminal spells its own
name its own way.

Editable from `/settings` in the MixCode section as **Icon mode**. The row writes
`ui.icons.mode` and leaves the other keys under `ui.icons` alone, since mixcode-pi owns that
object as well. A value outside the three is reported as a settings error naming the file.

## Where it applies

The meta row only. Its two full layouts carry a glyph on the model and on the thinking level. The
tightest layout drops those two along with the padding: it exists for a terminal too narrow for the
model name, the thinking level and the workdir together, so it spends no cell on decoration. The
context meter and the git branch keep their glyphs at every width. In `auto`, a terminal that is not
in the list above gets the ASCII set.

The rest of this fork keeps its own glyphs, whatever the mode: the tab chips, the zen status dots
and the widget panel markers are unchanged.
