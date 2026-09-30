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

`app.tab.previous` takes `shift+tab`, which upstream binds to `app.thinking.cycle`; this fork
moved the thinking cycle to `alt+t`. See [Upstream Drift](upstream-drift.md).

## Commands

| Command | Behavior |
| --- | --- |
| `/new-session [--focus\|--no-focus] [title]` | Open a tab with an optional title. Focuses the new tab unless `--no-focus` is given. An invalid argument reports `Usage: /new-session [--focus\|--no-focus] [title]`. |
| `/close-session [yes]` | Close the current tab, keeping its session file. `yes` skips the confirmation. |
| `/close-all-sessions` | Close every tab except the current one, after confirmation. |
| `/delete-session [yes]` | Close the current tab and delete its session file. `yes` skips the confirmation. |
| `/delete-all-sessions` | Delete every tab's session file and start fresh, after confirmation. |
| `/rename <title>` | Rename the current tab and its session. |
| `/tabs` | List the open tabs. |
| `/tab <index\|title>` | Focus an open tab. |
| `/workdir [path]` | Move the current tab onto another working directory. With a path the move happens at once; without one a directory picker opens. See [Workdir](#workdir). |
| `/color [name\|clear]` | Set the current tab's chip color; without an argument or with `clear` the color is removed. |
| `/group-colored-tabs` | Sort tabs so colored ones lead, aggregated by color in palette order. |
| `/mark-done` | Flag the current tab as finished in the tab bar. |
| `/toggle-zen-mode` | Hide the focused tab's tab-bar chips so the transcript gets the row; the separator stays and reports the other agents. `tab` and `shift+tab` stop switching while it is on. See [Zen Mode](zen-mode.md). |
| `/save-workspace <name>` | Save the current tab layout under a name. |
| `/restore-workspace <name>` | Reopen a saved layout, closing tabs that are not part of it. |
| `/delete-workspace <name>` | Delete a saved tab layout. |

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
`shift+tab` include it in the cycle, and clicking it opens [MixCode Home](home.md). Statuses and
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

## Persistence

Tab state is per working directory, in the directory mixcode-pi (`mpi`) also uses:

```text
<agentDir>/mixcode-pi/workdirs/<sha16(workdir)>/
  open_tabs.json      { version, sessionIds, updatedAt }   open set and order
  mixcode_state.json  { children, workdirs, tab_titles, tab_colors, startup_workdir, unseen_done }
  workspaces.json     named layouts
```

`<agentDir>` is `PI_CODING_AGENT_DIR` or `~/.pi/agent`. The workdir is hashed the same way
mixcode-pi hashes it, so both agents share one directory: tabs opened in one appear in the other.

A saved workspace stores `name`, `startup_workdir`, `updated_at`, `active_session_id`, and one
entry per tab (`session_id`, `session_path`, `title`, `workdir`, `model`, `thinking_level`).

## Startup restore

On startup the previous layout is restored only when the starting session is persisted and holds
no conversation turns — a fresh session, not `-r`/`--continue`. It restores at most 12 tabs
(`RESTORE_TAB_LIMIT`), reports the surplus instead of dropping it silently, skips session files
it cannot read, and closes the transient startup tab once the restored layout replaces it.
Titles and colors are re-applied from `mixcode_state.json`; default-named tabs are renumbered so
the dropped startup tab does not push them to the next free number.

## Session deletion

`/delete-session`, `/delete-all-sessions`, and the session selector refuse to delete a session
file whose tab has a turn in progress, and report why: another tab may still be writing it.
