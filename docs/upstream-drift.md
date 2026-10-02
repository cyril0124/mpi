# Upstream Drift

[中文文档](upstream-drift.zh.md)

Where this fork and upstream pi disagree. Upstream's pages are never patched for fork behavior —
that conflicts on every upstream merge — so the divergence is recorded here instead, in the same
commit that causes it.

## Behavior changes

| Area | Upstream | This fork | Reason |
| --- | --- | --- | --- |
| `install.sh` | release archives via `scripts/build-binaries.sh` | installs a standalone runtime in `<prefix>/lib/<name>/` and a wrapper at `<prefix>/bin/<name>`; `<name>` defaults to `mpi` and supports `--name` or `MIXCODE_INSTALL_NAME` | single-machine installs can use a custom command name while keeping the runtime and wrapper names aligned |
| `app.thinking.cycle` default key | `shift+tab` | `alt+t` | `shift+tab` became `app.tab.previous` |
| Agent tabs | one session per terminal | several concurrent tabs, each with its own `AgentSessionRuntime` | [Agent Tabs](tabs.md) |
| `/fork` message selection | replaces the active session | opens a new independent tab after the source, with a unique `-fork` title and the selected message in its editor | the original conversation remains available beside the alternative |
| Session deletion | deletes the selected session file | refuses while the owning tab has a turn in progress | another tab may still be writing that file |
| `app.model.cycleForward` default key | `ctrl+p` | no default key | `ctrl+p` opens the command palette |
| `app.tab.jump` default key | no such action; `ctrl+t` toggles thinking-block visibility | `ctrl+t` opens the Tab Jump switcher, and `app.thinking.toggle` keeps its `ctrl+t` default but loses the chord to the composer's registration order | jumping to one of several agents should not mean cycling past the others; see [Agent Tabs](tabs.md#tab-jump) |
| Quit | `ctrl+d` exits, no confirmation | `ctrl+q` (`ctrl+shift+q` on Windows and WSL) asks first; `ctrl+d` unchanged | [Command Palette and Quit Confirmation](command-palette.md) |
| Fullscreen transcript rendering | renders every message component each frame, then clips to the viewport | renders only the visible window (20 rows of overscan) and estimates unmeasured blocks at 4 rows | frame cost otherwise grows with the whole conversation |
| Transcript scrolling keys | `tui.altScreen.*` only | plus a modal surface (`/vim`, `j`/`k`/`gg`/`G`, prompt jumps with a `User Messages` preview panel) in fullscreen mode | mouse-free reading of long conversations |
| Default TUI mode | `regular` | `fullscreen`; an explicit `tuiMode: "regular"` in `settings.json` still selects the plain transcript | the fork's reading features (windowed transcript, vim, mouse selection) only exist on the alternate screen, and upstream's `packages/coding-agent/docs/settings.md` still lists `"regular"` as the default |
| Editor frame while modal | thinking/bash border color | accent border, input and submit locked | vim mode owns input |
| Zen focus mode | no such mode; upstream has no tab bar to hide | `/toggle-zen-mode` drops the chips and leaves the separator carrying the other agents' status dots, and `tab`/`shift+tab` stop switching agents while an agent tab is in zen | the chips cost a row the transcript wants back, while the bar still has to report what the other agents are doing; see [Zen Mode](zen-mode.md) |
| MixCode Home | no such surface; the transcript always shows the active session | a `home` pseudo-tab lists every open agent with a conversation preview | [MixCode Home](home.md) |
| `left`/`right`/`up`/`down`/`enter`/`ctrl+f` | editor cursor, prompt history, submit | on Home they select, attach, send, and filter the roster; on agent tabs the editor keeps them | [MixCode Home](home.md) |
| App-action keybinding handlers | a handler that matches consumes the key | a handler may return `false` to decline it; the raw key data is passed in | the Home bindings must not take `up`/`down`/`left`/`right`/`enter` from the composer, and `enter` also matches a bare newline (`ctrl+j`) |
| Prompt-history recall | a recalled entry takes the caret at its start (`up`) or its end (`down`), and the arrows move the caret within a recalled multi-line entry | every recalled entry takes the caret at its end, and the arrows keep stepping between entries while one is browsed | the caret belongs where the next keystroke lands, so a recall appends instead of overwriting, and browsing must not stall on a multi-line entry |
| Empty composer | draws nothing | agent tabs hint `Describe your next change...  @ files  / commands  ← Home · → widgets`, vim tabs list the navigation keys, and Home names the target agent in the neutral thinking colour | the roster makes the target explicit, Home has no thinking level of its own, and the composer states what it accepts; the two key labels are read from the configured keybindings, and the widgets half is left out in TUI modes that do not split the chat |
| Interactive console output | `console.log` and the other console methods write to the tty | painted into a bottom-centered `Notice` panel (not the transcript); `/console-history` opens the last 1,000 lines in the external editor with timestamp and emitting tab | [Console History](console-history.md) |
| Prompt editor frame | two flat rules above and below the composer | a rounded card whose top edge carries the working status, the mode badges, the tab name and the exact context usage, and whose body holds its text one column off the left border | the input area names the agent and its context without a separate header row; see [Input Dock](input-dock.md) |
| Chrome on a replaced editor | no tab bar, and an extension-replaced editor draws its own frame with no agent labels | while `setEditorComponent` supplies the editor, the rule under the tab bar carries the tab name, the `[VIM]`/`[ZEN]` badges and the `/context-limit` override reading | the card that names the agent and its context is gone with the editor, and the rule is painted every frame anyway; see [Input Dock](input-dock.md#replaced-editors) |
| Built-in theme discovery | `getBuiltinThemes()` reads `dark.json` and `light.json` by name, so a JSON dropped into the theme directory is invisible; the theme picker lists only those plus user themes | every `*.json` in the theme directory is loaded and keyed by the `name` inside it (`theme-schema.json` is skipped); a file that fails to parse or validate is dropped instead of taking the rest of the built-in set with it. `aurora` ships this way | a theme lives in its own file, so adding one is adding a file, not editing the loader |
| Editor dock footer | two rows: pwd with the session name, then token and cost totals with `percent (auto)` beside the right-aligned model and thinking level, plus an extension status row when one is registered | one meta row: model, thinking and workdir, an eight-cell context meter and the git branch, then the extension status row; the model, the thinking level and the workdir answer a click, opening their pickers | the card's top edge already carries the name and the exact token counts, the model label names its provider, and the meter reads faster than a percentage; see [Input Dock](input-dock.md) |
| Meta row glyphs | the footer names the model and the thinking level as text and marks nothing else with a glyph | the meta row prefixes the model and the thinking level with a Nerd Font icon in its two full layouts, and the context meter and the git branch carry theirs; `ui.icons.mode` (`nerd`, `ascii`, `auto`) picks the alphabet, and `auto` probes the terminal | a glyph makes a field recognisable at a glance, and the ASCII fallback keeps a terminal without the font from painting boxes; see [Icons](icons.md) |
| Footer on Home | n/a (no Home surface) | Home parks the dock footer, so it carries no meta row | the roster already names each agent and shows its context, and Home has no session of its own |
| Working directory | fixed at startup: `--workdir`, or the process cwd; a session keeps it for its whole life | `/workdir [path]` moves the active tab onto another directory, and the meta row's workdir badge opens the picker | pointing a tab at another project should not mean restarting the agent; see [Workdir](tabs.md#workdir) |
| Extension widgets | fixed dock above/below the editor | at the chat tail by default, with a row budget and `/widgets`, since [`ui.inlineWidgets`](inline-widgets.md) defaults to on | a tall widget otherwise steals rows from the whole editor dock |
| Per-tab settings | none | `Inline widgets` also reads and writes `mixcode_settings.json`, shown in its own `MixCode` section of `/settings` | MixCode settings stay out of pi's `settings.json` and out of its section |
| Settings list rows | one flat list of settings | `SettingItem` gained an optional `section` that renders a heading row | same as above |
| `/settings` panel | pi-tui's `SettingsList` inside a bordered selector that replaces the editor area: `→` cursor, a search input box, raw `true`/`false` values, flat section headings | a centred floating panel titled `Settings`: a surface-framed list with a dim `filter: type to filter  N/N` line, a `Pi` / `MixCode` heading above each settings file's path, `›` rows with a label column and a value column, booleans shown as `On`/`Off`, the selected item's description, and one key-hint footer row | the panel reads as a surface over the work and names the file a setting lives in, and the composer keeps its draft while settings are open; picking `TUI mode` takes the panel down before switching, because a mode switch refuses while an overlay is open |
| Follow-up input (`alt+enter`) | queues into the SDK follow-up queue, delivered by the agent after the run | queues host-side rounds: exclusive rounds from `/follow-up <message>`, merged rounds from `alt+enter` and `/follow-up --batch <message>`, dispatched one turn per round when idle, paused on failure until `/follow-up` resumes | follow-up rounds need pause/resume, batch merging, and queued local commands |
| Manual compaction model | `/compact` accepts only custom instructions and uses the active model | `/compact [provider/modelId] [instructions]` uses the requested model only for the summary, without changing the session model or thinking level, and shows it in the working status; compaction reason messages use accent/warning/error colors | manual summaries sometimes need a different model, and transient status should distinguish manual, threshold, and overflow compaction |
| Queued messages display | flat `Steering:`/`Follow-up:` lines under the transcript | boxed `Steer (n)`/`Follow-up (n)` previews with round numbering (`Round k · next/command ·`), `SDK ·` companions, latest-five truncation, a pause hint, and `Esc->send now`/edit hints | the queue is now an ordered round list, not a text dump |
| Esc with queued steer texts | restores every queued message into the editor and aborts | aborts, then sends the steer queue as one immediate turn; follow-up rounds stay queued (paused) | `Esc->send now` must not promote follow-up rounds |
| `AgentSession`/`Agent` queue API | `clearQueue()`/`clearAllQueues()` only | additive `removeQueuedMessages(kind, texts)`/`restoreQueuedMessages(kind, removed)`: exact-text dequeue (last match first) from the mirrors and the pending queues, returning queue-ordered entries for restore | flush and pop must remove specific texts, not the whole queue |
| Dequeue key (`app.message.dequeue`) | `alt+up` (`alt+q` on Windows and WSL); restores every queued message into the editor; the editor keeps `ctrl+u` for delete-to-line-start | `ctrl+u`, shared with the empty-editor vim arm (queued messages take the key first, an empty queue falls through to vim entry) and consumed on an agent tab either way, so it no longer reaches the editor; with both queues queued `ctrl+u` then `s`/`f` picks one, a single queue pops its last entry into the editor, reconstructing `/follow-up` (and `--batch`) forms, and mirrored texts leave the SDK queue too | per-queue editing reads as one shortcut, and `ctrl+u` matches the queue workflow |
| Docked widget stack | no cap; the layout shrinks the slots when space runs out | the above and below slots share a row budget, cut whole rows are marked `… (widgets truncated)` | a tall widget stack otherwise squeezes the chat and the dock chrome |
| User message block | a background-filled block with the message text | the same block with the send time at the right end of its first row (`Sep 29, 9:29 PM`: short month, day, hour, and minute in the terminal's own locale), painted dim, with the body rendered narrow enough that no text can reach it | the block says when it was written, so a long conversation can be read by time without opening a session listing |
| Pointer hover feedback | no cue: lists ignore pointer motion, a message region answers clicks only, and the jump-to-end label is styled once | the cells under the pointer get a selection background and an underline (tab chips, command-palette rows, the dock meta row's model and thinking fields), a message block that answers a click is filled as one rectangle, and the fullscreen renderer tells a component when the pointer leaves it, keeps chrome under capturing overlays unlit while non-capturing overlays leave it live outside their rectangles, and drops every hover when the terminal is resized | the fork's clickable chrome needs a cue that does not move the keyboard selection or the active tab |
| Mouse drag selection | selects any cell on screen, copies the cells verbatim, paints them with reverse video, and keeps following new output during the drag | scoped to the transcript, the prompt card and the notice panel; the copied text drops a framed surface's border rows, border columns, padding column and key-hint rows; the highlight uses the theme's `selectedBg` and is dropped by a release with copy-on-select on (a release with the setting off keeps it for the copy command), and it underlines the card rows inside a block that carries the pointer cue, whose fill uses the same background; a press holds the transcript so streaming output cannot move the selected rows, and the release leaves it there when the output grew past the viewport or the user scrolled | [Mouse Selection](mouse-selection.md) |
| Extension module resolution | bun loading the built dist keeps jiti's `tryNative` (native TS import), so an extension's bare `@earendil-works/*` imports resolve from ambient `node_modules` | bun loading the built dist resolves through `virtualModules`, so the specifiers that map lists always come from the running host; bun running the TypeScript source is unchanged | a second copy of `@earendil-works/pi-tui` puts `ToolExecutionComponent.prototype` patching on a class the host never rendered, so renderer extensions silently fell back to the built-in tool rows |
| Hidden thinking | the full reasoning text when hiding is off, the italic `Thinking...` label when it is on | with hiding on, each block renders as a three-row tail that follows the stream: a `Thinking` header whose duration ticks live and freezes when the block stops growing, and the last three visual rows behind a left rail, `…`-marked when earlier content was dropped. An extension `setHiddenThinkingLabel` still replaces the whole block. The `Thinking tail preview` row in `/settings` turns it off, and it defaults to on | the tail keeps the reasoning legible while it streams without giving the block the whole transcript |
| New-version prompt | checks `pi.dev/api/latest-version` at startup and prints an `Update Available` block with a changelog link, gated by `PI_SKIP_VERSION_CHECK` | no prompt about pi's own releases: the startup check, `checkForNewPiVersion` and `PI_SKIP_VERSION_CHECK` are gone | the fork reports outdated extension packages on [MixCode Home](home.md), and only there |
| Exit resume hint | prints `To resume this session: pi --session <id>` on interactive quit when the session is persisted | no such line: the print and the `formatResumeCommand` helper behind it are removed | MixCode holds several sessions in one process and reaches them through its own tabs, so pi's `--session` command is not how a session is resumed |
| Settings overrides | `applyOverrides` layers a value onto the effective settings, and the next recomposition from the scopes (`save`, `reload`, a trust change) drops it | the override layer is kept and re-merged on every recomposition, and `clearOverrides` releases named fields | a tab's `/context-limit` narrows the compaction budgets, and a settings write in the middle of a turn would otherwise restore the full budgets without saying so |

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
| `packages/coding-agent/docs/slash-commands.md:30` | `/compact [instructions]` | the fork also accepts a leading `provider/modelId` that runs only the summary on that model |
| `packages/coding-agent/docs/compaction.md:41` | "trigger manually with `/compact [instructions]`" | same: the summary model can be named before the instructions |
| `packages/coding-agent/docs/environment-variables.md:85` | `PI_SKIP_VERSION_CHECK` disables the `pi.dev` latest-version request | the variable and the startup check that read it are removed |
| `packages/coding-agent/src/utils/version-check.ts` (source copy) | exports `checkForNewPiVersion`, the startup check that reads `PI_SKIP_VERSION_CHECK` | removed; `getLatestPiRelease` and `isNewerPackageVersion` stay for `pi update --self` |
| `packages/coding-agent/docs/usage.md:23` | "Press `Ctrl+T` to show or hide thinking blocks" | `ctrl+t` opens Tab Jump; `app.thinking.toggle` keeps the same default but the composer declines it behind the jump handler |
| `packages/coding-agent/docs/keybindings.md:157` | `app.thinking.toggle` defaults to `ctrl+t` | the same key belongs to `app.tab.jump`, which the composer registers first; the toggle is reachable only after a rebind |
| `packages/coding-agent/docs/settings.md:79` | `fullscreenExitOutput` set to `resume-hint` selects "only a session resume hint" as the exit output | the value still suppresses the transcript on exit, and nothing is printed in its place |

Those pages also never list the tab keybindings and tab slash commands — `/jump` and its `ctrl+t`
chord included; [Agent Tabs](tabs.md) is the source of truth for those.

## Upstream files modified by this fork

Each one is a potential conflict point, so edits are kept down to the wiring that calls into `mixcode/` code:

- `packages/coding-agent/src/modes/interactive/interactive-mode.ts`
- `packages/coding-agent/src/modes/interactive/components/status-indicator.ts`: summary model label and reason-specific message colors
- `packages/coding-agent/src/modes/interactive/components/session-selector.ts`
- `packages/coding-agent/src/modes/interactive/components/custom-editor.ts`
- `packages/coding-agent/src/core/keybindings.ts`
- `packages/coding-agent/src/core/slash-commands.ts`
- `packages/coding-agent/src/core/extensions/runner.ts`
- `packages/coding-agent/src/modes/interactive/chat-viewport.ts`
- `packages/coding-agent/src/main.ts`
- `packages/coding-agent/src/core/agent-session.ts`: request-scoped manual compaction model and the steering and follow-up queue splice
- `packages/coding-agent/src/core/settings-manager.ts`: the fork's fullscreen `tuiMode` default and a
  retained override layer (`applyOverrides` keeps its overrides across scope recompositions, and
  `clearOverrides` releases named fields)
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
- `packages/coding-agent/src/modes/interactive/components/settings-selector.ts`: the `MixCode` section entries, and the `Fullscreen exit output` description
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
- `packages/coding-agent/src/utils/version-check.ts`: `checkForNewPiVersion` removed, since the startup prompt was its only caller
- `scripts/profile-coding-agent-node.mjs`: `--offline` no longer sets the removed `PI_SKIP_VERSION_CHECK`
- `packages/coding-agent/test/version-check.test.ts`, `packages/coding-agent/test/package-command-paths.test.ts`: the removed check and its env var dropped from the cases
- `packages/coding-agent/test/suite/regressions/5080-signal-shutdown-extension-cleanup.test.ts`: the resume-hint case dropped with the hint, leaving the shutdown ordering it was written for
- `packages/coding-agent/test/format-resume-command.test.ts`: deleted with the `formatResumeCommand` helper it covered
- `AGENTS.md`, `.gitignore`

The fork also adds keys to upstream's `keybindings.ts` — the `app.workdir.*` bindings the workdir
picker answers, the `app.queueEdit.*` ones the queued-message editor answers, and the `app.tab.jump`
/ `app.tabJump.toggleNonIdle` pair the Tab Jump overlay answers — while
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
