# Upstream Drift

[中文文档](upstream-drift.zh.md)

Where this fork and upstream pi disagree. Upstream's pages are never patched for fork behavior —
that conflicts on every upstream merge — so the divergence is recorded here instead, in the same
commit that causes it.

## Behavior changes

| Area | Upstream | This fork | Reason |
| --- | --- | --- | --- |
| `install.sh` | release archives via `scripts/build-binaries.sh` | installs a complete runtime in `<prefix>/lib/mpi/release.*/`, then atomically replaces `<prefix>/bin/mpi`; retains previous runtimes | failed upgrades preserve the working installation, and running processes keep their resources on NFS |
| `app.thinking.cycle` default key | `shift+tab` | `alt+t` | `shift+tab` became `app.tab.previous` |
| Agent tabs | one session per terminal | several concurrent tabs, each with its own `AgentSessionRuntime` | [Agent Tabs](tabs.md) |
| Session deletion | deletes the selected session file | refuses while the owning tab has a turn in progress | another tab may still be writing that file |
| `app.model.cycleForward` default key | `ctrl+p` | no default key | `ctrl+p` opens the command palette |
| Quit | `ctrl+d` exits, no confirmation | `ctrl+q` (`ctrl+shift+q` on Windows and WSL) asks first; `ctrl+d` unchanged | [Command Palette and Quit Confirmation](command-palette.md) |
| Fullscreen transcript rendering | renders every message component each frame, then clips to the viewport | renders only the visible window (20 rows of overscan) and estimates unmeasured blocks at 4 rows | frame cost otherwise grows with the whole conversation |
| Transcript scrolling keys | `tui.altScreen.*` only | plus a modal surface (`/vim`, `j`/`k`/`gg`/`G`, prompt jumps) in fullscreen mode | mouse-free reading of long conversations |
| Editor frame while modal | thinking/bash border color | accent border, input and submit locked | vim mode owns input |
| MixCode Home | no such surface; the transcript always shows the active session | a `home` pseudo-tab lists every open agent with a conversation preview | [MixCode Home](home.md) |
| `left`/`right`/`up`/`down`/`enter`/`ctrl+f` | editor cursor, prompt history, submit | on Home they select, attach, send, and filter the roster; on agent tabs the editor keeps them | [MixCode Home](home.md) |
| App-action keybinding handlers | a handler that matches consumes the key | a handler may return `false` to decline it; the raw key data is passed in | the Home bindings must not take `up`/`down`/`left`/`right`/`enter` from the composer, and `enter` also matches a bare newline (`ctrl+j`) |
| Empty composer | draws nothing | on Home it names the target agent and frames the composer in the neutral thinking colour | the roster makes the target explicit, and Home has no thinking level of its own |
| Interactive console output | `console.log` and the other console methods write to the tty | painted into a bottom-centered `Notice` panel (not the transcript); `/console-history` opens the last 1,000 lines in the external editor with timestamp and emitting tab | [Console History](console-history.md) |
| Footer on Home | n/a (no Home surface) | the footer stays visible and keeps showing the bound session's model and context | the footer here is per-runtime chrome, not per-surface, so hiding it would need its own design |
| Extension widgets | fixed dock above/below the editor | at the chat tail by default, with a row budget and `/widgets`, since [`ui.inlineWidgets`](inline-widgets.md) defaults to on | a tall widget otherwise steals rows from the whole editor dock |
| Per-tab settings | none | `Inline widgets` also reads and writes `mixcode_settings.json`, shown in its own `Mixcode` section of `/settings` | MixCode settings stay out of pi's `settings.json` and out of its section |
| Settings list rows | one flat list of settings | `SettingItem` gained an optional `section` that renders a heading row | same as above |
| Docked widget stack | no cap; the layout shrinks the slots when space runs out | the above and below slots share a row budget, cut whole rows are marked `… (widgets truncated)` | a tall widget stack otherwise squeezes the chat and the dock chrome |

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
- `packages/coding-agent/src/modes/interactive/chat-viewport.ts`
- `packages/coding-agent/src/main.ts`
- `packages/coding-agent/src/modes/interactive/tui-renderer.ts`: forwards the host's clipboard callback to the alternate screen
- `packages/coding-agent/src/modes/interactive/theme/theme.ts`, `theme/dark.json`, `theme/light.json`,
  `theme/theme-json.ts`, `theme/theme-schema.json`: the `panelBg` background a framed card fills with
- `packages/coding-agent/test/extensions-runner.test.ts`
- `packages/coding-agent/test/interactive-tui.test.ts`: the copy confirmations pin the toast
- `packages/ai/src/api/openai-responses-shared.ts`: records the server-reported model on
  Responses streams as `AssistantMessage.responseModel`
- `packages/tui/src/layout-node.ts`: windowed layout node and scroll line provider
- `packages/tui/src/components/settings-list.ts`: optional `section` heading on `SettingItem`
- `packages/coding-agent/src/modes/interactive/components/settings-selector.ts`: the `Mixcode` section item
- `packages/coding-agent/src/modes/interactive/theme/theme.ts`: `getSettingsListTheme` heading style
- `packages/tui/src/layout.ts`: windowed scroll child, line provider on the scroll box
- `packages/tui/src/tui-alt-screen.ts`: reads content lines through the provider; public `scrollToPrompt`;
  an `onCopyResult` option lets the host confirm a clipboard write instead of the screen's own flash
- `packages/tui/src/index.ts`: exports for the windowed node and mouse dispatch
- `AGENTS.md`, `.gitignore`

The fork also adds keys to upstream's `keybindings.ts`, while
`core/mixcode/multi-tab/tab-manager.ts` and `tab-state.ts` are fork-owned.

## Paths that exist only in this fork

Nothing upstream references them, so they can never conflict:

- `MIXCODE.md` — fork rules
- `MIXCODE_CHANGELOG.md` — fork change log
- `UPSTREAM.json` — upstream version the fork sits on
- `.agents/skills/` — fork-local agent skills, including [manual TUI demos](../.agents/skills/mixcode-manual-e2e/SKILL.md)
- `docs/` — this directory
- `test-all.sh`, `run.sh`, `install.sh` — fork test runner, dev launcher, and local installer
- `packages/*/src/**/mixcode/`, `packages/*/test/mixcode/`, `packages/tui/test/mixcode-*.test.ts` — fork code and its tests
