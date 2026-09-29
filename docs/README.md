# Mixcode Fork Documentation

[中文文档](README.zh.md)

Fork-local documentation for this pi checkout. Upstream's own pages — `packages/*/docs/`,
package `README.md` and `CHANGELOG.md` files, and `src/**/*.md` — are left untouched, so fork
features are documented here instead: editing an upstream page would conflict on every upstream
merge. Every place where this fork's behavior and upstream's documentation disagree is listed in
[Upstream Drift](upstream-drift.md).

## Features

- **[Agent Tabs](tabs.md)**: several agents running side by side in one terminal — keybindings,
  commands, tab bar status, colors, persistence, and startup restore.
- **[Command Palette and Quit Confirmation](command-palette.md)**: `ctrl+p` lists every runnable
  command with fuzzy search, and `ctrl+q` asks before ending the session.
- **[Vim Mode](vim-mode.md)**: modal transcript navigation for the fullscreen transcript (entry,
  keys, per-tab behaviour, fullscreen requirement).
- **[Windowed Transcript](windowed-transcript.md)**: how the fullscreen transcript renders only
  the visible blocks, keeps the scroll range correct, and behaves under mouse input.
- **[Mouse Selection](mouse-selection.md)**: which surfaces a fullscreen drag may select, what the
  copied text leaves out, and how the selection is painted.
- **[MixCode Home](home.md)**: the landing surface that lists every open agent, previews the
  selected one's conversation, and starts or resumes sessions.
- **[Console History](console-history.md)**: console output is painted into a notice panel
  instead of the raw tty, and `/console-history` opens the last 1,000 captured lines in the
  external editor with their timestamps and emitting tab.
- **[Inline Widgets](inline-widgets.md)**: extension widgets in the chat tail instead of the
  editor dock — the setting, the per-tab toggle, the row budget, and `/widgets`.
- **[Extension Widget Row Budget](widget-layout.md)**: how the dock caps a widget stack, and how
  that cap differs from the per-widget line cap.
- **[Input Dock](input-dock.md)**: the rounded card around the composer, the tab name and exact
  context usage on its top edge, and the meta row that replaces pi's status footer.

## Fork Mechanics

- **[Upstream Drift](upstream-drift.md)**: what this fork changes against upstream, which
  upstream pages are stale because of it, and which files exist only here.
