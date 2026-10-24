# Input Dock

[中文文档](input-dock.zh.md)

The composer at the bottom of an agent tab is framed by a rounded card, and the row under it
replaces pi's status footer.

## The card

```
╭─ ↑ 4 ────────────────────────────────────────── Agent-01 · 12.3k/200k ─╮
│  Describe your next change...  @ files  / commands  ← Home · → widgets │
╰─ ↓ 2 more ─────────────────────────────────────────────────────────────╯
```

- The top edge carries the working status while a turn runs, the mode badges (`[VIM]`, `[SHELL]`,
  `[ZEN]`, and `↑ N` when editor rows are scrolled out of view), the tab name, and the exact context
  usage (`12.3k/200k`, or `?/200k` while the count is unknown). A turn in flight and a mode badge
  share the edge while they fit. A `*` after the limit (`12.3k/32k*`) marks a window set by
  `/context-limit`; the meter below measures against it.
- The bottom edge carries `↓ N more` when the draft has rows below the visible window.
- The frame takes the editor's own border colour, so vim mode, shell mode and the thinking level
  keep the colours they had.
- The body keeps the card's side borders and holds its text one column off the left border. The
  autocomplete menu stays outside them, indented to the column that text starts in.
- The context reading switches to the warning colour at 85% of the window the card reports.
- An empty composer hints the two keys that act on it besides `@` and `/`: `← Home` opens
  MixCode Home and `→ widgets` toggles the side panel. Both labels follow the configured keybindings,
  and the panel half is left out in TUI modes that do not split the chat. While vim mode owns the
  composer the hint lists the mode's keys instead: the message jumps, `j`/`k` scrolling, the 10-row
  page keys, the oldest and newest row, and the exit key, each under the key the user has.

The card needs ten columns. Below that the plain editor is used, so a working status always has
somewhere to go. The status degrades from its message to the spinner to a truncated spinner, the
badges give way to it, and it takes the tab name's place before it would disappear.

## Replaced editors

An extension can replace the prompt editor with a component of its own
(`ctx.ui.setEditorComponent`). The card and its top edge are gone with it, so the rule under the
tab bar carries the labels instead: the tab name and any context override on the right, `[VIM]` and
`[ZEN]` on the left. The exact context reading appears only while `/context-limit` set the window,
because the meta row below already has the meter. As the row narrows, the labels drop in the card's
own order and it ends as a plain rule. Home keeps the plain rule, since its composer targets a tab
it is not attached to.

## The meta row

```
 󰚩 anthropic/claude-sonnet-4-5     High   ~/proj/pi     [██░░░░░░] 24.1%    main
 ● pi-subagents
```

The model, the thinking level and the workdir sit on the left; the context meter and the git branch
on the right. All three left-hand fields are click targets: the pointer lights the field up and a
press opens its picker, so the model selector, the thinking selector and the workdir picker are all
reachable with the pointer. See [Workdir](tabs.md#workdir). The workdir only has a target when the
row actually drew one: an extension footer that owns the row, or a row too narrow for the path,
leaves nothing to click. The model reads as `<provider>/<model-id>`, so a session on a proxy or an
aggregator still names the provider it is really going through. The meter has eight cells and is
green below 50%, accent from 50%, and red from 80%. The glyphs the row paints come from
`ui.icons.mode`: the Nerd Font set by default, ASCII on request or when `auto` finds no known
terminal. See [Icons](icons.md).

Every piece degrades in a fixed order as the terminal narrows: the branch goes first, then the
meter, then the workdir compacts segment by segment, and the model drops to its id alone before it
truncates. The right block is dropped whole rather than squeezing the workdir out of the row.

The second row appears when extensions publish status texts, and is hidden while vim mode is
active.

## External editor

`/editor`, or the external-editor key (`ctrl+g`, `app.editor.external`), hands the draft to the
configured external editor (`externalEditor` from the settings, else `$VISUAL` / `$EDITOR`, else
`notepad` on Windows and `nano` elsewhere) and takes back what it wrote: the composer keeps the
result, an emptied draft included, and a launch that fails leaves the draft where it was. Both hand
over the draft with its pasted blocks expanded, not as `[paste #N]` markers. The key reads the live
composer; typing `/editor` submits the command, so the buffer the external editor opens is empty,
while picking `/editor` from the command palette (`ctrl+p`) edits the draft the palette took over
before it replaced it with the command text. An argument reports `Usage: /editor`.

## What the dock no longer shows

pi's footer drew two rows: the working directory with the session name, then the token and cost
totals with `percent (auto)` on the left and the right-aligned model with its thinking level;
extensions could add a third status row. The card's top edge now carries the name and the exact
token counts, and the meta row carries the rest, except:

- the `(auto)` auto-compaction marker,
- the cumulative `↑ ↓ R W` and cache-hit line, and the cost total,
- the `(sub)` subscription marker and the experimental `• xp` marker.

`/session` still prints the token, cache and cost sections, `/settings` still reports
auto-compaction, and Home still shows each agent's context usage. The footer's conditional
`(provider)` prefix is gone as a matter of form: the meta row's model label names the provider
unconditionally.

## Home

Home has no meta row. The composer there targets the agent the roster selects, so the card names
that agent and carries no context reading of its own.
