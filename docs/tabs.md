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
| `/close-all-sessions` | Close every tab except the current one. Confirmation needs the word `CLOSE` typed in full; the session files are kept. |
| `/delete-session [yes]` | Close the current tab and move its session file to the trash, where `/resume-trash` can restore it. `yes` skips the confirmation. |
| `/delete-all-sessions` | Move every tab's session file to the trash and start fresh. Confirmation needs the word `DELETE` typed in full; a tab that is busy is refused before the panel opens. |
| `/resume` | Open the session selector; the picked session opens in a tab of its own, or focuses the tab that already holds it. |
| `/resume-trash` | Open the session selector over the trash: restore a deleted session to its original path and open it in a tab of its own, or remove it for good. |
| `/rename <title>` | Rename the current tab and its session. |
| `/tabs` | List the open tabs. |
| `/tab <index\|title>` | Focus an open tab. |
| `/jump` | Open the Tab Jump switcher. An argument reports `Usage: /jump`. |
| `/workdir [path]` | Move the current tab onto another working directory. With a path the move happens at once; without one a directory picker opens. See [Workdir](#workdir). |
| `/context-limit [tokens\|reset]` | Cap the current tab at a context window of its own. Without an argument a picker offers fractions of the model's window and a free-text row. The limit lasts for the session and ends with a model switch, a session replacement or a reload; see [Input Dock](input-dock.md). |
| `/new` | Replace the active tab's session with a fresh file, keeping the tab, its working directory, its model and its thinking level. The title returns to a free `Agent-NN` and the chip color goes with the session. Refused while a turn or a bash command is running. |
| `/reset` | Move the active tab's session leaf back to its root. The session file, its title and every entry stay, and the abandoned branches remain reachable in `/tree`. Refused while a turn or a bash command is running. See [Reset](#reset). |
| `/color [name\|clear]` | Set the current tab's chip color; without an argument or with `clear` the color is removed. |
| `/group-colored-tabs` | Sort tabs so colored ones lead, aggregated by color in palette order. |
| `/mark-done` | Flag the current tab as finished in the tab bar. |
| `/toggle-zen-mode` | Hide the focused tab's tab-bar chips so the transcript gets the row; the separator stays and reports the other agents. `tab` and `shift+tab` stop switching while it is on. See [Zen Mode](zen-mode.md). |

The session confirmations (`/close-session` and `/delete-session`) take `y` to confirm and `n` or
`esc` to cancel, in addition to the arrow-key selector. The two all-sessions commands are the
exception: their panels run only once the word `DELETE` (`/delete-all-sessions`) or `CLOSE`
(`/close-all-sessions`) has been typed in full.

A session confirmation is that tab's dialog: switching away parks it and the chip paints `?`, and
switching back puts it on the editor slot again, so a delete or a close is answered on the tab the
command was typed in instead of being lost with the switch.

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
| `ctrl+f` (`app.tabJump.toggleNonIdle`) | Keep only the tabs with something to report — working, waiting, failed, or finished-unread. Home never survives the filter, and a tab that is still coming up is not attention yet; a tab parked on an extension dialog is. |
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
`Error: workdir not found or not a directory: <path>`. A switch an extension refuses through
`session_before_switch` reports `Workdir change cancelled` and changes nothing, so the session and
its header keep the directory they had.

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
| `running` | `●` | A turn is running or compaction is in progress |
| `thinking` | `●` | Reasoning before output, same glyph as running |
| `error` | `x` | Last turn failed |
| `done` | `✓` | Flagged finished, or unread output |
| *waiting* | `?` | An extension dialog on the tab waits for an answer |

Glyph color comes from the theme: `error` uses the error color, a waiting tab the tool-title color,
`running`/`thinking` the accent color, and an unread completion the success color. An unread tab
that starts another run shows `●` while working; its unread flag remains until focused. A tab
showing `✓` stays emphasized (bold title) until it is focused. The active chip carries a leading
`▌` focus mark, or `▐` on a colored chip.

`?` outranks a completion badge, because the tab cannot move until the answer arrives. An error
glyph still wins over it; on a colored chip it shows as the glyph alone, like the other status
colors.

A highlight wave sweeps across the active tab's title: it reaches the right edge and returns in
2 s, then the title rests for 1 s before the next pass. The wave eases into each turnaround and
keeps the chip's own background, foreground, and focus mark; a colored chip inverts the lit cells
instead of recoloring them, because theme foregrounds have no contrast over a chip color.

While the focused agent is in [zen mode](zen-mode.md) the bar renders no chips. One separator row
stays and carries a dot per non-focused tab that is working, waiting, finished, or failed, so the
other agents are still visible without the row the chips took.

## Extension dialogs

An extension dialog belongs to the tab whose session opened it: a tool asking a question, a
permission prompt, a `select`/`confirm`/`input` from an extension, or an editor takeover. The dialog
is only shown while that tab is the one on screen. While it waits, a tab that is still loading keeps
its spinner and a settled one paints `?`.

A dialog opened by a background tab therefore does not appear over the agent the user is reading; it
parks on its own tab, and the tab bar says which tab waits for an answer. Switching to that tab puts
the dialog back as it was left (an overlay keeps its scroll position and its collapsed state), and
its answer resolves the waiting tool call there. Switching away parks it again, so an unanswered
question never blocks the tab in front. Home covers every tab, so a dialog parks there too: the
roster card reads `[input]` and the masthead counts the tabs that wait on the user.

An overlay dialog keeps its place in the TUI's overlay stack and is merely hidden while its tab is
behind another one. Nothing pops the stack for it, because a pop takes whatever sits on top, which
may belong to another surface.

## Colors

`/color <name>` accepts `red`, `green`, `yellow`, `blue`, `magenta`, `cyan`, `white`, `gray`, or
`clear`. Colors are stored per session id in `tab_colors`, so they survive a restart and drop
when `/new` starts a new session file. A name that is no longer in the palette is ignored when
the state file loads. `/group-colored-tabs` reorders tabs by palette order and persists the new
order.

## Titles

A tab opened without a title is named `Agent-01`, `Agent-02`, and so on, skipping titles already
in use. A title that is already taken gets `-1`, `-2`, … appended, and the uniquified name is
persisted.

The title names the session behind it: `/rename` writes that name into the session, and replacing
the session with an unnamed one (`/new`) drops a custom title back to a free `Agent-NN`. A title
that was already generated keeps its number. A resumed session names its own new tab: the name
recorded in the session file, or a free `Agent-NN` for a session nobody named.

Session name changes, including extension calls to `pi.setSessionName()`, update ordinary
tab titles even if they already have a name. Titles locked by a batch request keep the batch name.

## Persistence

Tab state is per working directory, in the directory mixcode-pi (`mpi`) also uses:

```text
<agentDir>/mixcode-pi/workdirs/<sha16(workdir)>/
  open_tabs.json      { version, sessionIds, updatedAt }   open set and order (authoritative membership)
  mixcode_state.json  { children, workdirs, tab_titles, tab_colors, startup_workdir, unseen_done }
```

`<agentDir>` is `PI_CODING_AGENT_DIR` or `~/.pi/agent`. The workdir is hashed the same way
mixcode-pi hashes it, so both agents share one directory: tabs opened in one appear in the other.

The files are written when the tab set, its order, a title, or a color changes, and once when
the process exits. Focusing a tab does not write them.

## Concurrency

Each tab's composer sends to its own session, so a prompt typed in one tab runs there even while
another tab's turn is in flight. Only a session without tabs routes through the single-prompt input
loop and its shared queue; that loop drains to whatever is focused when it unblocks, which is the
wrong tab in a multi-tab instance.

A queued local command (`alt+enter` with a local command, or `/follow-up <command>`) runs through the
shared composer, so its round mounts the tab that queued it before it executes: the round never acts
on, or enters the `up` history of, the tab that happened to be in front. `/batch` and Home's action
buttons mount the tab they act on the same way.

Two instances sharing the same workdir poll `open_tabs.json` every 2 seconds. Opening, closing,
reordering, and replacing a session publish changes relative to the last local layout, so an
instance that has not yet seen a peer's tab does not erase it. Peer changes run through the same
queue as local tab operations and do not steal editor focus. A running or compacting tab remains
open until idle, and a session whose file is not yet available is retried on a later poll.

Changed titles, colors, workdirs, and unread badges are merged per session under a lock;
unchanged local metadata is not republished over a peer's newer values. These locks coordinate
writers in this fork; other applications writing the same files need to follow the same locking
protocol. A filesystem that refuses both `link` and exclusive create makes the writer proceed
unlocked: each write still lands atomically, so only a concurrent merge can be lost.

Startup joins the stored layout without discarding peer entries. `--no-session` sessions do not
participate in shared persistence or polling.

## Settings

A `/settings` change is global and reaches the whole roster. Each tab owns a `SettingsManager`
loaded once when the tab is built, so the change first re-reads the settings file in every open tab
and re-applies the values a session copies out of its own manager (transport, steering and follow-up
modes, cache warming). A tab that pins the value in its project settings keeps that value. Parked
transcripts are dropped, so a tab switched to later rebuilds its rows under the new value, and a tab
that becomes focused re-reads the file too, which also picks up a settings file edited outside the
app.

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
reads `[input]` on its Home card while its chip keeps the loading spinner, until the dialog is
answered on that tab. It then finishes on its own: its rename is written to the shared tab set and
its transcript is warmed. A tab that fails to restore is marked `error` and the tabs behind it still
load.

## Session deletion

`/delete-session`, `/delete-all-sessions`, and the session selector refuse to delete a session
file that an open tab holds, and name that tab: it keeps appending to the path, so removing the file
under it leaves a headerless replacement that no restart can load. A tab with a turn or a `!`
command in progress reports what it is busy with instead, and `/delete-all-sessions` reports that
before it opens its panel. The two session commands also replace the session of the tab they keep, so
an extension that cancels `session_before_switch` cancels the delete with it and the file stays where
that tab writes.

`/delete-all-sessions` confirms on a typed word: the run starts only once `DELETE` has been entered in
full, so no single key confirms it, whether a stray `y`, Enter or a key sent into the terminal by another
process. `n` or the cancel chord dismisses the panel. `/close-all-sessions` uses the same panel with
the word `CLOSE`.

A deleted session stays deleted. The command removes the deleted ids from the shared layout itself, and a
start that still reads one of them skips that entry rather than rebuilding it as an empty tab. A
placeholder file an earlier start left under such an id moves to the trash, so it cannot shadow the
session `/resume-trash` restores.

## Reset

`/reset` moves the active conversation back to its session root: the leaf moves back to before the
first entry, so the next prompt starts a new root. The file, the entries already written, the tab and
its title all stay, and `/tree` still lists the branches the conversation left behind. `/new` is the
other direction, replacing the session with a fresh file and taking the tab's color with it. Reset
reports that there is nothing to do when the leaf is already the root, and is refused while a turn or a
bash command is running.
