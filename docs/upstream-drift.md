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
| Transcript scrolling keys | `tui.altScreen.*` only | plus a modal surface (`/vim`, `j`/`k`/`gg`/`G`, prompt jumps with a `User Messages` preview panel) in fullscreen mode | mouse-free reading of long conversations |
| Default TUI mode | `regular` | `fullscreen`; an explicit `tuiMode: "regular"` in `settings.json` still selects the plain transcript | the fork's reading features (windowed transcript, vim, mouse selection) only exist on the alternate screen, and upstream's `packages/coding-agent/docs/settings.md` still lists `"regular"` as the default |
| Editor frame while modal | thinking/bash border color | accent border, input and submit locked | vim mode owns input |
| MixCode Home | no such surface; the transcript always shows the active session | a `home` pseudo-tab lists every open agent with a conversation preview | [MixCode Home](home.md) |
| `left`/`right`/`up`/`down`/`enter`/`ctrl+f` | editor cursor, prompt history, submit | on Home they select, attach, send, and filter the roster; on agent tabs the editor keeps them | [MixCode Home](home.md) |
| App-action keybinding handlers | a handler that matches consumes the key | a handler may return `false` to decline it; the raw key data is passed in | the Home bindings must not take `up`/`down`/`left`/`right`/`enter` from the composer, and `enter` also matches a bare newline (`ctrl+j`) |
| Empty composer | draws nothing | agent tabs hint `Describe your next change...  @ files  / commands  ← Home · → widgets`, vim tabs list the navigation keys, and Home names the target agent in the neutral thinking colour | the roster makes the target explicit, Home has no thinking level of its own, and the composer states what it accepts; the two key labels are read from the configured keybindings, and the widgets half is left out in TUI modes that do not split the chat |
| Interactive console output | `console.log` and the other console methods write to the tty | painted into a bottom-centered `Notice` panel (not the transcript); `/console-history` opens the last 1,000 lines in the external editor with timestamp and emitting tab | [Console History](console-history.md) |
| Prompt editor frame | two flat rules above and below the composer | a rounded card whose top edge carries the working status, the mode badges, the tab name and the exact context usage, and whose body holds its text one column off the left border | the input area names the agent and its context without a separate header row; see [Input Dock](input-dock.md) |
| Editor dock footer | two rows: pwd with the session name, then token and cost totals with `percent (auto)` beside the right-aligned model and thinking level, plus an extension status row when one is registered | one meta row: model, thinking and workdir, an eight-cell context meter and the git branch, then the extension status row; the model, the thinking level and the workdir answer a click, opening their pickers | the card's top edge already carries the name and the exact token counts, the model label names its provider, and the meter reads faster than a percentage; see [Input Dock](input-dock.md) |
| Footer on Home | n/a (no Home surface) | Home parks the dock footer, so it carries no meta row | the roster already names each agent and shows its context, and Home has no session of its own |
| Working directory | fixed at startup: `--workdir`, or the process cwd; a session keeps it for its whole life | `/workdir [path]` moves the active tab onto another directory, and the meta row's workdir badge opens the picker | pointing a tab at another project should not mean restarting the agent; see [Workdir](tabs.md#workdir) |
| Extension widgets | fixed dock above/below the editor | at the chat tail by default, with a row budget and `/widgets`, since [`ui.inlineWidgets`](inline-widgets.md) defaults to on | a tall widget otherwise steals rows from the whole editor dock |
| Per-tab settings | none | `Inline widgets` also reads and writes `mixcode_settings.json`, shown in its own `MixCode` section of `/settings` | MixCode settings stay out of pi's `settings.json` and out of its section |
| Settings list rows | one flat list of settings | `SettingItem` gained an optional `section` that renders a heading row | same as above |
| `/settings` panel | pi-tui's `SettingsList` inside a bordered selector that replaces the editor area: `→` cursor, a search input box, raw `true`/`false` values, flat section headings | a centred floating panel titled `Settings`: a surface-framed list with a dim `filter: type to filter  N/N` line, a `Pi` / `MixCode` heading above each settings file's path, `›` rows with a label column and a value column, booleans shown as `On`/`Off`, the selected item's description, and one key-hint footer row | the panel reads as a surface over the work and names the file a setting lives in, and the composer keeps its draft while settings are open; picking `TUI mode` takes the panel down before switching, because a mode switch refuses while an overlay is open |
| Follow-up input (`alt+enter`) | queues into the SDK follow-up queue, delivered by the agent after the run | queues host-side rounds: exclusive rounds from `/follow-up <message>`, merged rounds from `alt+enter` and `/follow-up --batch <message>`, dispatched one turn per round when idle, paused on failure until `/follow-up` resumes | follow-up rounds need pause/resume, batch merging, and queued local commands |
| Queued messages display | flat `Steering:`/`Follow-up:` lines under the transcript | boxed `Steer (n)`/`Follow-up (n)` previews with round numbering (`Round k · next/command ·`), `SDK ·` companions, latest-five truncation, a pause hint, and `Esc->send now`/edit hints | the queue is now an ordered round list, not a text dump |
| Esc with queued steer texts | restores every queued message into the editor and aborts | aborts, then sends the steer queue as one immediate turn; follow-up rounds stay queued (paused) | `Esc->send now` must not promote follow-up rounds |
| `AgentSession`/`Agent` queue API | `clearQueue()`/`clearAllQueues()` only | additive `removeQueuedMessages(kind, texts)`/`restoreQueuedMessages(kind, removed)`: exact-text dequeue (last match first) from the mirrors and the pending queues, returning queue-ordered entries for restore | flush and pop must remove specific texts, not the whole queue |
| Dequeue key (`app.message.dequeue`) | `alt+up` (`alt+q` on Windows and WSL); restores every queued message into the editor; the editor keeps `ctrl+u` for delete-to-line-start | `ctrl+u`, shared with the empty-editor vim arm (queued messages take the key first, an empty queue falls through to vim entry) and consumed on an agent tab either way, so it no longer reaches the editor; with both queues queued `ctrl+u` then `s`/`f` picks one, a single queue pops its last entry into the editor, reconstructing `/follow-up` (and `--batch`) forms, and mirrored texts leave the SDK queue too | per-queue editing reads as one shortcut, and `ctrl+u` matches the queue workflow |
| Docked widget stack | no cap; the layout shrinks the slots when space runs out | the above and below slots share a row budget, cut whole rows are marked `… (widgets truncated)` | a tall widget stack otherwise squeezes the chat and the dock chrome |
| User message block | a background-filled block with the message text | the same block with the send time at the right end of its first row (`Sep 29, 9:29 PM`: short month, day, hour, and minute in the terminal's own locale), painted dim, with the body rendered narrow enough that no text can reach it | the block says when it was written, so a long conversation can be read by time without opening a session listing |
| Pointer hover feedback | no cue: lists ignore pointer motion, a message region answers clicks only, and the jump-to-end label is styled once | the cells under the pointer get a selection background and an underline (tab chips, command-palette rows, the dock meta row's model and thinking fields), a message block that answers a click is filled as one rectangle, and the fullscreen renderer tells a component when the pointer leaves it, keeps the whole chrome unlit while an overlay is open, and drops every hover when the terminal is resized | the fork's clickable chrome needs a cue that does not move the keyboard selection or the active tab |
| Mouse drag selection | selects any cell on screen, copies the cells verbatim, paints them with reverse video, and keeps following new output during the drag | scoped to the transcript, the prompt card and the notice panel; the copied text drops a framed surface's border rows, border columns, padding column and key-hint rows; the highlight uses the theme's `selectedBg` and is dropped by a release with copy-on-select on (a release with the setting off keeps it for the copy command), and it underlines the card rows inside a block that carries the pointer cue, whose fill uses the same background; a press holds the transcript so streaming output cannot move the selected rows, and the release leaves it there when the output grew past the viewport or the user scrolled | [Mouse Selection](mouse-selection.md) |
| Extension module resolution | bun loading the built dist keeps jiti's `tryNative` (native TS import), so an extension's bare `@earendil-works/*` imports resolve from ambient `node_modules` | bun loading the built dist resolves through `virtualModules`, so the specifiers that map lists always come from the running host; bun running the TypeScript source is unchanged | a second copy of `@earendil-works/pi-tui` puts `ToolExecutionComponent.prototype` patching on a class the host never rendered, so renderer extensions silently fell back to the built-in tool rows |
| Hidden thinking | the full reasoning text when hiding is off, the italic `Thinking...` label when it is on | with hiding on, each block renders as a three-row tail that follows the stream: a `Thinking` header whose duration ticks live and freezes when the block stops growing, and the last three visual rows behind a left rail, `…`-marked when earlier content was dropped. An extension `setHiddenThinkingLabel` still replaces the whole block. The `Thinking tail preview` row in `/settings` turns it off, and it defaults to on | the tail keeps the reasoning legible while it streams without giving the block the whole transcript |

## Outdated upstream pages and source copy

Deliberately left unpatched:

| Page | Upstream text | Reality |
| --- | --- | --- |
| `packages/coding-agent/docs/usage.md:49` | "Press `Shift+Tab` to cycle through supported levels" | the cycle key is `alt+t` |
| `packages/coding-agent/docs/keybindings.md:155` | `app.thinking.cycle` defaults to `shift+tab` | it defaults to `alt+t` |
| `packages/coding-agent/src/experimental/micro/README.md:30` | "Shift+Tab: cycle the current model's supported thinking levels" | micro's status line reads the live binding; only this hardcoded text is wrong |
| `packages/coding-agent/docs/keybindings.md:152` | `app.model.cycleForward` defaults to `ctrl+p` | no default key; `ctrl+p` is `app.palette` |
| `packages/coding-agent/docs/models.md:33` | "`Ctrl+P` cycles through available models" | `ctrl+p` opens the command palette; only `shift+ctrl+p` still cycles, and only back to the previous model |
| `packages/coding-agent/src/cli/args.ts:303` (source copy) | the `--models` help says "patterns for Ctrl+P cycling" | `ctrl+p` opens the command palette; the cycle key is `shift+ctrl+p` (`alt+p` on Windows and WSL) |

Those pages also never list the tab keybindings and tab slash commands; [Agent Tabs](tabs.md) is the source of truth for those.

## Upstream files modified by this fork

Each one is a potential conflict point, so edits are kept down to the wiring that calls into `mixcode/` code:

- `packages/coding-agent/src/modes/interactive/interactive-mode.ts`
- `packages/coding-agent/src/modes/interactive/components/session-selector.ts`
- `packages/coding-agent/src/modes/interactive/components/custom-editor.ts`
- `packages/coding-agent/src/core/keybindings.ts`
- `packages/coding-agent/src/core/slash-commands.ts`
- `packages/coding-agent/src/core/extensions/runner.ts`
- `packages/coding-agent/src/modes/interactive/chat-viewport.ts`
- `packages/coding-agent/src/main.ts`
- `packages/coding-agent/src/core/agent-session.ts`: the steering and follow-up queue splice
- `packages/coding-agent/src/core/settings-manager.ts`: the fork's fullscreen `tuiMode` default
- `packages/coding-agent/src/core/extensions/loader.ts`: routes bun-dist extension imports through `virtualModules`
- `packages/coding-agent/src/modes/interactive/tui-renderer.ts`: forwards the host's copy callback and selection options to the alternate screen
- `packages/coding-agent/src/modes/interactive/theme/theme.ts`, `theme/dark.json`, `theme/light.json`,
  `theme/theme-json.ts`, `theme/theme-schema.json`: the `panelBg` background used to fill framed cards
- `packages/coding-agent/test/extensions-runner.test.ts`
- `packages/coding-agent/test/interactive-tui.test.ts`: the copy confirmation now asserts a toast
- `packages/coding-agent/src/modes/interactive/tui-renderer.ts`: underlines the jump-to-end label while the pointer is over it
- `packages/coding-agent/src/modes/interactive/components/tool-execution.ts`, `assistant-message.ts`,
  `compaction-summary-message.ts`, `branch-summary-message.ts`, `skill-invocation-message.ts`: clickable regions use the fork's `HoverRegion`, since the bundled `MouseRegion` draws no highlight
- `packages/coding-agent/src/modes/interactive/components/user-message.ts`: the send time at the right end of a message's first row
- `packages/ai/src/api/openai-responses-shared.ts`: records the model name the server reports in a
  Responses stream onto `AssistantMessage.responseModel`
- `packages/ai/src/api/anthropic-messages.ts`, `packages/ai/src/api/openai-completions.ts`: record the
  reported model through the same helper as the Responses adapter, so the overwrite rule has one definition
- `packages/agent/src/agent.ts`: the steering and follow-up queue APIs
- `packages/tui/src/layout-node.ts`: the windowed layout node and the scroll line provider
- `packages/tui/src/components/settings-list.ts`: the optional `section` heading row on `SettingItem`
- `packages/coding-agent/src/modes/interactive/components/settings-selector.ts`: the `MixCode` section entries
- `packages/coding-agent/src/modes/interactive/theme/theme.ts`: the `getSettingsListTheme` section heading style
- `packages/tui/src/layout.ts`: windowed scroll child, line provider on the scroll box,
  `getComponentBox` for resolving a component to its committed box, and the `honorOffset` argument
  a suspended scroll view passes to its windowed child
- `packages/tui/src/components/scroll-view.ts`: `setFollowSuspended` / `isFollowSuspended` /
  `resumeFollowEnd`, so a pointer gesture can hold the rows it is selecting over
- `packages/tui/src/components/box.ts`: `componentAtRow`, so a row inside a padded card resolves to the
  child that painted it (the descent a host walks to find the component a transcript row belongs to)
- `packages/tui/src/tui.ts`: the overlay mouse dispatch reports the overlay it hit, so a point
  outside it can be told from a point on it; the `TuiSelectionOptions` contract (including
  `clearOnRelease` and a `highlight` handed the painted line), `Container.componentAtRow` so a host
  can resolve a row to the component that painted it, `hasCapturingOverlay`,
  and the overlay rect lookup the surface resolver needs
- `packages/tui/src/tui-alt-screen.ts`: reads content lines through the provider; public `scrollToPrompt`;
  an `onCopyResult` option lets the host confirm a clipboard write instead of the screen's own flash,
  and reports the copied text as a grapheme count; tracks the hovered component so the next move
  elsewhere, an overlay, or a pointer capture can send it a leave event; `scrollToEndIndicator`
  receives whether the pointer is over the label; a `selection` option scopes the drag to host surfaces
  and takes the host's text cleanup, style and release clearing
- `packages/tui/src/utils.ts`: `countGraphemes`, moved there from the alternate screen so the
  coding-agent toast can report a copy in the same unit
- `packages/tui/src/index.ts`: exports for the windowed node, mouse dispatch, the grapheme counter and
  the image-line predicate, and the selection options
- `packages/coding-agent/src/cli/args.ts`: the `--tui-mode` help line names the fork's default
- `packages/coding-agent/test/settings-manager.test.ts`: the TUI mode assertions expect the fork's
  fullscreen default
- `packages/coding-agent/test/keybindings.test.ts`, `packages/coding-agent/test/interactive-mode-compaction.test.ts`: the queue bindings and the compaction paths
- `AGENTS.md`, `.gitignore`

The fork also adds keys to upstream's `keybindings.ts` — the `app.workdir.*` bindings the workdir
picker answers and the `app.queueEdit.*` ones the queued-message editor answers — while
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
- `packages/coding-agent/src/modes/interactive/components/clickable-card.ts` — a fork module that sits outside the `mixcode/` folders
