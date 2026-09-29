# Mixcode Changelog

Own changes on top of pi. The upstream anchor lives in `UPSTREAM.json`.

Newest first, sections `Added` / `Changed` / `Fixed` / `Removed`. Entries say what changed
and why; the why is the part git does not keep. When merging a new upstream tag, insert a
boundary heading `## base pi vX.Y.Z — <date>` above the previous one and point
`## [Unreleased]` at the new tag.

## [Unreleased] — base pi v0.87.1

### Added

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

- `app.thinking.cycle` moved from `shift+tab` to `alt+t`, because `shift+tab` now switches
  tabs.
- Session deletion refuses while the owning tab has a turn in progress, and reports why;
  another tab may still be writing that session file.
- Session file deletion moved from the session selector into
  `core/mixcode/session-delete.ts`, so the selector and the tab commands share one
  implementation.
