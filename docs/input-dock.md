# Input Dock

[中文文档](input-dock.zh.md)

The composer at the bottom of an agent tab is framed by a rounded card, and the row under it
replaces pi's status footer.

## The card

```
╭─ ↑ 4 ──────────────────────────────── Agent-01 · 12.3k/200k ─╮
│ Describe your next change...  @ files  / commands            │
╰─ ↓ 2 more ───────────────────────────────────────────────────╯
```

- The top edge carries the working status while a turn runs, the mode badges (`[VIM]`, `[SHELL]`,
  and `↑ N` when editor rows are scrolled out of view), the tab name, and the exact context usage
  (`12.3k/200k`, or `?/200k` while the count is unknown). A turn in flight and a mode badge share
  the edge while they fit.
- The bottom edge carries `↓ N more` when the draft has rows below the visible window.
- The frame takes the editor's own border colour, so vim mode, shell mode and the thinking level
  keep the colours they had.
- The body keeps the card's side borders. The autocomplete menu stays outside them, indented by one
  cell.
- The context reading switches to the warning colour at 85% of the model's window.

The card needs ten columns. Below that the plain editor is used, so a working status always has
somewhere to go. The status degrades from its message to the spinner to a truncated spinner, the
badges give way to it, and it takes the tab name's place before it would disappear.

## The meta row

```
 anthropic/claude-sonnet-4-5    High   ~/proj/pi    # [██░░░░░░] 24.1%  * main
 ● pi-subagents
```

The model, the thinking level and the workdir sit on the left; the context meter and the git branch
on the right. The model reads as `<provider>/<model-id>`, so a session on a proxy or an aggregator
still names the provider it is really going through. The meter has eight cells and is green below
50%, accent from 50%, and red from 80%.

Every piece degrades in a fixed order as the terminal narrows: the branch goes first, then the
meter, then the workdir compacts segment by segment, and the model drops to its id alone before it
truncates. The right block is dropped whole rather than squeezing the workdir out of the row.

The second row appears when extensions publish status texts, and is hidden while vim mode is
active.

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
