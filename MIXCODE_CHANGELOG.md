# Mixcode Changelog

Own changes on top of pi. The upstream anchor lives in `UPSTREAM.json`.

Newest first, sections `Added` / `Changed` / `Fixed` / `Removed`. Entries say what changed
and why; the why is the part git does not keep. When merging a new upstream tag, insert a
boundary heading `## base pi vX.Y.Z — <date>` above the previous one and point
`## [Unreleased]` at the new tag.

## [Unreleased] — base pi v0.87.1

### Added

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
  lives in `<prefix>/lib/mpi/` and `<prefix>/bin/mpi` is a wrapper that execs it.
  `scripts/build-binaries.sh` stays the release-archive path; this covers single-machine
  installs.
- Multi-tab agent sessions: several agents run side by side in one terminal, each tab
  owning its own `AgentSessionRuntime`. Upstream keeps a single runtime host, so watching
  N agents otherwise means N terminals.
- A tab bar above the editor showing each tab's title, one of eight named colors, and a
  live status (`idle`, `running`, `thinking`, `error`, `done`), so a tab's state is visible
  without switching to it.
- Open tabs and named workspace layouts persist per workdir as `open_tabs.json` and
  `workspaces.json` in the agent state directory, so a restart reopens the same tabs.
- Tab slash commands: `/new-session`, `/close-session`, `/close-all-sessions`,
  `/delete-session`, `/delete-all-sessions`, `/rename`, `/tabs`, `/tab`, `/color`,
  `/group-colored-tabs`, `/mark-done`, plus the workspace commands `/save-workspace`,
  `/restore-workspace`, `/delete-workspace`. `app.tab.new` and `app.tab.close` ship unbound,
  so the commands are the only way to open or close a tab.
- Keybindings `app.tab.next` (`tab`, `ctrl+shift+right`) and `app.tab.previous`
  (`shift+tab`, `ctrl+shift+left`).

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
