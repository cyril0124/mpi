# MixCode Fork Documentation

[中文文档](README.zh.md)

Fork-local documentation for this pi checkout. Upstream's own pages — `packages/*/docs/`,
package `README.md` and `CHANGELOG.md` files, and `src/**/*.md` — are left untouched, so fork
features are documented here instead: editing an upstream page would conflict on every upstream
merge. Every place where this fork's behavior and upstream's documentation disagree is listed in
[Upstream Drift](upstream-drift.md).

## Features

- **[Agent Tabs](tabs.md)**: several agents running side by side in one terminal — keybindings,
  commands, the Tab Jump switcher (`ctrl+t` / `/jump`), tab bar status, colors, persistence, and
  startup restore.
- **[Command Palette and Quit Confirmation](command-palette.md)**: `ctrl+p` lists every runnable
  command with fuzzy search, and `ctrl+q` asks before ending the session.
- **[Vim Mode](vim-mode.md)**: modal transcript navigation for the fullscreen transcript (entry,
  keys, per-tab behaviour, fullscreen requirement).
- **[Zen Mode](zen-mode.md)**: `/toggle-zen-mode` hides the tab bar's chips, leaves the separator
  carrying the other agents' status dots, and takes `tab`/`shift+tab` out of tab switching.
- **[Windowed Transcript](windowed-transcript.md)**: how the fullscreen transcript renders only
  the visible blocks, keeps the scroll range correct, and behaves under mouse input.
- **[Mouse Selection](mouse-selection.md)**: which surfaces a fullscreen drag may select, what the
  copied text leaves out, and how the selection is painted.
- **[MixCode Home](home.md)**: the landing surface that lists every open agent, previews the
  selected one's conversation, and starts or resumes sessions.
- **[Console History](console-history.md)**: console output is painted into a notice panel
  instead of the raw tty, and `/console-history` opens the last 1,000 captured lines in the
  external editor with their timestamps and emitting tab.
- **[Provider Error Diagnostics](provider-errors.md)**: a failed model request records bounded
  `[provider-error]` facts in the console history, and `onProviderError` lets a caller observe the
  raw exception behind the formatted message.
- **[Inline Widgets](inline-widgets.md)**: extension widgets in the chat tail instead of the
  editor dock — the setting, the per-tab toggle, the row budget, and `/widgets`.
- **[Thinking Tail Preview](thinking-tail-preview.md)**: hidden thinking as a three-row tail with
  a live-then-frozen duration, the `ui.boxedHiddenThinking` setting, and the label override.
- **[Widget Layout](widget-layout.md)**: how the dock caps a widget stack, the per-widget line
  cap, and the `→` side panel that moves the widgets beside the chat.
- **[Input Dock](input-dock.md)**: the rounded card around the composer, the tab name and exact
  context usage on its top edge, and the meta row that replaces pi's status footer.
- **[Icons](icons.md)**: the glyph set of the dock meta row, the `ui.icons.mode` setting
  (`nerd`, `ascii`, `auto`), and the terminals `auto` recognises.
- **[Batch Scripts](batch-scripts.md)**: a Lua or TypeScript script that opens a fleet of agent
  tabs and dispatches prompts into them, from the CLI (`--batch`, `--batch-dry-run`) or the
  interactive `/batch` command.
- **[Skill Isolation](skill-isolation.md)**: `MPI_PROJECT_SKILLS_ONLY` keeps a session on the skills
  its workdir ships, dropping the user roots and the ancestor `.agents/skills` directories.

## Fork Mechanics

- **[Upstream Drift](upstream-drift.md)**: what this fork changes against upstream, which
  upstream pages are stale because of it, and which files exist only here.
