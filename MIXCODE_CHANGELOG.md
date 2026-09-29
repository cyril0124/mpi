# Mixcode Changelog

Own changes on top of pi. The upstream anchor lives in `UPSTREAM.json`.

Newest first, sections `Added` / `Changed` / `Fixed` / `Removed`. Entries say what changed
and why; the why is the part git does not keep. When merging a new upstream tag, insert a
boundary heading `## base pi vX.Y.Z — <date>` above the previous one and point
`## [Unreleased]` at the new tag.

## [Unreleased] — base pi v0.87.1

### Breaking Changes

- pi-tui's `ClipboardResult` reports the copied length as `graphemes` instead of `chars`, and the
  count is grapheme clusters rather than UTF-16 code units. The `WindowedWindow` type is renamed
  `RenderedLineWindow`. Both are exported from `@earendil-works/pi-tui`, so an importer of either
  needs the new name.

### Added

- User messages carry their send time at the right end of their first row (`Sep 29, 9:29 PM`),
  painted dim. The reading comes from the message's own timestamp, so a resumed session shows when each
  message was sent; the body renders narrow enough that no text can reach it, and a message without a
  timestamp is drawn exactly as before.
- Extension widget side panel: `→` (`app.widgets.panel`) on an empty composer opens a per-tab
  right-hand column that collects the above- and below-editor widgets beside the chat, so they stop
  stacking around the composer. The column carries a pinned `Widgets` title, a dim section rule per
  widget, and a `→ to close` hint; content taller than the panel scrolls with the wheel (routed by
  region, so chat keeps its own wheel), wide lines wrap rather than truncate, and hidden rows are
  marked `↑ more`/`↓ more`. Opening needs at least one widget and a terminal of at least 80 columns
  (a toast says why otherwise). A drag that starts on the panel selects within the panel only —
  points clamp to its body cells and releasing copies the text ANSI-clean without the frame, so a
  selection never crosses the chat/panel split in either direction.
- Input dock: the composer is framed by a rounded card whose top edge carries the working status,
  the mode badges (`[VIM]`, `[SHELL]`, `↑ N`), the tab name and the exact context usage
  (`12.3k/200k`), and whose bottom edge carries `↓ N more`. Under it sits one meta row with the
  model, the thinking level and the workdir on the left and an eight-cell context meter plus the git
  branch on the right, followed by the extension status row. Both replace pi's flat editor rules and
  its status footer, so the dock states which agent and which context the input belongs to
  without a separate header. The card needs ten columns; below that the plain editor is kept so the
  working status always has a row. See [Input Dock](docs/input-dock.md).
- The empty composer now hints in every state instead of only on Home: `Describe your next
  change...  @ files  / commands  ← Home · → widgets` on an agent tab, and the vim navigation keys
  while vim mode owns the input. The two key labels are read from the keybindings, so a rebound key
  keeps the hint honest; the widgets half is dropped in TUI modes that do not split the chat, where
  the key does nothing.
- Mouse drag selection: a drag now selects only inside the transcript, the prompt card and the
  notice panel, and the copied text is cleaned per surface, so dragging over the prompt card or the
  notice no longer pastes that surface's frame and key-hint rows. Wide characters are kept whole,
  the selection is painted with the theme's `selectedBg` (re-opened after every SGR, so a block
  background cannot swallow it), and releasing copies through the existing toast. A press also pins a
  following transcript for as long as the button is down, so output that streams in during a drag
  cannot slide the selected rows away; releasing leaves the transcript where the user left it when
  output arrived or they scrolled it, and a press that moved nothing follows again. The text cleanup
  lives in `core/mixcode/selection/chat-selection.ts` and the surface registry in
  `modes/interactive/mixcode/selection/`; pi-tui keeps owning the drag, the slicing and the edge
  auto-scroll. See [Mouse Selection](docs/mouse-selection.md).
- Follow-up queues with `/follow-up`: user follow-ups no longer ride the SDK follow-up queue.
  `alt+enter` and `/follow-up <message>` queue host-side rounds (an exclusive round each, or merged
  into one round with `/follow-up --batch <message>`) that dispatch one prompt turn per round when
  the agent goes idle. A failed run, compaction failure, or dispatch error pauses the queue (shown
  as `Paused · /follow-up to resume`), `/follow-up` without a message resumes it, and a queued local
  command (e.g. `/follow-up /model <id>`) runs host-side when its round arrives. Queued texts draw
  as boxed previews above the editor: `Steer (n)` with `Esc->send now` and `ctrl+u->edit` hints,
  `Follow-up (n)` with `Round k · next|command · <text>` numbering and `SDK ·` companions, showing
  the latest five entries of each queue. Esc with queued steer texts aborts the run and sends them
  as one immediate turn without promoting follow-up rounds, and `ctrl+u` pops a single queue entry back
  into the editor (`ctrl+u` then `s`/`f` picks the queue when both are queued) (steer/follow-up choice toast when both are queued). Backed by a new
  `AgentSession.removeQueuedMessages`/`restoreQueuedMessages` dequeue API and an
  `Agent.removeQueuedMessages`/`restoreQueuedMessages` queue splice.

- Toast notifications: a typed card in the top-right corner of the transcript, with a rounded frame,
  an icon and color per kind, a width that follows the terminal, and a three second lifetime. The
  copy command reports through it, a failing copy reports the error, and closing the last tab
  reports the refusal; vim's entry prompt and message-jump notices use it too. The card fills its
  cells with a new `panelBg` theme background, so it reads as a surface instead of an outline.
- Interactive console output: `console.log`, `console.info`, `console.debug`, `console.warn` and
  `console.error` no longer write raw text onto the tty from interactive mode, where it corrupted
  the frame and duplicated the tab bar. Their output is prefixed with `[console.<method>]:` and
  painted into a bottom-centered `Notice` panel that does not take focus, wraps long lines, and
  stops growing at about 60% of the terminal. `c`/`y` copies it (`app.notice.copy`), `Esc`/`q`
  closes it (`app.notice.dismiss`), and `/console-history` opens the last 1,000 lines in the
  external editor, with their timestamps and the tab that emitted each one. See [Console History](docs/console-history.md).
- `mixcode-manual-e2e` skill: creates user-runnable TUI demos through this checkout's
  source launcher, with local faux models, isolated runtime state, and per-state evidence.
- Command palette: `ctrl+p` (`app.palette`) opens a fuzzy-searchable list of every command the UI
  can run (built-ins, extension commands, skill commands, prompt templates), floating over the
  draft and painting the characters the query matched. Enter submits the selection through the
  normal command path, so arguments, gating and error messages match typing the command, and the
  draft comes back once the command is done with the editor. `/palette` opens the same list.
- A quit confirmation: `ctrl+q` (`app.quit`) asks with a `y`/`n` panel before shutting down,
  so a stray chord cannot end a session mid-task. `/quit` still quits without asking.
- `install.sh` at the repo root: builds the workspace and installs a standalone `mpi`
  binary under a prefix (default `~/.local`). The compiled binary resolves themes,
  export templates, docs, and native prebuilds from its own directory, so the binary
  lives in a versioned directory under `<prefix>/lib/mpi/` and `<prefix>/bin/mpi`
  is a wrapper that execs it.
  `scripts/build-binaries.sh` stays the release-archive path; this covers single-machine
  installs.
- Multi-tab agent sessions: several agents run side by side in one terminal, each tab
  owning its own `AgentSessionRuntime`. Upstream keeps a single runtime host, so watching
  N agents otherwise means N terminals.
- A tab bar above the editor showing each tab's title, one of eight named colors, and a
  live status (`idle`, `running`, `thinking`, `error`, `done`), so a tab's state is visible
  without switching to it.
- A shimmer wave on the focused tab's title, so the focused chip is obvious without a second
  color cue: the wave sweeps to the right edge and back over 2 s, rests for 1 s, and eases
  into each turnaround. A colored chip inverts the lit cells instead, because theme
  foregrounds have no contrast over a chip color.
- Open tabs and named workspace layouts persist per workdir as `open_tabs.json` and
  `workspaces.json` in the agent state directory, so a restart reopens the same tabs.
- Tab slash commands: `/new-session`, `/close-session`, `/close-all-sessions`,
  `/delete-session`, `/delete-all-sessions`, `/rename`, `/tabs`, `/tab`, `/color`,
  `/group-colored-tabs`, `/mark-done`, plus the workspace commands `/save-workspace`,
  `/restore-workspace`, `/delete-workspace`. `app.tab.new` and `app.tab.close` ship unbound,
  so the commands are the only way to open or close a tab.
- Keybindings `app.tab.next` (`tab`, `ctrl+shift+right`) and `app.tab.previous`
  (`shift+tab`, `ctrl+shift+left`).
- Vim mode for the fullscreen transcript: `/vim`, or `ctrl+u` then `u`/`ctrl+u` from an
  empty editor, then `q` to leave. `j`/`k` scroll 3 rows, `ctrl+u`/`ctrl+d` page,
  `gg`/`G` jump to the ends, and `right`/`shift+right` jump between user messages. Every
  key is a configurable `app.vim.*` action. See [Vim Mode](docs/vim-mode.md).
- Windowed transcript rendering: the fullscreen scroll view's child reports a virtual row
  count and renders only the visible blocks, so frame cost stays bounded on long
  conversations instead of growing with the whole transcript. Unmeasured blocks contribute
  an estimated height, and the window is assembled from the nearest end so new output cannot move
  the rows above it. See
  [Windowed Transcript](docs/windowed-transcript.md).
- pi-tui windowed layout node (`WindowedLayoutState` / `WINDOWED_NODE`), so any component
  can serve a line window to a scroll view. Transcript search and prompt jumps read the
  full line range through the same provider.
- MixCode Home: a `home` pseudo-tab listing every open agent with a status chip, model,
  context usage, recency, and the newest output, plus a conversation pane beside the roster
  on wide terminals. It starts and resumes sessions from its heading, and `left` on an empty
  composer returns to it. Sending from Home targets the highlighted agent without attaching;
  `/commands` and `!shell` lines attach first, and a message to a busy agent steers its turn.
  See [MixCode Home](docs/home.md).
- Keybindings `app.home.selectPrevious`, `app.home.selectNext`, `app.home.attach`,
  `app.home.send`, `app.home.returnHome`, `app.home.toggleNonIdle` (defaults `up`, `down`,
  `right`, `enter`, `left`, `ctrl+f`). Each declines the key whenever Home is not the active
  surface, so the composer keeps them on agent tabs.
- MixCode Home lists outdated extension packages above the roster, with the command that updates
  them, when the startup check finds any.
- MixCode Home hides the footer, the working indicator and the extension widgets while it is shown:
  the working directory, the usage and model line, the statuses and those widgets are per-agent
  chrome.
- MixCode Home names the target of the next message in the empty composer
  (`Send to <agent>...  @ files  / commands`, or `Select an agent...` with an empty roster) and frames
  the composer in the neutral thinking colour, since Home has no agent of its own.
- `MIXCODE_DISPLAY_WORKDIR` and `MIXCODE_DISPLAY_MODEL` mask the workdir and model shown on
  MixCode Home, so a recording can hide the real paths and provider.
- Response model mismatch notice: when a provider answers with a model other than the one
  requested, the transcript says so under that reply
  (`[Model mismatch] requested X → returned Y · via provider`). Restoring a session or
  switching a branch brings them back, because they derive from the `responseModel` metadata
  each assistant message carries. The OpenAI Responses adapters (OpenAI, Azure, Codex) now
  capture that metadata, alongside the existing Anthropic Messages and OpenAI Completions
  capture. Shown with the `showCacheMissNotices` setting; the message itself keeps its
  requested model and persisted content.
- Inline widget mode: extension widgets render at the tail of the chat instead of the editor
  dock, behind a viewport-derived row budget that collapses whole widgets to `▸ Inline · <key>`
  headers. `ui.inlineWidgets` in `mixcode_settings.json` sets the global default (on), `/settings`
  has an `Inline widgets` row in its own `MixCode` section, `/toggle-inline-widgets` switches one
  tab, and `/widgets expand|collapse|toggle [key]` steers the collapse state. See
  [Inline Widgets](docs/inline-widgets.md).
- A dock row budget for extension widgets: the slots above and below the editor share one budget
  derived from the terminal height, so a tall widget stack cannot squeeze the chat and the dock
  chrome. Overflow rows are marked with a dim `… (widgets truncated)`, a partly shown widget keeps
  the rows it shows, and the budget is re-decided every frame. See
  [Extension Widget Row Budget](docs/widget-layout.md).
- `core/mixcode/mixcode-settings.ts` reads and writes `mixcode_settings.json` in the state
  directory shared with mixcode-pi, so both agents see the same global settings.
- Pointer hover feedback: passive mouse motion highlights what a click would hit, without
  moving the keyboard selection, the active tab, the editor draft, or the scroll position.
  Tab chips, command-palette rows and the transcript blocks that answer a click (agent tool
  calls, compaction and branch summaries, skill invocations, the thinking block) paint the
  hovered cells with the selection background and an underline, so the cue stays visible in a
  monochrome theme; a block is painted as one rectangle, row padding and blank rows included,
  and the jump-to-end label underlines while the pointer is over it. A primary click anywhere
  on a block expands or collapses it. The fullscreen renderer tells the component under the
  pointer when the pointer leaves it, drops the cue when an overlay is open, and drops it when
  the terminal is resized. Hover needs all-motion mouse reporting, which the fullscreen
  renderer only asks for outside tmux, zellij and screen.
- Hidden thinking as a tail: with hiding on, each thinking block renders as a three-row tail that
  follows the stream — a `Thinking` header whose duration ticks live and freezes when the block
  stops growing, then the last three visual rows of the reasoning behind a left rail, with `…` on
  the first row when earlier content was dropped. A `setHiddenThinkingLabel` override still
  replaces the whole block. The `Thinking tail preview` row in `/settings` (`ui.boxedHiddenThinking`
  in `mixcode_settings.json`) turns it off, and it defaults to on.

### Changed

- The composer card holds its text one column further from the left border: the draft, the empty
  composer's placeholder and the autocomplete menu all move right by one cell, the card's right edge
  stays where it was, and a click is translated so it still lands on the character under it. A pointer
  selection over the draft now copies its leading spaces intact as well, which the old inset ate.
- The dock meta row's model and thinking level are click targets: the pointer lights the field up
  with the same hover cue the tab bar and the command palette use, and a left click opens that
  field's picker, so the model selector and the thinking selector are reachable with the pointer
  instead of only through `/model`, `/models` and `Alt+T`. The regions are computed from the row
  that was rendered last, so a truncated or compacted row never answers for cells it no longer
  paints, and a click on a gap, on the context meter or on the git branch stays inert. The workdir
  is deliberately not clickable: the fork has no workdir picker.

- `/settings` is a centred floating panel in the MixCode style instead of a selector that replaces the
  editor area: a framed surface titled `Settings`, a dim `filter: type to filter  N/N` line in place of
  the search input, a `Pi` / `MixCode` heading above each settings file's path, `›` rows with the label
  and the value in their own columns, booleans shown as `On`/`Off`, the selected item's description,
  and one key-hint footer row. The draft and the transcript stay visible behind the panel, so opening
  settings no longer costs the composer its place. Choosing `TUI mode` takes the panel down before
  switching, because a mode switch refuses while an overlay is open. The items, the submenus and the
  fuzzy filter are pi's own and are unchanged. See [Upstream Drift](docs/upstream-drift.md).

- The default TUI mode is `fullscreen` instead of pi's `regular`, so an installation that never set
  `tuiMode` opens on the alternate screen, where the fork's transcript features live. An explicit
  `tuiMode: "regular"` in `settings.json` keeps the plain transcript; `/settings` switches between
  the two.
- The built-in footer is now the dock meta row. pi's footer rows (the working directory with the
  session name, then the token and cost totals with `percent (auto)` beside the right-aligned model
  and thinking level) are gone from the dock: the card's top edge carries the name and the exact
  token counts, and the meta row carries the rest. The `(auto)` marker, the cumulative `↑ ↓ R W`
  and cache-hit line, the cost total, and the `(sub)` subscription and `• xp` markers are no longer
  drawn there; `/session` still prints the token, cache and cost sections, and `/settings` still
  reports auto-compaction. See [Input Dock](docs/input-dock.md).
- The fullscreen transcript's clipboard confirmation: the alternate screen hands the result to the
  host through a new `onCopyResult` option, so a mouse-selection copy reports with the same toast as
  the copy command instead of the screen's own one-line flash.
- `app.model.cycleForward` ships with no default key, because `ctrl+p` now opens the command
  palette; `shift+ctrl+p` (`alt+p` on Windows and WSL) still cycles backwards.
- On Windows and WSL the quit chord is `ctrl+shift+q`, keeping `ctrl+q` for
  `app.message.followUp`, the only follow-up chord those terminals deliver.
- `/hotkeys` lists the palette and quit chords.
- `app.palette` and `app.quit` join the keybindings an extension shortcut may not override, so a
  loaded extension cannot take the palette or the quit chord out from under the user.
- `app.thinking.cycle` moved from `shift+tab` to `alt+t`, because `shift+tab` now switches
  tabs.
- Session deletion refuses while the owning tab has a turn in progress, and reports why;
  another tab may still be writing that session file.
- Session file deletion moved from the session selector into
  `core/mixcode/session-delete.ts`, so the selector and the tab commands share one
  implementation.
- The fullscreen transcript is the windowed container instead of the document container;
  regular mode still mounts the document container unchanged.
- `TuiAltScreen.scrollToPrompt(direction)` is public and returns whether a prompt was
  found, for the alternate screen's own prompt keys. It clamps its search to the rows that exist,
  because a windowed child keeps a virtual line count.
- `LayoutBox.scrollContentLines` is replaced by a `ScrollLineProvider` on the scroll box, so
  search, prompt jumps, selection and image cropping read a windowed transcript on demand. The
  provider's `materialize()` renders the whole document exactly, which is what search and copy
  use; the line count stays an estimate so the scroll range needs no full render.
- `createChatViewport` accepts a `widgetsVisible` predicate, so a surface that wants the widget
  rows can hide both slots.
- `CustomEditor.onAction` handlers may return `false` to decline a key, which then reaches the
  editor. Existing handlers are unaffected; the Home bindings rely on it.
- `CustomEditor.onAction` handlers may return `false` to decline a key, which then reaches the
  editor. Existing handlers are unaffected; the Home bindings rely on it.
- pi-tui's `SettingItem` gained an optional `section`; consecutive items sharing one render under
  a heading row, which is how the `MixCode` group stays apart from pi's own settings.
- The dock's widget slots are `DockWidgetBudget` components instead of plain containers, so the
  slots decide per frame what fits and forward mouse rows to the widget they came from.
- The fork code went through a readability pass, because most of it was written in one burst and
  the same helper had been written twice in several places. The duplicated terminal-text
  sanitizer, the per-tab Home caches, the transcript-notice and external-editor paths, the tab
  bar's overflow hints and the scroll-box assembly in pi-tui's layout now each have one
  implementation, and names, comments and magic numbers were brought back in line with what the
  code does. No behaviour change beyond the fixes below and the renames above.
- `TuiAltScreen`'s `scrollToEndIndicator` callback now receives whether the pointer is over
  the label, so a caller can style the hovered state.

### Fixed

- Vim mode swallowed `ctrl+q` (`app.quit`), so the quit confirmation could not be opened while the modal
  surface was active. Quit now passes through, like tab switching and tool expansion. See
  [Vim Mode](docs/vim-mode.md).
- Vim mode could only be entered from an idle session: an empty-editor `ctrl+u` declined while the agent was
  streaming or compacting, so the key fell through to its non-vim handler and the confirming `u` was typed into
  the composer. Entry now needs only an empty composer and no queued message, so the modal reading surface can be
  opened while output is arriving, which is when it is most useful. See [Vim Mode](docs/vim-mode.md).
- Extensions loaded under `run.sh` (bun executing the built dist) resolved their
  `@earendil-works/*` imports through ambient `node_modules` (e.g. symlinks under
  `~/.pi/agent/node_modules` pointing into another checkout) instead of the running
  host, so renderer extensions such as `mpi-tool-display` silently fell back to the
  built-in tool rows and lost the bash `description` label. The bun-dist runtime now
  routes extension imports through `virtualModules` like the compiled binary, pinning
  the specifiers that map lists to the host's own module instances; subpaths outside
  the map still resolve normally. Unbundled Node keeps the dist aliases, and bun
  running the TypeScript source (`PI_DEV=1`) stays on the source branch.
- Vim mode no longer survives a switch to MixCode Home. Tabbing from a tab in vim mode onto Home
  left the modal surface active over a page that is neither a tab nor a transcript: the composer
  swallowed every key, so no message could be typed for the roster's selected agent. Home now leaves
  vim mode, which also stops the input card from claiming `[VIM]` there. See
  [Vim Mode](docs/vim-mode.md).
- The copy confirmation counted UTF-16 code units, so an emoji or a combining sequence was
  reported as two or more characters. It counts grapheme clusters now, the unit the terminal
  paints as one character.
- The fork's settings group was labelled `Mixcode` while the rest of the UI says `MixCode`.
- The dock's truncation marker painted the muted colour while the feature describes one `dim` row;
  it paints `dim` now.
- The vim entry and top-jump notices name the keys bound to those actions instead of the shipped
  defaults, so a rebind no longer leaves a notice naming a key that does nothing. The `/vim`
  command description no longer names the leave key at all, for the same reason.
- `install.sh` prepares each runtime in a separate directory and activates it only after
  compilation and all resource copies succeed. Failed installs leave the current version
  usable; previous runtimes remain intact for running processes, including on NFS. Wrapper
  paths and PATH instructions now quote shell characters literally.
- The tab bar's wrapped rows indented past the first agent chip, so a second row started under
  the second chip and left the first chip's column empty as if it were a continuation of the
  pinned Home chrome. They now line up under the first agent chip.
