# Mixcode Changelog

Own changes on top of pi. The upstream anchor lives in `UPSTREAM.json`.

Newest first, sections `Added` / `Changed` / `Fixed` / `Removed`. Entries say what changed
and why; the why is the part git does not keep. When merging a new upstream tag, insert a
boundary heading `## base pi vX.Y.Z — <date>` above the previous one and point
`## [Unreleased]` at the new tag.

## [Unreleased] — base pi v0.87.1

### Added

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

### Changed

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

### Fixed

- `install.sh` prepares each runtime in a separate directory and activates it only after
  compilation and all resource copies succeed. Failed installs leave the current version
  usable; previous runtimes remain intact for running processes, including on NFS. Wrapper
  paths and PATH instructions now quote shell characters literally.
- The tab bar's wrapped rows indented past the first agent chip, so a second row started under
  the second chip and left the first chip's column empty as if it were a continuation of the
  pinned Home chrome. They now line up under the first agent chip.
