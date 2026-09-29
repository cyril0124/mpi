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

## Fork Mechanics

- **[Upstream Drift](upstream-drift.md)**: what this fork changes against upstream, which
  upstream pages are stale because of it, and which files exist only here.
