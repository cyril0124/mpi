# Zen Mode

[中文文档](zen-mode.zh.md)

Press `/toggle-zen-mode` and the chips that name every open agent give up their row. The separator
rule under them stays, and it keeps reporting the one thing the chips said: which of the other
agents is working, finished, or failed.

```text
── ● ⠹ [+1] ────────────────────────────────────────────────────────────────

  transcript

── [ZEN] ────────────────────────────────────────────── Agent-03 ───────────
```

## Status dots

One dot per non-focused tab that is working, finished, or failed, in tab order, left-anchored on
the separator. An idle tab contributes none, unless it carries unread output:

| Dot | Tab state |
| --- | --- |
| `⠋ ⠙ ⠹ …` accent | running or thinking; the frames advance while it works |
| `●` success | finished, including a tab flagged done with `/mark-done` that you have not opened yet |
| `●` error | the last turn ended in an error |

The leading dashes and the rest of the rule keep the separator's own colour, so zen reads as the
same frame the editor uses. Past five dots the rest collapse into ` [+N]`; when even that does not
fit, `[+N]` goes first and then the dots, and the row falls back to a plain rule rather than
truncating.

## Keys and switching

`tab` and `shift+tab` are swallowed while zen is on. Hiding the bar means losing the surface that
shows where focus went, so switching stays a deliberate act:

| Action | How |
| --- | --- |
| Focus an agent | `/tab <index\|title>`, or a chip click once zen is off |
| Leave zen | `/toggle-zen-mode` |
| Reach Home | `left` with an empty composer still opens Home; Home shows the full bar again |

While the completion popup is open `tab` still completes, and an extension dialog owns the key
before zen sees it.

## Migration

Zen is a per-tab flag that follows focus, like vim mode: focusing another agent hands zen to it and
clears it on the agent you left, and at most one tab is in zen. Opening a tab focuses it, so a tab
created with `/new-session` or opened from a workspace takes zen over from the agent that had it.
Home is a different surface, not a tab, so opening it puts the full tab bar back and leaves zen on
the agent behind it. Closing the tab that holds zen ends zen with it, because the tab it belonged to
is gone.

Nothing about zen is written to the tab layout state, so a session restored at startup has the bar.

The `[ZEN]` badge on the input card's top edge names the mode, beside `[VIM]` and `[SHELL]`, and
disappears with the card's other mode labels when the terminal is too narrow for it.
