# Upstream Drift

[中文文档](upstream-drift.zh.md)

Where this fork and upstream pi disagree. Upstream's pages are never patched for fork behavior —
that conflicts on every upstream merge — so the divergence is recorded here instead, in the same
commit that causes it.

## Behavior changes

| Area | Upstream | This fork | Reason |
| --- | --- | --- | --- |
| `install.sh` | release archives via `scripts/build-binaries.sh` | installs a standalone runtime in `<prefix>/lib/<name>/` and a wrapper at `<prefix>/bin/<name>`; `<name>` defaults to `mpi` and supports `--name` or `MIXCODE_INSTALL_NAME` | single-machine installs can use a custom command name while keeping the runtime and wrapper names aligned |
| Distribution name | the app is `pi`; `ENV_AGENT_DIR` / `ENV_SESSION_DIR` are derived from `APP_NAME`, and the debug log is `pi-debug.log` | `piConfig.name` is `mpi`, so `--help`, the package-command help, the terminal title and runtime messages say `mpi`; `PI_CODING_AGENT_DIR` / `PI_CODING_AGENT_SESSION_DIR` are pinned to their upstream names in `config.ts`, and the unsupported `update` command is not listed in `--help` | the fork installs and ships as `mpi` (see `install.sh`) without moving users' agent-dir env vars or the shared `.pi` directory |
| `app.thinking.cycle` default key | `shift+tab` | `alt+t` | `shift+tab` became `app.tab.previous` |
| Agent tabs | one session per terminal | several concurrent tabs, each with its own `AgentSessionRuntime`; returning during a response rebuilds the transcript from saved history plus the current streaming message | the live answer must remain visible and continue updating after a tab switch; see [Agent Tabs](tabs.md) |
| Repository check scope | Biome and the dependency/import scanners can traverse nested scratch checkouts | `tmp/`, `.worktrees/`, and `.sync-feature/` are excluded from these scans | local reproductions and worktrees have their own source and configuration |
| Compaction history notice | displays `Session compacted N times` when loading session history | shows it once per session per process, on startup, on a tab's first view and on branch navigation, and keeps it out of the status line's reuse chain so the next status does not overwrite it; returning to a tab that was left does not repeat it | changing tabs does not compact the session |
| Tab title synchronization | no agent tabs | ordinary tabs follow later session renames, including extension-driven renames; batch-locked titles keep their assigned names | a successful session rename must reach its tab even after it was named; see [Titles](tabs.md#titles) |
| Startup tab restore | n/a (one session per terminal) | a tab parked in an extension `session_start` dialog hands the queue to the next tab, reads `[input]` on its Home card, and finishes on its own once the dialog is answered | a serial restore must not wait on a human; see [Agent Tabs](tabs.md#startup-restore) |
| Composer submit | typed text goes through the single-prompt input loop, which drains its queue to the current session | a submit captures its composer tab and session before waiting for extensions; prompts and compaction queues keep that owner, local commands mount it before dispatch, and failures restore only its empty draft; the shared queue is used only without a tab manager | switching while a submit waits must not send it into another conversation or overwrite another tab's draft; see [Agent Tabs](tabs.md) |
| `/fork` message selection | replaces the active session | opens a new independent tab after the source, with a unique `-fork` title and the selected message in its editor | the original conversation remains available beside the alternative |
| `/resume` | replaces the active session with the picked one | opens the picked session in a tab of its own, and focuses the tab that already holds it | the conversation in the focused tab stays open beside the resumed one, and two runtimes must not append to one session file |
| `/resume` extension veto | `session_before_switch` fires with reason `resume`, and an extension can cancel the replacement | a picked session mounts a new tab, so no runtime replaces its session and the veto does not run; the new tab's `session_start` carries reason `resume` | `/clone` and a tab opened for a peer skip the veto for the same reason |
| `/clear` | `/new` replaces the active session with a fresh file, aborting a turn that is still running | the command is `/clear`: it refuses while a turn or a bash command runs, starts the replacement from the outgoing header's parent, and drops the tab's chip color along with the session | mixcode-pi's `/clear` refuses a busy session instead of aborting the turn, and the chip color is keyed by session id, so a fresh session has none |
| `/reset` | no such command; the only way back to the root of a conversation is to navigate there in `/tree` | `/reset` moves the leaf back to the session root in the same file, keeping the tab, its title and every entry, which stay reachable in `/tree` | re-rooting a conversation should not mean opening the tree selector, and the abandoned branches are worth keeping |
| `/editor` | no such command; the draft reaches the external editor only through the `app.editor.external` key | `/editor` opens the same editor from slash input and from the command palette, and keeps what it writes, an emptied draft included | the draft must also be editable when the editor slot holds the palette's command text |
| Session deletion | deletes the selected session file | refuses while the owning tab has a turn in progress | another tab may still be writing that file |
| Deleted sessions | the file is unlinked | the file is moved to `<agent dir>/mixcode-pi/trash/` and indexed in `trash-index.jsonl` (2 GiB cap, oldest evicted first), with `/resume-trash` restoring a pick back to its original path; a move that fails falls back to the `trash` CLI and then to an unlink | a mis-typed `/delete-session` should be undoable without a backup; the trash dir is the one MixCode shares with mixcode-pi |
| `app.model.cycleForward` default key | `ctrl+p` | no default key | `ctrl+p` opens the command palette |
| `app.tab.jump` default key | no such action; `ctrl+t` toggles thinking-block visibility | `ctrl+t` opens the Tab Jump switcher, and `app.thinking.toggle` keeps its `ctrl+t` default but loses the chord to the composer's registration order | jumping to one of several agents should not mean cycling past the others; see [Agent Tabs](tabs.md#tab-jump) |
| `Escape` while a turn runs | the first press aborts the run | the first press arms a 1 s confirm window and shows `<interrupt key> again: stop`; the second press interrupts, and a turn that produced no visible output is retracted (the branch leaf rewinds to before that run's own user message and its text goes back into the composer) instead of only aborted | one accidental `Escape` should not throw away a prompt whose answer has not started, and the retracted text is worth editing rather than retyping; see [Keybindings](keybindings.md#escape) |
| Quit | `ctrl+d` exits, no confirmation | `ctrl+q` (`ctrl+shift+q` on Windows and WSL) asks first; `ctrl+d` unchanged | [Command Palette and Quit Confirmation](command-palette.md) |
| Transcript resize anchor | keeps the numeric scroll row when width changes, so wrapped messages can move the reader to another conversation block | the windowed fullscreen transcript reanchors the first visible message block and its within-block progress after reflow | a reader who is already scrolled up should keep reading the same conversation while the terminal is resized |
| Fullscreen transcript rendering | renders every message component each frame, then clips to the viewport | renders only the visible window (20 rows of overscan) and estimates unmeasured blocks at 4 rows; an `HStack` measures no intrinsic height for a stretched child that already has one, so the side panel column cannot render the transcript whole | frame cost otherwise grows with the whole conversation, and a width change would otherwise re-lay-out every message |
| Transcript scrolling keys | `tui.altScreen.*` only | plus a modal surface (`/vim`, `j`/`k`/`gg`/`G`, prompt jumps with a `User Messages` preview panel) in fullscreen mode, whose Vim mode reaches the transcript ends with `app.vim.top`/`app.vim.bottom`; plain `home`/`end` stay with the composer, and upstream's `ctrl+home`/`ctrl+end` scroll the transcript | mouse-free reading of long conversations |
| Transcript follow on send | new output follows the end only while the viewport is already at the end, and a submit leaves a scrolled-up viewport where it is | a user message scrolls the fullscreen transcript to the end and resumes follow-end | the message just sent and the answer below it must be visible without scrolling; the send is the user's own action, where streamed output still may not take the viewport from a reader |
| Default TUI mode | `regular` | `fullscreen`; an explicit `tuiMode: "regular"` in `settings.json` still selects the plain transcript | the fork's reading features (windowed transcript, vim, mouse selection) only exist on the alternate screen, and upstream's `packages/coding-agent/docs/settings.md` still lists `"regular"` as the default |
| Editor frame while modal | thinking/bash border color | accent border, no caret, input and submit locked | vim mode owns input |
| Zen focus mode | no such mode; upstream has no tab bar to hide | `/toggle-zen-mode` drops the chips and leaves the separator carrying the other agents' status dots, and `tab`/`shift+tab` stop switching agents while an agent tab is in zen | the chips cost a row the transcript wants back, while the bar still has to report what the other agents are doing; see [Zen Mode](zen-mode.md) |
| MixCode Home | no such surface; the transcript always shows the active session | a `home` pseudo-tab lists every open agent with a conversation preview | [MixCode Home](home.md) |
| `left`/`right`/`up`/`down`/`enter`/`ctrl+f` | editor cursor, prompt history, submit | on Home they select, attach, send, and filter the roster; on agent tabs the editor keeps them | [MixCode Home](home.md) |
| App-action keybinding handlers | a handler that matches consumes the key | a handler may return `false` to decline it; the raw key data is passed in | the Home bindings must not take `up`/`down`/`left`/`right`/`enter` from the composer, and `enter` also matches a bare newline (`ctrl+j`) |
| Prompt-history ownership | one session and editor per terminal | history belongs to the tab and is seeded after each default or extension editor mount; raw submitted inputs and parked drafts stay recallable for that tab | replacing an editor must not retain another tab's entries or discard inputs handled by extensions |
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
| `/settings` across tabs | one session per terminal, so there is nothing to reach | a change re-reads the settings file in every open tab and re-applies the values a session copies out of its manager; a tab that becomes focused re-reads too | one process holds several sessions, so a global row has to move them all; see [Agent Tabs](tabs.md#settings) |
| Follow-up input (`alt+enter`) | queues into the SDK follow-up queue, delivered by the agent after the run | queues host-side rounds: exclusive rounds from `/follow-up <message>`, merged rounds from `alt+enter` and `/follow-up --batch <message>`, dispatched one turn per round when idle, paused on failure until `/follow-up` resumes; a queued local command mounts its own tab first, because it executes through the shared composer | follow-up rounds need pause/resume, batch merging, and queued local commands |
| Manual compaction model | `/compact` accepts only custom instructions and uses the active model | `/compact [provider/modelId] [instructions]` uses the requested model only for the summary, without changing the session model or thinking level, and shows it in the working status; compaction reason messages use accent/warning/error colors | manual summaries sometimes need a different model, and transient status should distinguish manual, threshold, and overflow compaction |
| Queued messages display | flat `Steering:`/`Follow-up:` lines under the transcript | boxed `Steer (n)`/`Follow-up (n)` previews with round numbering (`Round k · next/command ·`), `SDK ·` companions, latest-five truncation, a pause hint, and `Esc->send now`/edit hints | the queue is now an ordered round list, not a text dump |
| Esc with queued steer texts | restores every queued message into the editor and aborts | aborts, then sends the steer queue as one immediate turn; follow-up rounds stay queued (paused) | `Esc->send now` must not promote follow-up rounds |
| Steer texts left at settle | stay in the SDK steering queue until the next submission starts a run | sent as one turn on `agent_settled` when no compaction or resume claimed the session (`scheduleSteerSettleFlush`); a post-settle handoff is left to its owner | a text queued as the last turn ended has nothing left to drain it; the tail of `flushCompactionQueue` queues its remaining steer texts that way |
| `AgentSession`/`Agent` queue API | `clearQueue()`/`clearAllQueues()` only | additive `removeQueuedMessages(kind, texts)`/`restoreQueuedMessages(kind, removed)`: exact-text dequeue (last match first) from the mirrors and the pending queues, returning queue-ordered entries for restore | flush and pop must remove specific texts, not the whole queue |
| Dequeue key (`app.message.dequeue`) | `alt+up` (`alt+q` on Windows and WSL); restores every queued message into the editor; the editor keeps `ctrl+u` for delete-to-line-start | `ctrl+u`, shared with the empty-queue vim arm (queued messages take the key first; an empty queue arms vim entry only in fullscreen mode on an agent tab, since Home covers the tab transcript and has no viewport of its own, and without one the dequeue action reports that there is nothing to restore) and consumed on an agent tab either way, so it no longer reaches the editor; with both queues queued `ctrl+u` then `s`/`f` picks one, a single queue pops its last entry into the editor, reconstructing `/follow-up` (and `--batch`) forms, and mirrored texts leave the SDK queue too | per-queue editing reads as one shortcut, and `ctrl+u` matches the queue workflow |
| Docked widget stack | no cap; the layout shrinks the slots when space runs out | the above and below slots share a row budget, cut whole rows are marked `… (widgets truncated)` | a tall widget stack otherwise squeezes the chat and the dock chrome |
| User message block | a background-filled block with the message text | the same block with the send time at the right end of its first row (`Sep 29, 9:29 PM`: short month, day, hour, and minute in the terminal's own locale), painted dim, with the body rendered narrow enough that no text can reach it | the block says when it was written, so a long conversation can be read by time without opening a session listing |
| Pointer hover feedback | no cue: lists ignore pointer motion, a message region answers clicks only, and the jump-to-end label is styled once | the cells under the pointer get a selection background and an underline (tab chips, command-palette rows, the dock meta row's model and thinking fields), a message block that answers a click is filled as one rectangle, and the fullscreen renderer tells a component when the pointer leaves it, keeps chrome under capturing overlays unlit while non-capturing overlays leave it live outside their rectangles, and drops every hover when the terminal is resized | the fork's clickable chrome needs a cue that does not move the keyboard selection or the active tab |
| Mouse drag selection | selects any cell on screen, copies the cells verbatim, paints them with reverse video, and keeps following new output during the drag | scoped to the transcript, the prompt card and the notice panel; the copied text drops a framed surface's border rows, border columns, padding column and key-hint rows; the highlight uses the theme's `selectedBg` and is dropped by a release with copy-on-select on (a release with the setting off keeps it for the copy command), and it underlines the card rows inside a block that carries the pointer cue, whose fill uses the same background; a press holds the transcript so streaming output cannot move the selected rows, and the release leaves it there when the output grew past the viewport or the user scrolled | [Mouse Selection](mouse-selection.md) |
| Extension module resolution | bun loading the built dist keeps jiti's `tryNative` (native TS import), so an extension's bare `@earendil-works/*` imports resolve from ambient `node_modules` | bun loading the built dist resolves through `virtualModules`, so the specifiers that map lists always come from the running host; bun running the TypeScript source is unchanged | a second copy of `@earendil-works/pi-tui` puts `ToolExecutionComponent.prototype` patching on a class the host never rendered, so renderer extensions silently fell back to the built-in tool rows |
| Hidden thinking | the full reasoning text when hiding is off, the italic `Thinking...` label when it is on | with hiding on, each block renders as a three-row tail that follows the stream: a `Thinking` header whose duration ticks live and freezes when the block stops growing, and the last three visual rows behind a left rail, `…`-marked when earlier content was dropped. An extension `setHiddenThinkingLabel` still replaces the whole block. The `Thinking tail preview` row in `/settings` turns it off, and it defaults to on | the tail keeps the reasoning legible while it streams without giving the block the whole transcript |
| New-version prompt | checks `pi.dev/api/latest-version` at startup and prints an `Update Available` block with a changelog link, gated by `PI_SKIP_VERSION_CHECK` | no prompt about pi's own releases: the startup check, `checkForNewPiVersion` and `PI_SKIP_VERSION_CHECK` are gone | the fork reports outdated extension packages on [MixCode Home](home.md), and only there |
| Exit resume hint | prints `To resume this session: pi --session <id>` on interactive quit when the session is persisted | no such line: the print is removed, while the `formatResumeCommand` helper behind it stays for upstream's install-change warning | MixCode holds several sessions in one process and reaches them through its own tabs, so pi's `--session` command is not how a session is resumed |
| Settings overrides | `applyOverrides` layers a value onto the effective settings, and the next recomposition from the scopes (`save`, `reload`, a trust change) drops it | the override layer is kept and re-merged on every recomposition, and `clearOverrides` releases named fields | a tab's `/context-limit` narrows the compaction budgets, and a settings write in the middle of a turn would otherwise restore the full budgets without saying so |
| Batch automation | no `/batch` command and no `--batch` / `--batch-dry-run` flags; `--` always collects messages and `@file` arguments | `/batch <script> [-- <args...>]`, `--batch`, and `--batch-dry-run` run a Lua or TypeScript script that opens agent tabs; with `--batch`, `--` carries the script's arguments instead of messages, and `fengari` becomes a coding-agent dependency | scripting a fleet of agent tabs needs one entry point, and the script's arguments must reach it unparsed; see [Batch Scripts](batch-scripts.md) |
| Provider failure diagnostics | a failed request keeps only the provider-formatted `errorMessage`, so the raw exception is gone once the process ends and nothing captures its type, code or HTTP status | every built-in text adapter accepts `StreamOptions.onProviderError` and calls it with the raw exception at its terminal catch, and the interactive app installs an observer on the shared `ModelRuntime` that writes one bounded `[provider-error]` line (`provider`, `model`, `api`, up to five `{name, code, status}` nodes) into the console history | the provider's own message is what a user acts on, and what actually failed was otherwise only visible with a debugger attached; see [Provider Error Diagnostics](provider-errors.md) |
| Skill discovery | every session merges the project roots (`<workdir>/.pi/skills` and the `.agents/skills` directories from the workdir up to the git root) with the user roots (`<agent dir>/skills`, `~/.agents/skills`) | `MPI_PROJECT_SKILLS_ONLY` drops every skill the loader hands the filter with `user` scope (`<agent dir>/skills`) and every skill whose file lives outside the workdir, from the loader's `skillsOverride`, so the system prompt and the `/skill:<name>` list agree; unset leaves discovery untouched | a shared machine, an evaluation, or a per-repository checkout must be able to keep personal skills out of a project's prompt; see [Skill Isolation](skill-isolation.md) |
| Herdr pane state | no host marker and no process-wide extension channels: an extension that reports its pane to a terminal multiplexer has nothing to gate on and nothing to listen to | `main()` marks the process as MixCode (`MIXCODE ??= "1"`), and every tab's `EventBus` is registered so the host can broadcast `mpi:waiting-for-input` `{count, active}` (extension dialogs across every open tab) and `mpi:mark-done` `{reason}` (5 s after `/mark-done`) to all of them | the `mpi-herdr-report` extension needs both: a Herdr sidebar that cannot see `mpi` activity shows every pane as `unknown`. The reporter itself is not shipped by this fork; see [Herdr Pane Reporting](herdr.md) |

## Outdated upstream pages and source copy

Deliberately left unpatched:

| Page | Upstream text | Reality |
| --- | --- | --- |
| `packages/coding-agent/docs/slash-commands.md:23` | the `/new` row reads "Start a new session" | the command is `/clear` |
| `packages/coding-agent/docs/usage.md:59` | "`/new` starts a new session." | the command is `/clear` |
| `packages/coding-agent/docs/sessions.md:14` | "`/new` starts a new session" | the command is `/clear` |
| `packages/coding-agent/docs/keybindings.md:136` | `app.session.new` is described as "Start a new session (`/new`)" | the action clears the session; the command is `/clear` |
| `packages/coding-agent/docs/session-format.md:20` | "When available, pi uses the `trash` CLI to avoid permanent deletion" | `/delete-session` and the selector move the file into `<agentDir>/mixcode-pi/trash/`; the `trash` CLI only runs when that move fails |
| `packages/coding-agent/docs/usage.md:92` | `/debug` writes its output to `pi-debug.log` | the file is `mpi-debug.log`, since the debug log name follows `APP_NAME` |
| `packages/coding-agent/docs/cli-integration.md:95` | `piConfig.name` affects "the CLI banner, configuration paths, and derived environment variable names" | the fork pins the env var names to `PI_CODING_AGENT_DIR` / `PI_CODING_AGENT_SESSION_DIR`, so `piConfig.name` no longer changes them |
| `packages/coding-agent/docs/usage.md:49` | "Press `Shift+Tab` to cycle through supported levels" | the cycle key is `alt+t` |
| `packages/coding-agent/docs/keybindings.md:155` | `app.thinking.cycle` defaults to `shift+tab` | it defaults to `alt+t` |
| `packages/coding-agent/src/experimental/micro/README.md:30` | "Shift+Tab: cycle the current model's supported thinking levels" | micro's status line reads the live binding; only this hardcoded text is wrong |
| `packages/coding-agent/docs/keybindings.md:152` | `app.model.cycleForward` defaults to `ctrl+p` | no default key; `ctrl+p` is `app.palette` |
| `packages/coding-agent/docs/models.md:33` | "`Ctrl+P` cycles through available models" | `ctrl+p` opens the command palette; only `shift+ctrl+p` still cycles, and only back to the previous model |
| `packages/coding-agent/docs/custom-provider.md:102-105` | the custom-provider instrumentation checklist names `options.onPayload`, `options.onResponse` and the abort signal only | a provider that catches a request failure must also call `options.onProviderError(error, model)`; see [Provider Error Diagnostics](provider-errors.md) |
| `packages/coding-agent/src/cli/args.ts:303` (source copy) | the `--models` help says "patterns for Ctrl+P cycling" | `ctrl+p` opens the command palette; the cycle key is `shift+ctrl+p` (`alt+p` on Windows and WSL) |
| `packages/coding-agent/docs/slash-commands.md:30` | `/compact [instructions]` | the fork also accepts a leading `provider/modelId` that runs only the summary on that model |
| `packages/coding-agent/docs/compaction.md:41` | "trigger manually with `/compact [instructions]`" | same: the summary model can be named before the instructions |
| `packages/coding-agent/docs/environment-variables.md:85` | `PI_SKIP_VERSION_CHECK` disables the `pi.dev` latest-version request | the variable and the startup check that read it are removed |
| `packages/coding-agent/src/utils/version-check.ts` (source copy) | exports `checkForNewPiVersion`, the startup check that reads `PI_SKIP_VERSION_CHECK` | removed; `getLatestPiRelease` and `isNewerPackageVersion` stay for `pi update --self` |
| `packages/coding-agent/docs/usage.md:23` | "Press `Ctrl+T` to show or hide thinking blocks" | `ctrl+t` opens Tab Jump; `app.thinking.toggle` keeps the same default but the composer declines it behind the jump handler |
| `packages/coding-agent/docs/keybindings.md:157` | `app.thinking.toggle` defaults to `ctrl+t` | the same key belongs to `app.tab.jump`, which the composer registers first; the toggle is reachable only after a rebind |
| `packages/coding-agent/docs/settings.md:79` | `fullscreenExitOutput` set to `resume-hint` selects "only a session resume hint" as the exit output | the value still suppresses the transcript on exit, and nothing is printed in its place |

Those pages also never list the tab keybindings and tab slash commands — `/jump` and its `ctrl+t`
chord included; [Agent Tabs](tabs.md) is the source of truth for those. Every binding the fork rebinds
or adds, on every surface, is collected in [Keybindings](keybindings.md).

## Upstream files modified by this fork

Each one is a potential conflict point, so edits are kept down to the wiring that calls into `mixcode/` code:

- `packages/coding-agent/src/modes/interactive/interactive-mode.ts`: wiring for the fork-owned
  `TabController`, `ExtensionUiController`, `ForkCommands`, `TurnController`, and `TabUiHandover`.
  Command recognition and displaced draft ownership live in `ForkCommands`; retract markers and
  failure/settle reactions live in `TurnController` at explicit event checkpoints. `TabUiHandover`
  owns transcript caching/warming, serialized switching, bind deduplication and deferred resource
  mounting. Home/transcript rendering, session extension setup and core status rendering retain
  host integration. `ExtensionUiController` owns per-tab dialogs, chrome, widgets, custom editors,
  input subscriptions, and the process-wide waiting-for-input count.
- `packages/coding-agent/src/core/agent-session-runtime.ts`: the runtime factory accepts the
  project trust context that a tab resumed into another workdir supplies
- `packages/coding-agent/src/config.ts`: `ENV_AGENT_DIR` / `ENV_SESSION_DIR` are pinned to the `PI_*` names instead of following `piConfig.name`
- `packages/coding-agent/src/modes/interactive/components/status-indicator.ts`: summary model label and reason-specific message colors
- `packages/coding-agent/src/modes/interactive/components/session-selector.ts`
- `packages/coding-agent/src/modes/interactive/components/custom-editor.ts`
- `packages/coding-agent/src/modes/interactive/components/extension-selector.ts`: the `keyShortcuts` option and the `y`/`n` shortcut arm on extension selectors
- `packages/coding-agent/src/core/keybindings.ts`
- `packages/coding-agent/src/core/slash-commands.ts`
- `packages/coding-agent/src/core/extensions/runner.ts`
- `packages/coding-agent/src/modes/interactive/chat-viewport.ts`
- `packages/coding-agent/src/main.ts`: the `MIXCODE` host marker, the host pid in `MIXCODE_PID`, and the per-tab `EventBus` registration
- `packages/coding-agent/src/core/session-manager.ts`: `getDefaultSessionDirPath` is exported
- `packages/coding-agent/src/index.ts`: re-exports `getDefaultSessionDirPath` for embedders
- `packages/coding-agent/src/core/agent-session.ts`: request-scoped manual compaction model, the claim that marks compaction active before it aborts the running turn, the steering and follow-up queue splice, `resetLeafToRoot()` for `/reset`, and `syncCacheWarmingMode()` (the warming reconcile without the settings write)
- `packages/coding-agent/src/core/settings-manager.ts`: the fork's fullscreen `tuiMode` default and a
  retained override layer (`applyOverrides` keeps its overrides across scope recompositions, and
  `clearOverrides` releases named fields)
- `packages/coding-agent/src/core/extensions/loader.ts`: routes bun-dist extension imports through `virtualModules`
- `packages/coding-agent/src/modes/interactive/tui-renderer.ts`: forwards the host's copy callback and selection options to the alternate screen
- `packages/coding-agent/src/modes/interactive/theme/theme.ts`, `theme/theme-json.ts`,
  `theme/theme-schema.json`: the `panelBg` background used to fill framed cards, with
  `withThemeColorFallbacks` defaulting it to `toolPendingBg`, which leaves the built-in theme files
  unmodified; the JSON schema validates `panelBg` through the shared `#/$defs/colorValue` definition
- `packages/coding-agent/test/extensions-runner.test.ts`
- `packages/coding-agent/test/interactive-tui.test.ts`: upstream copy assertions follow the fork's
  toast behavior; the fork-only selection-copy handover scenario lives in `test/mixcode/clipboard.test.ts`,
  and the status-spacing hosts carry the `homeSelection` state `clearStatusIndicator` reads
- `packages/coding-agent/src/modes/interactive/tui-renderer.ts`: underlines the jump-to-end label while the pointer is over it
- `packages/coding-agent/src/modes/interactive/components/tool-execution.ts`, `assistant-message.ts`,
  `compaction-summary-message.ts`, `branch-summary-message.ts`, `skill-invocation-message.ts`: clickable regions use the fork's `HoverRegion`, since the bundled `MouseRegion` draws no highlight
- `packages/ai/src/types.ts`, `packages/ai/src/api/simple-options.ts`, the ten `packages/ai/src/api/*`
  text adapters and `packages/ai/src/providers/faux.ts`: the `onProviderError` stream option, its
  `streamSimple` forwarding, and the one-line `notifyProviderError` call at each terminal catch
- `packages/coding-agent/src/modes/interactive/components/user-message.ts`: the send time at the right end of a message's first row
- `packages/ai/src/api/openai-responses-shared.ts`: records the model name the server reports in a
  Responses stream onto `AssistantMessage.responseModel`
- `packages/ai/src/api/anthropic-messages.ts`, `packages/ai/src/api/openai-completions.ts`: record the
  reported model through the same helper as the Responses adapter, so the overwrite rule has one definition
- `packages/agent/src/agent.ts`: the steering and follow-up queue APIs
- `packages/tui/src/components/editor.ts`, `packages/tui/src/editor-component.ts`: `setHistory` replaces a whole prompt history, a recalled entry takes the caret at its end, and `cursorVisible` hides the caret of a locked editor
- `packages/tui/src/layout-node.ts`: the `WindowedLayoutNode` arm of the `LayoutNode` union
- `packages/tui/src/mixcode/windowed-node.ts`: the windowed layout state and the scroll line provider
- `packages/tui/src/components/settings-list.ts`: the optional `section` heading row on `SettingItem`
- `packages/coding-agent/src/modes/interactive/components/settings-selector.ts`: the `MixCode` section entries, the `Fullscreen exit output` description, and the `onSettingsChanged` hook the panel calls after a row change
- `packages/coding-agent/src/modes/interactive/theme/theme.ts`: the `getSettingsListTheme` section heading style
- `packages/tui/src/layout.ts`: windowed scroll child, the line provider carried on a scroll box, the
  `honorOffset` argument a suspended scroll view passes to its windowed child, and the
  `HStack` intrinsic-height measurement skipped for a stretched child of a known height
- `packages/tui/src/mixcode/layout-queries.ts`: `getComponentBox`, the scroll line provider lookup, and
  the materialized-line query
- `packages/tui/src/components/scroll-view.ts`: `setFollowSuspended` / `isFollowSuspended` /
  `resumeFollowEnd`, so a pointer gesture can hold the rows it is selecting over
- `packages/tui/src/components/box.ts`: `componentAtRow`, so a row inside a padded card resolves to the
  child that painted it (the descent a host walks to find the component a transcript row belongs to)
- `packages/tui/src/tui.ts`: the overlay mouse dispatch reports the overlay it hit, so a point
  outside it can be told from a point on it; `Container.componentAtRow` so a host can resolve a row to
  the component that painted it, `hasCapturingOverlay`, and the overlay rect lookup the surface
  resolver needs
- `packages/tui/src/mixcode/selection-types.ts`: the `TuiSelectionOptions` contract (including
  `clearOnRelease` and a `highlight` handed the painted line)
- `packages/tui/src/mixcode/child-at-row.ts`: the row-to-child hit test `Container` and `Box` share
- `packages/tui/src/mixcode/settings-sections.ts`: the section-heading row plan the list renders and
  hit-tests against
- `packages/tui/src/tui-alt-screen.ts`: reads content lines through the provider; selection reads
  only its requested rows so measuring offscreen history cannot invalidate the pointer's row coordinates;
  public `scrollToPrompt`;
  an `onCopyResult` option lets the host confirm a clipboard write instead of the screen's own flash,
  and reports the copied text as a grapheme count; tracks the hovered component so the next move
  elsewhere, an overlay, or a pointer capture can send it a leave event; `scrollToEndIndicator`
  receives whether the pointer is over the label; a `selection` option scopes the drag to host surfaces
  and takes the host's text cleanup, style and release clearing
- `packages/tui/src/mixcode/text-metrics.ts`: `countGraphemes`, so the coding-agent toast can report
  a copy in the same unit
- `packages/tui/src/index.ts`: exports for the windowed node, mouse dispatch, the grapheme counter and
  the image-line predicate, and the selection options
- `packages/coding-agent/src/cli/args.ts`: the `--tui-mode` help line names the fork's default
- `packages/coding-agent/test/settings-manager.test.ts`: the TUI mode assertions expect the fork's
  fullscreen default
- `packages/coding-agent/test/keybindings.test.ts`, `packages/coding-agent/test/interactive-mode-compaction.test.ts`: the queue bindings and the compaction paths
- `packages/coding-agent/test/interactive-mode-status.test.ts`: the `showExtensionCustom` case gives its
  hand-built host the per-tab interaction registry the dialog methods read
- `packages/coding-agent/src/utils/version-check.ts`: `checkForNewPiVersion` removed, since the startup prompt was its only caller
- `scripts/build-coding-agent-bundle.mjs`: `fengari` remains external in the bundle and is allowed
  as a runtime package for Lua batch scripts
- `scripts/profile-coding-agent-node.mjs`: `--offline` no longer sets the removed `PI_SKIP_VERSION_CHECK`
- `packages/coding-agent/test/version-check.test.ts`, `packages/coding-agent/test/package-command-paths.test.ts`: the removed check and its env var dropped from the cases
- `packages/coding-agent/test/interactive-mode-startup-input.test.ts`: the hand-built submit host
  supplies the Home attachment and session-binding gates required before input dispatch
- `packages/coding-agent/test/suite/regressions/4167-thinking-toggle-pending-tool-render.test.ts`:
  the test host provides the response-model notice callback used by transcript rendering
- `packages/coding-agent/test/suite/regressions/5080-signal-shutdown-extension-cleanup.test.ts`: the resume-hint case dropped with the hint, leaving the shutdown ordering it was written for
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
