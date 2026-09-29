# Upstream Drift

[中文文档](upstream-drift.zh.md)

Where this fork and upstream pi disagree. Upstream's pages are never patched for fork behavior —
that conflicts on every upstream merge — so the divergence is recorded here instead, in the same
commit that causes it.

## Behavior changes

| Area | Upstream | This fork | Reason |
| --- | --- | --- | --- |
| `app.thinking.cycle` default key | `shift+tab` | `alt+t` | `shift+tab` became `app.tab.previous` |
| Agent tabs | one session per terminal | several concurrent tabs, each with its own `AgentSessionRuntime` | [Agent Tabs](tabs.md) |
| Session deletion | deletes the selected session file | refuses while the owning tab has a turn in progress | another tab may still be writing that file |
| `app.model.cycleForward` default key | `ctrl+p` | no default key | `ctrl+p` opens the command palette |
| Quit | `ctrl+d` exits, no confirmation | `ctrl+q` (`ctrl+shift+q` on Windows and WSL) asks first; `ctrl+d` unchanged | [Command Palette and Quit Confirmation](command-palette.md) |

## Upstream pages and source text that are now stale

Deliberately left unpatched:

| Page | Claim | Reality here |
| --- | --- | --- |
| `packages/coding-agent/docs/usage.md:49` | "Press `Shift+Tab` to cycle through supported levels" | the cycle key is `alt+t` |
| `packages/coding-agent/docs/keybindings.md:155` | `app.thinking.cycle` default `shift+tab` | default is `alt+t` |
| `packages/coding-agent/src/experimental/micro/README.md:30` | "Shift+Tab: cycle the current model's supported thinking levels" | micro's own status line reads the live binding, so only this hardcoded line is wrong |
| `packages/coding-agent/docs/keybindings.md:152` | `app.model.cycleForward` default `ctrl+p` | no default key; `ctrl+p` is `app.palette` |
| `packages/coding-agent/docs/models.md:33` | "`Ctrl+P` cycles through available models" | `ctrl+p` opens the command palette; only `shift+ctrl+p` still cycles, and backwards only |
| `packages/coding-agent/src/cli/args.ts:303` (source text) | `--models` help calls them "patterns for Ctrl+P cycling" | `ctrl+p` opens the command palette; the cycle keys are `shift+ctrl+p`, `alt+p` on Windows and WSL |

The pages above list neither the tab keybindings nor the tab slash commands; [Agent Tabs](tabs.md)
is the reference for both.

## Upstream files this fork edits

Every one of these is a merge conflict waiting to happen, so keep the edits down to the wiring
that calls into `mixcode/` code:

- `packages/coding-agent/src/modes/interactive/interactive-mode.ts`
- `packages/coding-agent/src/modes/interactive/components/session-selector.ts`
- `packages/coding-agent/src/modes/interactive/components/custom-editor.ts`
- `packages/coding-agent/src/core/keybindings.ts`
- `packages/coding-agent/src/core/slash-commands.ts`
- `packages/coding-agent/src/core/extensions/runner.ts`
- `packages/coding-agent/src/main.ts`
- `packages/coding-agent/test/extensions-runner.test.ts`
- `AGENTS.md`, `.gitignore`

## Paths that exist only in this fork

Nothing upstream references them, so they can never conflict:

- `MIXCODE.md` — fork rules
- `MIXCODE_CHANGELOG.md` — fork change log
- `UPSTREAM.json` — upstream version the fork sits on
- `docs/` — this directory
- `test-all.sh`, `run.sh` — fork test runner and dev launcher
- `packages/*/src/**/mixcode/`, `packages/*/test/mixcode/` — fork code and its tests
