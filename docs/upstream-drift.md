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
| Default TUI mode | `regular` | `fullscreen`; an explicit `tuiMode: "regular"` in `settings.json` still selects the plain transcript | the fork's reading features (windowed transcript, vim, mouse selection) only exist on the alternate screen, and upstream's `packages/coding-agent/docs/settings.md` still lists `"regular"` as the default |
| Editor frame while modal | thinking/bash border color | accent border, input and submit locked | vim mode owns input |
| MixCode Home | no such surface; the transcript always shows the active session | a `home` pseudo-tab lists every open agent with a conversation preview | [MixCode Home](home.md) |
| `left`/`right`/`up`/`down`/`enter`/`ctrl+f` | editor cursor, prompt history, submit | on Home they select, attach, send, and filter the roster; on agent tabs the editor keeps them | [MixCode Home](home.md) |
| App-action keybinding handlers | a handler that matches consumes the key | a handler may return `false` to decline it; the raw key data is passed in | the Home bindings must not take `up`/`down`/`left`/`right`/`enter` from the composer, and `enter` also matches a bare newline (`ctrl+j`) |
| Empty composer | draws nothing | agent tabs hint `Describe your next change...  @ files  / commands`, vim tabs list the navigation keys, and Home names the target agent in the neutral thinking colour | the roster makes the target explicit, Home has no thinking level of its own, and the composer states what it accepts |
| Interactive console output | `console.log` and the other console methods write to the tty | painted into a bottom-centered `Notice` panel (not the transcript); `/console-history` opens the last 1,000 lines in the external editor with timestamp and emitting tab | [Console History](console-history.md) |
| Prompt editor frame | two flat rules above and below the composer | a rounded card whose top edge carries the working status, the mode badges, the tab name and the exact context usage | the input area names the agent and its context without a separate header row; see [Input Dock](input-dock.md) |
| Editor dock footer | two rows: pwd with the session name, then token and cost totals with `percent (auto)` beside the right-aligned model and thinking level, plus an extension status row when one is registered | one meta row: model, thinking and workdir, an eight-cell context meter and the git branch, then the extension status row | the card's top edge already carries the name and the exact token counts, the model label names its provider, and the meter reads faster than a percentage; see [Input Dock](input-dock.md) |
| Footer on Home | n/a (no Home surface) | Home parks the dock footer, so it carries no meta row | the roster already names each agent and shows its context, and Home has no session of its own |
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
| Pointer hover feedback | no cue: lists ignore pointer motion, a message region answers clicks only, and the jump-to-end label is styled once | the cells under the pointer get a selection background and an underline (tab chips, command-palette rows), a message block that answers a click is filled as one rectangle, and the fullscreen renderer tells a component when the pointer leaves it, keeps the whole chrome unlit while an overlay is open, and drops every hover when the terminal is resized | the fork's clickable chrome needs a cue that does not move the keyboard selection or the active tab |
| Mouse drag selection | selects any cell on screen, copies the cells verbatim, paints them with reverse video, and keeps following new output during the drag | scoped to the transcript, the prompt card and the notice panel; the copied text drops a framed surface's border rows, border columns, padding column and key-hint rows; the highlight uses the theme's `selectedBg`; a press holds the transcript so streaming output cannot move the selected rows, and the release leaves it there when the output grew past the viewport or the user scrolled | [Mouse Selection](mouse-selection.md) |
| Extension module resolution | bun loading the built dist keeps jiti's `tryNative` (native TS import), so an extension's bare `@earendil-works/*` imports resolve from ambient `node_modules` | bun loading the built dist resolves through `virtualModules`, so the specifiers that map lists always come from the running host; bun running the TypeScript source is unchanged | a second copy of `@earendil-works/pi-tui` puts `ToolExecutionComponent.prototype` patching on a class the host never rendered, so renderer extensions silently fell back to the built-in tool rows |
| Hidden thinking | the full reasoning text when hiding is off, the italic `Thinking...` label when it is on | with hiding on, each block renders as a three-row tail that follows the stream: a `Thinking` header whose duration ticks live and freezes when the block stops growing, and the last three visual rows behind a left rail, `…`-marked when earlier content was dropped. An extension `setHiddenThinkingLabel` still replaces the whole block. The `Thinking tail preview` row in `/settings` turns it off, and it defaults to on | the tail keeps the reasoning legible while it streams without giving the block the whole transcript |

- `packages/tui/src/layout.ts`: windowed scroll child, line provider on the scroll box,
  `getComponentBox` for resolving a component to its committed box, and the `honorOffset` argument
  a suspended scroll view passes to its windowed child
- `packages/tui/src/components/scroll-view.ts`: `setFollowSuspended` / `isFollowSuspended` /
  `resumeFollowEnd`, so a pointer gesture can hold the rows it is selecting over
- `packages/tui/src/tui.ts`: the overlay mouse dispatch reports the overlay it hit, so a point
  outside it can be told from a point on it; the `TuiSelectionOptions` contract, `hasCapturingOverlay`,
  and the overlay rect lookup the surface resolver needs
- `packages/tui/src/tui-alt-screen.ts`: reads content lines through the provider; public `scrollToPrompt`;
  an `onCopyResult` option lets the host confirm a clipboard write instead of the screen's own flash,
  and reports the copied text as a grapheme count; tracks the hovered component so the next move
  elsewhere, an overlay, or a pointer capture can send it a leave event; `scrollToEndIndicator`
  receives whether the pointer is over the label; a `selection` option scopes the drag to host surfaces
  and takes the host's text cleanup and style
- `packages/tui/src/utils.ts`: `countGraphemes`, moved there from the alternate screen so the
  coding-agent toast can report a copy in the same unit
- `packages/tui/src/index.ts`: exports for the windowed node, mouse dispatch, the grapheme counter and
  the image-line predicate, and the selection options
- `packages/coding-agent/src/cli/args.ts`: the `--tui-mode` help line names the fork's default
- `packages/coding-agent/test/settings-manager.test.ts`: the TUI mode assertions expect the fork's
  fullscreen default
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
