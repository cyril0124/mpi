# Agent Tabs

[中文文档](tabs.zh.md)

Several agents run side by side in one terminal. Each tab owns its own session and its own
`AgentSessionRuntime`, so a tab can be streaming while another one sits idle. Upstream keeps a
single runtime host, so watching N agents there means N terminals.

## Keybindings

| Action | Keys |
| --- | --- |
| Next tab | `tab`, `ctrl+shift+right` (no-op while the focused agent is in [zen mode](zen-mode.md)) |
| Previous tab | `shift+tab`, `ctrl+shift+left` (same exception) |
| New tab | none — use `/new-session` |
| Close tab | none — use `/close-session` |
| Tab Jump | `ctrl+t`, also `/jump` |

`app.tab.previous` takes `shift+tab`, which upstream binds to `app.thinking.cycle`; this fork
moved the thinking cycle to `alt+t`. See [Upstream Drift](upstream-drift.md).

`app.tab.jump` takes `ctrl+t`, which upstream binds to `app.thinking.toggle`. That action keeps its
`ctrl+t` default, but the composer registers the jump handler first, so the chord opens Tab Jump and
the thinking toggle has no working key there unless it is rebound in `keybindings.json`. The compact
start-up instructions do not name the toggle, and `/hotkeys` reports it with a note that its chord is taken. See
[Tab Jump](#tab-jump) and [Upstream Drift](upstream-drift.md).

## Commands

| Command | Behavior |
| --- | --- |
| `/new-session [--focus\|--no-focus] [title]` | Open a tab with an optional title. Focuses the new tab unless `--no-focus` is given. An invalid argument reports `Usage: /new-session [--focus\|--no-focus] [title]`. |
| `/clone` | Copy the active branch into a new tab titled `<current title>-cloned`, and focus the new tab. The source tab keeps its session file and stays open, so the two tabs continue from the same conversation independently. |
| `/close-session [yes]` | Close the current tab, keeping its session file. `yes` skips the confirmation. |
| `/close-all-sessions` | Close every tab except the current one, after confirmation. |
| `/delete-session [yes]` | Close the current tab and move its session file to the trash, where `/resume-trash` can restore it. `yes` skips the confirmation. |
| `/delete-all-sessions` | Move every tab's session file to the trash and start fresh, after confirmation. |
| `/resume-trash` | Open the session selector over the trash: restore a deleted session to its original path, or remove it for good. |
| `/rename <title>` | Rename the current tab and its session. |
| `/tabs` | List the open tabs. |
| `/tab <index\|title>` | Focus an open tab. |
| `/jump` | Open the Tab Jump switcher. An argument reports `Usage: /jump`. |
| `/workdir [path]` | Move the current tab onto another working directory. With a path the move happens at once; without one a directory picker opens. See [Workdir](#workdir). |
| `/context-limit [tokens\|reset]` | Cap the current tab at a context window of its own. Without an argument a picker offers fractions of the model's window and a free-text row. The limit lasts for the session and ends with a model switch, a session replacement or a reload; see [Input Dock](input-dock.md). |
| `/reset` | Move the active tab's session leaf back to its root. The session file, its title and every entry stay, and the abandoned branches remain reachable in `/tree`. Refused while a turn or a bash command is running. See [Reset](#reset). |
| `/color [name\|clear]` | Set the current tab's chip color; without an argument or with `clear` the color is removed. |
| `/group-colored-tabs` | Sort tabs so colored ones lead, aggregated by color in palette order. |
| `/mark-done` | Flag the current tab as finished in the tab bar. |
| `/toggle-zen-mode` | Hide the focused tab's tab-bar chips so the transcript gets the row; the separator stays and reports the other agents. `tab` and `shift+tab` stop switching while it is on. See [Zen Mode](zen-mode.md). |
| `/save-workspace <name>` | Save the current tab layout under a name. |
| `/restore-workspace <name>` | Reopen a saved layout, closing tabs that are not part of it. |
| `/delete-workspace <name>` | Delete a saved tab layout. |

The session confirmations (`/close-session`, `/delete-session` and the two all-sessions variants)
take `y` to confirm and `n` or `esc` to cancel, in addition to the arrow-key selector.

## Tab Jump

`ctrl+t`, or `/jump`, opens a searchable overlay over the composer: one row for MixCode Home and
one for every open tab, in tab order, opening with the focused tab highlighted. The header row labels
the query and reports the match count (`matched/total tabs`, plus `non-idle` while the filter is on).
A row carries the same status glyph the tab bar paints (blank for Home, whose chip carries none), the
title with the query's characters marked, and the tab's id against the right edge. A tab that is still
coming up keeps its spinner here too.

| Key | Behavior |
| --- | --- |
| `up` / `ctrl+k` / `shift+tab` (`app.tabJump.selectPrevious`) | Move the highlight up, wrapping to the last row. |
| `down` / `ctrl+j` / `tab` (`app.tabJump.selectNext`) | Move the highlight down, wrapping to the first row. |
| any printable key | Filter the rows by tab title. |
| `ctrl+f` (`app.tabJump.toggleNonIdle`) | Keep only the tabs with something to report — working, failed, or finished-unread. Home never survives the filter, and a tab that is still coming up is not attention yet. |
| `enter` (`tui.select.confirm`) | Jump to the highlighted entry and close; with nothing left to select it just closes. |
| `esc` (`tui.select.cancel`) | Close without switching. |
| pointer | The wheel moves the highlight, motion underlines the row it is over, and a left click jumps to that row's tab. |

A list longer than the panel shows is cut around the highlight and marked with
`... (N more above)` / `... (N more below)`; the id column shows the whole id while the row has room
for it and its first characters when it does not, and any line the panel cannot hold ends in `...`.

A terminal that reports keys without the extended protocol sends `ctrl+j` and an Enter written as a
line feed as the same byte. This overlay reads that byte as `ctrl+j`, so it moves the highlight; an
Enter delivered as a carriage return jumps as usual.

The chord is ignored while the editor's `/` command popup is up. Both the chord and a chip click are
ignored while another surface already owns the keyboard — a floating overlay, or a selector in the
editor slot such as the session tree, the model picker or Resume — so two of them never stack.
Clicking the chip of the focused tab opens the same overlay. In [zen mode](zen-mode.md) this overlay is
the switcher: `tab` and `shift+tab` no longer switch tabs, but `ctrl+t` still opens this list.

## Workdir

`/workdir <path>` moves the current tab onto another working directory. The session itself keeps
running: the transcript is unchanged, the agent's cwd-bound services are rebuilt for the new
directory, and the session header records it, so resuming that session later starts in the same
place. A relative path resolves against the tab's current working directory and a leading `~`
expands to the home directory. Moving onto the directory the tab is already in reports
`workdir unchanged` and does nothing, and a path that is not an existing directory reports
`Error: workdir not found or not a directory: <path>`.

`/workdir` without a path opens the picker, which is the same surface the workdir badge in the meta
row opens. It browses directories, never files:

| Key | Behavior |
| --- | --- |
| `up` / `down` | Move the highlight through the listed directories. |
| `left` (`app.workdir.parent`) | Go to the parent directory, highlighting the one just left. Nothing happens at `/`. |
| `tab` (`app.workdir.enterDir`) | Walk into the highlighted directory. |
| `enter` (`tui.select.confirm`) | Apply the directory being browsed — not the highlighted row. |
| `ctrl+h` (`app.workdir.toggleHidden`) | Show or hide dot-directories. |
| `ctrl+u` (`app.workdir.clearQuery`) | Clear the filter. |
| `esc` (`tui.select.cancel`) | Close the picker without moving. |
| any printable key | Filter the rows by a case-insensitive substring of the directory name. A query holding `/` or starting with `~` becomes a single `custom path` row instead, and Enter applies the typed path. |

The panel opens with the browsing directory as a home-collapsed breadcrumb, its last row counts the
listed directories and names the keys, and a listing longer than the window is marked with
`... (N more above)` / `... (N more below)`. A move applies to the tab it was made in; the other tabs
keep theirs.

## Tab bar

The bar above the editor leads with a pinned `MixCode Home` chip and then shows one chip per
agent tab: status glyph, title, color. The Home chip carries no status glyph; `tab` and
`shift+tab` include it in the cycle, and clicking it opens [MixCode Home](home.md). Clicking the chip
of the tab that is already focused opens [Tab Jump](#tab-jump) instead of re-activating it. A chip
click while another surface owns the keyboard — a floating overlay, or an editor-slot selector such as
the session tree — is dropped rather than switching tabs behind it. Statuses and
their glyphs:

| Status | Glyph | Meaning |
| --- | --- | --- |
| `idle` | `-` | Open, not working |
| `running` | `●` | A turn is streaming |
| `thinking` | `●` | Reasoning before output, same glyph as running |
| `error` | `x` | Last turn failed |
| `done` | `✓` | Flagged finished, or unread output |

Glyph color comes from the theme: `error` uses the error color, an unread tab the success color,
`running`/`thinking` the accent color. A finished or unread tab stays emphasized (bold title)
until it is focused. The active chip carries a leading `▌` focus mark, or `▐` on a colored chip.

A highlight wave sweeps across the active tab's title: it reaches the right edge and returns in
2 s, then the title rests for 1 s before the next pass. The wave eases into each turnaround and
keeps the chip's own background, foreground, and focus mark; a colored chip inverts the lit cells
instead of recoloring them, because theme foregrounds have no contrast over a chip color.

While the focused agent is in [zen mode](zen-mode.md) the bar renders no chips. One separator row
stays and carries a dot per non-focused tab that is working, finished, or failed, so the other
agents are still visible without the row the chips took.

## Colors

`/color <name>` accepts `red`, `green`, `yellow`, `blue`, `magenta`, `cyan`, `white`, `gray`, or
`clear`. Colors are stored per session id in `tab_colors`, so they survive a restart and drop
when `/clear` starts a new session file. A name that is no longer in the palette is ignored when
the state file loads. `/group-colored-tabs` reorders tabs by palette order and persists the new
order.

## Titles

A tab opened without a title is named `Agent-01`, `Agent-02`, and so on, skipping titles already
in use. A title that is already taken gets `-1`, `-2`, … appended, and the uniquified name is
persisted.

The title names the session behind it: `/rename` writes that name into the session, and replacing
the session with an unnamed one (`/new`, or `/resume` onto a session nobody named) drops a custom
title back to a free `Agent-NN`. A title that was already generated keeps its number.

## Persistence

Tab state is per working directory, in the directory mixcode-pi (`mpi`) also uses:

```text
<agentDir>/mixcode-pi/workdirs/<sha16(workdir)>/
  open_tabs.json      { version, sessionIds, updatedAt }   open set and order (authoritative membership)
  mixcode_state.json  { children, workdirs, tab_titles, tab_colors, startup_workdir, unseen_done }
  workspaces.json     named layouts
```

`<agentDir>` is `PI_CODING_AGENT_DIR` or `~/.pi/agent`. The workdir is hashed the same way
mixcode-pi hashes it, so both agents share one directory: tabs opened in one appear in the other.

The files are written when the tab set, its order, a title, or a color changes, and once when
the process exits. Focusing a tab does not write them.

A saved workspace stores `name`, `startup_workdir`, `updated_at`, `active_session_id`, and one
entry per tab (`session_id`, `session_path`, `title`, `workdir`, `model`, `thinking_level`).

## Concurrency

Each tab's composer sends to its own session, so a prompt typed in one tab runs there even while
another tab's turn is in flight. Only a session without tabs routes through the single-prompt input
loop and its shared queue; that loop drains to whatever is focused when it unblocks, which is the
wrong tab in a multi-tab instance.

Two instances sharing the same workdir poll `open_tabs.json` every 2 seconds. Opening, closing,
reordering, and replacing a session publish changes relative to the last local layout, so an
instance that has not yet seen a peer's tab does not erase it. Peer changes run through the same
queue as local tab operations and do not steal editor focus. A running or compacting tab remains
open until idle, and a session whose file is not yet available is retried on a later poll.

Changed titles, colors, workdirs, and unread badges are merged per session under a lock;
unchanged local metadata is not republished over a peer's newer values. Named workspace updates
also lock their read-modify-write. These locks coordinate writers in this fork; other applications
writing the same files need to follow the same locking protocol.

Startup joins the stored layout without discarding peer entries. An explicit workspace restore
replaces the shared set and order, so other instances follow that layout on their next poll.
`--no-session` sessions do not participate in shared persistence or polling.

## Startup restore

On startup the previous layout is restored only when the starting session is persisted and holds
no conversation turns — a fresh session, not `-r`/`--continue`. Every recorded tab is restored,
skipping session files it cannot read, and the transient startup tab closes once the restored
layout replaces it — unless its id is part of that layout, in which case it stays as that tab.
Titles and colors are re-applied from `mixcode_state.json`; default-named tabs are renumbered so
the dropped startup tab does not push them to the next free number.

The layout appears in full before any of it is built: the tab bar gives every persisted tab a chip
straight away, and Home (the visible surface) lists every persisted tab as a card, each carrying its
spinner and the phase its tab is in. The tabs are then built one at a time, in the recorded order, so
one session is in memory at a time and the session that opens is MixCode Home — with the tab that was
focused last selected in the roster, not opened.

A tab whose extension opens a dialog from its `session_start` handler parks there rather than
finishing, and the queue moves on to the next tab instead of waiting for the answer. The parked tab
reads `waiting for input` on its Home card until the dialog is answered, then finishes on its own:
its rename is written to the shared tab set and its transcript is warmed. A tab that fails to restore
is marked `error` and the tabs behind it still load.

## Session deletion

`/delete-session`, `/delete-all-sessions`, and the session selector refuse to delete a session
file whose tab has a turn in progress, and report why: another tab may still be writing it.

## Reset

`/reset` moves the active conversation back to its session root: the leaf moves back to before the
first entry, so the next prompt starts a new root. The file, the entries already written, the tab and
its title all stay, and `/tree` still lists the branches the conversation left behind. `/new` is the
other direction, replacing the session with a fresh file. Reset reports that there is nothing to do
when the leaf is already the root, and is refused while a turn or a bash command is running.
