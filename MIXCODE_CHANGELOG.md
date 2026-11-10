# MixCode Changelog

Own changes on top of pi. The upstream anchor lives in `UPSTREAM.json`.

Newest first, sections `Breaking Changes` / `Added` / `Changed` / `Fixed` / `Removed`.
Entries say what changed and why; the why is the part git does not keep. When merging a new
upstream tag, insert a boundary heading `## base pi vX.Y.Z — <date>` above the previous one and
point `## [Unreleased]` at the new tag.

## Unreleased — base pi v1.5.2

### Added

### Changed

### Fixed

### Removed

## base pi v1.5.1 — 2026-11-13

### Added

### Changed

### Fixed

### Removed

## [Unreleased] — base pi v1.5.0

### Added

### Changed

- Merged upstream pi v1.5.0, preserving per-tab dialogs, windowed transcript rendering,
  provider error diagnostics, response-model notices, and Lua batch dependencies.

### Fixed

- A transcript frame that is not a scroll no longer moves the rows the reader is looking at. Collecting
  a window covers 20 overscan rows above the viewport, and measuring an estimated block up there
  renumbers every row below it, but the frame kept painting the offset it was handed: one repaint slid
  the conversation by the height such a block gained as soon as a dropped height table (a surface swap,
  a resize) left the blocks above the viewport back at the 4-row estimate. The placement is now
  re-resolved against the remembered anchor after a frame's own measurements, the recollect loop runs
  until the settled row holds still instead of stopping after two passes, and a caller that asked for
  another offset (search, prompt jumps, vim's message jumps) keeps the offset it asked for.
- Canonical session-ID replacement carries metadata and focus to the destination without
  overwriting its explicit values or dropping source aliases, preserving the stored format.
  The nested state/open-tabs locks share the original 5-second wait budget instead of restarting
  it for each acquisition.
- The dev launcher no longer treats the removed shx binary as a partial install, so repeated
  launches reuse complete dependencies while still repairing missing compiler or TypeBox files.
- Updated the fixed Together catalog fixture to the relocated generator and models.dev v2,
  preserving its regression coverage for delisted DeepSeek models.

### Removed

## base pi v1.4.0 — 2026-11-03

### Added

### Changed

- Merged upstream pi v1.4.0, retaining per-tab extension dialogs, provider error diagnostics,
  response-model notices, and Lua batch dependencies alongside the new client identity API.
- `/close-all-sessions` confirms on the typed word `CLOSE` instead of a `y`/`n` dialog. Closing every
  other tab in one go deserved the same no-single-key guarantee `/delete-all-sessions` already had, so
  the delete panel was generalized into a shared typed-word component and both commands use it
  (`DELETE` for delete-all, unchanged behavior).

### Fixed

- Saving the shared tab layout no longer fails on a filesystem that refuses hard links. The state
  lock was published with `link` only, so `EPERM` / `ENOTSUP` from a network or restricted mount
  threw out of every tab metadata write. The lock now falls back to exclusive create, and when both
  are refused the writer proceeds unlocked: a single write still lands atomically, so only a
  concurrent merge can be lost.
- Single-file MixCode binaries find Photon WASM and native clipboard helpers in the extracted `PI_PACKAGE_DIR`; both resolvers previously searched near the executable, where single-file installations have no sidecar resources.
- Vim-mode paging (`ctrl+u` / `ctrl+d`) moves exactly 10 rows again after the windowed height
  table resets (tab switch, MixCode Home, a resize, a resumed session). The transcript's scroll
  offset is an absolute row number, and a reset re-estimates never-measured blocks at 4 rows, so
  every block the scroll walk measured above the viewport renumbered the rows under the reader:
  one page key moved 30-60 rows, later presses pinned at the estimated top and stopped moving.
  Relative scrolls now carry their delta into the windowed child, which resolves it against the
  remembered anchor block instead of the row number, after measuring the rows the moved view will
  paint. Wheel scrolling and the viewport's page keys get the same exactness.
- The fullscreen viewport's own scroll keys keep working in vim mode. `ctrl+u` / `ctrl+d` reach the
  vim page action without taking the rest of the viewport's commands with them: the
  `↓ Jump to latest message · Ctrl+End` label stayed on screen during vim mode while `ctrl+end` did
  nothing, because the whole viewport key block was skipped instead of just the two page keys.
  `ctrl+home`, `ctrl+end` and the prompt jumps answer again while the modal surface owns input.
- A restart now selects the tab that was focused last, as `docs/tabs.md` describes. Focus is not a
  layout change, so no publication covered it: the peer poll folded the focused tab into its delta
  baseline without writing it, the exit-time publish then saw no change and skipped the write, and
  the next start selected whichever tab had been published last. The exit path now records the
  focused tab on its own, so Home comes back on the agent the user left.
- A command that keeps the tab in front (`/close-all-sessions`, `/delete-all-sessions`) no longer
  moves the reader's transcript. Both re-enter the mounted tab through the switch path, and taking
  the tab's remembered row there put back the row it had when it was last left, so a transcript
  scrolled somewhere else jumped away from where the reader was. A tab that was never left has no
  surface to swap, so it keeps the live viewport instead.
- Vim mode's composer hint now names the keys the user actually has, and it names the page action.
  The row was a fixed string, so after rebinding `app.vim.*` in `keybindings.json` it kept promising
  `j/k`, `gg`, `G` and `q` while the rebound keys were the ones that worked, and it never mentioned
  `app.vim.pageUp` / `pageDown` (`ctrl+u` / `ctrl+d`) at all - the mode's only 10-row jump, which the
  [Vim Mode](docs/vim-mode.md#keys) page documents. Every segment is now read from the keybindings
  like the rest of the dock's hints, and an unbound action drops out instead of naming a dead key.
- An extension dialog focused in zen mode now receives `tab` and `shift+tab`. The app answers those
  keys before the dialog while the dialog owns the keyboard, and zen's tab cycle consumes them
  without switching anything, so the key disappeared on its way to the dialog and a view that wanted
  tab for its own navigation never saw it. Zen hides the bar, so the cycle now declines those two
  keys while a dialog is focused; off zen the dialog still leaves them to tab switching.
- Switching to another agent tab no longer inherits the scroll offset of the tab it replaced. One
  scroll view serves every tab, so leaving a transcript scrolled up and focusing another one showed
  that tab at the same offset, in the middle of unrelated output. Each tab now keeps the block its
  viewport top sat on, and the incoming tab resolves its own anchor on the next frame; a tab that was
  at its newest output, or whose transcript was rebuilt while parked, lands at the end instead. Home
  captures the tab behind it before taking the scroll view, so going through Home keeps the position
  too. See [Windowed Transcript](docs/windowed-transcript.md).
- `/delete-session` and `/delete-all-sessions` now refuse while a `!` command still runs in one of
  the tabs they would delete. The delete commands move the session file to the trash and keep the
  tab's session running, so a bash command that finished afterwards recreated the file at the old
  path with only its result and no session header - `docs/tabs.md` names exactly that replacement as
  the reason these commands check a tab's state first. `/clear` and `/reset` already refused a
  running bash command; the deletion guard now does too and names the tab and the reason.
- The fullscreen transcript keeps the reader's rows when a frame drops the windowed transcript's
  measured heights. A content change that invalidates the container (an expanded card, a block that
  re-renders) wiped the height table, so every block outside the window fell back to the 4-row
  estimate, the total collapsed and the scroll view clamped the offset towards the newest output:
  reading back through the conversation with vim's `ctrl+u` or the wheel jumped by the height of
  whatever had been measured above the viewport. The remembered top block now survives the reset and
  is re-applied on the next frame, the way a width change already resolved it. See
  [Windowed Transcript](docs/windowed-transcript.md).
- The vim-entry prompt card ends with the one-second arm window it describes.
- Tab, Shift+Tab, `ctrl+t`, `ctrl+p` and `ctrl+q` now answer while an extension dialog sits on the
  editor slot (`select`, `confirm`, `input`, `editor`, `custom`, and the app's own session
  confirmations). The chrome shortcuts were routed only above a focused extension *overlay*, so a
  slotted dialog left them dead: `/close-session` kept the keyboard on its tab, the chip showed `?`,
  and none of the keys that `docs/tabs.md` says park a confirmation on its tab reached the app. The
  keyboard now follows the same rule for both dialog surfaces.
- The `/workdir` picker's key hints wrap instead of being cut. The panel truncates every body row
  at its content width without an ellipsis, so the second hint row ended inside a label on a narrow
  terminal - 64 columns drew `... · escape ca` and lost the cancel key. The hints are now packed
  from whole actions, so a wide terminal keeps its two rows and a narrow one gains a third; the
  list window gives up a row for each extra hint row, so the wrapped hints cannot push the panel
  past the overlay's height budget.
- A manual `/compact` on one tab no longer takes `Escape` away from every other tab. The claim
  that keeps queued rounds out of a starting compaction is process-wide, and the steer flush, the
  turn retract and the per-tab follow-up host read it for whatever session was in front, so a
  compaction running behind another tab refused to flush that tab's steer texts and to retract its
  unanswered turn; `docs/keybindings.md` says such a compaction is left alone. The claim is now read
  per session, and only the tab that started the compaction still defers to it.
- Vim mode's `pageUp` / `pageDown` now scroll the documented 10 rows: the fullscreen viewport no
  longer claims the page keys while a modal surface owns input, so they reach the vim action like
  `ctrl+u` / `ctrl+d`. Before, the viewport paged by its height minus four rows, so one action moved
  two different distances on the same terminal.
- A run that finishes while MixCode Home covers its tab now reports as an unread completion: the
  card reads `[done]`, the chip keeps `✓`, and `ctrl+f` keeps the tab listed. Home owns the screen
  but not the focus, so the tab manager compared the settling tab with its focus and took the
  completion for one the user watched. It now knows while Home covers the tabs, and only a focused
  tab that is not covered counts as watched.
- Closing or aborting a hidden extension dialog no longer steals focus from a newer dialog.
  Dialog status follows the remaining interaction, and a failed custom component restores the
  previous dialog without moving it between tabs.
- Package-command test fixtures use the configured application name for simulated executables
  and output, including the upstream managed-install BOM regression.

### Removed

## base pi v1.3.0 — 2026-10-22

### Added

### Changed

### Fixed

- A tab opened by `/clone` or `/fork` keeps the place it was created in instead of jumping to the
  end of the bar. Both commands open the new tab right after its source, but the shared layout
  reported a tab it had not recorded before by appending it to `open_tabs.json`, and the two-second
  peer poll then reorders the local tabs to that recorded order: the new chip slid to the end within
  a second of appearing and the next start restored it there. A tab this instance has not recorded
  before is now placed where its own tab list puts it, and the record's end is used only when no
  local tab follows it, so a peer's tabs that this instance does not hold are not pushed around.
- `/reset` keeps its transcript rebuild and notice on the tab that ran it. The command awaits the
  `session_tree` handlers, and a tab switch during that await moved `this.session` and the transcript
  to the tab now in front: that tab's conversation was rebuilt underneath it (dropping the response
  it was still streaming) and its status line read `Reset to session root`, while the tab that ran
  the command was never told. The command captures the requesting tab and its session before
  awaiting, rebuilds and reports only while that tab is still on screen, and flushes that tab's
  parked compaction messages instead of the tab in front's. A tab that went behind rebuilds from the
  new branch when it is shown again, the way any other branch change does.
- `/import`, the `/tree` branch-summary question and the `/resume` prompt for a missing session `cwd`
  keep their dialog when the user switches tabs. Those three host dialogs still opened without a tab,
  the same way the session commands' confirmations did: an interaction without a tab is not parked
  when its tab goes behind, and mounting the next tab clears the editor slot it waits in, so the
  dialog left the screen for good while its promise stayed unsettled. `/import` reported nothing and
  replaced nothing, `/tree` dropped the question after closing the tree selector, and `/resume` never
  opened the session. Each dialog now carries the mounted tab, so the chip reports the wait and the
  answer arrives on the tab that ran the command.
- `/delete-session`, `/close-session` and `/close-all-sessions` keep their confirmation when the user
  switches tabs. The app's own confirmation went through the extension dialog slot without naming a
  tab, so it was tracked with none: mounting another tab clears that slot, which takes the dialog off
  the screen for good while its promise stays unsettled, and the command never runs. The tab chip
  reports the wait and the dialog comes back with the tab, the same way an extension dialog does, so
  the answer is given on the tab that ran the command.
- A `!` shell command runs on the tab that submitted it, not on the tab in front. `handleBashCommand`
  awaits the extension `user_bash` handlers, and a tab switch during that await moved the runtime
  host: the command then executed in the other tab's working directory, its result was recorded in
  that tab's session (so it also reached that conversation's model context), and its block was
  painted into that transcript. The submit captures its session and tab before the emit, runs and
  records the command there, and paints the block only while that tab is still the one on screen; a
  tab that is behind another one rebuilds the block from the recorded result when it is shown again.
- `/workdir` no longer writes a `--no-session` conversation to disk when an extension refuses the
  move. A session started without a file has nothing to reopen, so the command wrote its branch into
  the target directory's session store first and then asked the runtime to switch to that file; an
  extension that cancels `session_before_switch` left the file behind. The tab stayed ephemeral while
  its whole conversation sat in a session file under the refused directory, and the command reported
  nothing at all, where the persisted branch reports `Workdir change cancelled`. A refused switch now
  removes the copy it just wrote and reports the same notice.
- `/resume-trash` reports a failed restore instead of opening the file from the trash. Picking an
  indexed entry moved its file back to the original path and then opened it, but a move that failed
  (a read-only project dir, a path an unrelated file or directory now holds) fell back to the trash
  path silently: the app opened that copy as a normal session and said `Resumed session`, while the
  trash index still listed it as deleted. The next turns were appended to the trashed file, so the
  next start dropped the tab as a deleted session and the trash size cap could evict the file. Only
  a file the index does not know, one dropped into the trash by hand, opens in place now; a failed
  restore shows the reason and leaves the entry restorable.
- `/mark-done` keeps its badge when `/new-session --no-focus` creates a tab. The command creates
  the tab focused and then restores the previous focus, and that restore went through `activate()`,
  which exists to clear a badge on a real focus change: the tab the user never left lost its `done`
  status and its unread badge, and the layout publish persisted `unread: false`, so a restart could
  not bring the badge back either. A background open from a peer instance restored focus the same
  way and cleared the same badge. Focus restores now go through `restoreFocus()`, which moves focus
  and the vim/zen mode without touching the badge.
- Two tabs can run `!` bash commands at the same time without their blocks crossing over. One
  `bashComponent` field and one pending list served every tab, and the output callback plus the
  completion branch read that field, so a second tab's `!` command replaced the block the first one
  was still writing to: the first command's remaining lines appeared inside the second tab's block,
  the first command's exit status completed that block, and the second command's later output was
  dropped without ever finishing its block. The block is now per invocation, and the pending list is
  keyed by tab, so a bash parked above one tab's composer no longer moves into another tab's
  transcript.
- An extension that sets its working surface from a tab created inside the session now reaches the
  screen. Every tab except the startup one binds through the tab-scoped extension UI context, whose
  `setWorkingMessage`, `setWorkingVisible`, `setWorkingIndicator`, `setHiddenThinkingLabel` and
  `setToolsExpanded` only wrote the tab's record: the value waited for a mount that the tab in front
  never takes, and leaving the tab overwrote the record with the live fields, so the value was lost
  for good. Those five setters now write a mounted tab's live surface as well, the way `setStatus`
  and `notify` already did.
- `/clear` keeps its color reset, its discarded queue and its completion line on the tab that ran
  it. The command awaits a full session replacement before those steps, and each read the focused
  tab instead; keys keep arriving while the replacement runs, so a `/tab` or chip click landing in
  that window made the reset and the discard hit the tab in front: it lost its color and its queued
  steer/follow-up rounds, and `✓ New session started` was written into its transcript, while the
  cleared tab kept its own queue and color. The command now captures the tab that asked, and writes
  the shared transcript only while that tab is on screen.
- `./run.sh` no longer reinstalls the workspace on every launch. Its dependency repair probed
  `node_modules/.bin/tsgo`, which TypeScript 7 no longer ships, so the probe always reported a broken
  install and each launch ran `bun install --force` first: about 20 seconds, and it pruned packages an
  earlier install had added. The probe now checks `node_modules/.bin/tsc`.
- An extension's `ctx.abort()` no longer empties the tab MixCode Home still points at into Home's
  composer. Home mounts no tab, so the abort kept taking the composer-restore branch for the last
  mounted session: the queued steer/follow-up text left its tab, attaching to that tab was refused
  while the composer held it, and Enter sent that text as a brand-new turn to whichever agent the
  roster selected. A tab without a composer of its own now keeps its queued text as that tab's draft,
  and the stopped session no longer dispatches its leftover queue as a fresh run.
- An extension's `ctx.abort()` on a tab behind another one stops that tab's run instead of the run
  on the tab in front. Every bound session shares one abort handler that restored the mounted
  session's queued messages and aborted it, so a watchdog or timeout extension running in the
  background killed the user's turn and pulled its queue into the wrong composer. The handler now
  aborts the session its binding belongs to and pauses that tab's own rounds, as a failed
  background run does; the mounted tab keeps the composer restore.
- `/compact src/auth.ts tighten the summary` no longer fails with `Unknown model: src/auth.ts`. The
  leading word names the summary model only when the catalog resolves it or its provider is known;
  every other first word, a path included, stays part of the instructions. A misspelled model of a
  known provider still reports the unknown model.

### Removed

## [Unreleased] — base pi v1.2.0

### Added

### Changed

- Merged upstream pi v1.2.0, retaining MixCode keybindings, startup settings, Lua batch support,
  panel backgrounds, and compaction model labels alongside upstream schema validation and editor colors.

### Fixed

- A background tab that starts another run before its completed answer is viewed shows the live
  working dot instead of the previous completion check mark. The unread flag remains until the tab
  is viewed, so another background completion still appears as done.
- Compaction keeps its reason and model label after switching tabs, and its tab shows the busy
  dot until the operation ends. A summary completed in the background appears after the retained
  conversation when the tab is reopened, matching foreground completion.

### Removed

- Removed the fork-only `panelBg` theme token. Toasts, settings, Tab Jump, and user-message
  previews use upstream `toolPendingBg`, keeping panel backgrounds compatible with the published
  theme schema and avoiding theme-token conflicts on upstream merges.

## base pi v1.2.0 — 2026-10-13

## Fork changes on base pi v1.1.0

### Breaking Changes

- `install.sh` and `run.sh` environment variables lost the `MIXCODE_` prefix: `MIXCODE_INSTALL_NAME` is now
  `INSTALL_NAME`, `MIXCODE_INSTALL_PREFIX` is now `INSTALL_PREFIX`, and `MIXCODE_SKIP_MODEL_HYDRATE` is now
  `SKIP_MODEL_HYDRATE`. The old names are no longer read, so scripts that set them silently fall back to the
  defaults.

### Added

### Changed

- `/delete-all-sessions` confirms on a typed word instead of a Yes/No dialog. The dialog had `Yes`
  selected and answered to a single key, so one stray Enter or `y`, including one sent into the terminal
  by `mpi ctl send-keys`, deleted every open tab's session file. The run now needs `DELETE` entered in
  full, matching mixcode-pi. A tab that is busy is refused before the panel opens, so a confirmation that
  could only fail is never asked for.

### Fixed

- A `--batch` script that cannot load or validate now fails the command instead of starting the TUI.
  The script path was handed to the interactive mode, which loaded it after startup and reported
  every failure as a chat notice, so a broken script left a live TUI and a zero exit code. Loading
  and validation now run before the interactive loop: a failure restores the terminal, writes the
  message to stderr, and exits 1. A failure while applying an already loaded plan keeps the notice.
- A failing batch script now points at the line that failed. The Lua executor loaded the script with
  `luaL_dostring`, which names the chunk after the first 60 characters of the script's own source, and ran
  it without a message handler, so an error inside a helper reported `[string "local function ..."]:12` and
  no caller. It now loads the chunk as the script path and runs it through `lua_pcall` with
  `luaL_traceback`, so the message reads `Lua error in <path>:12: ...` followed by the Lua call chain. The
  TypeScript executor reported only the exception message; it now appends the script's own stack frames,
  which the module loader already maps back to the source file.
- A deleted session no longer comes back as an empty tab. Deletions removed their ids from the shared
  layout through the tab set's delta, which reports removals against the last locally published
  snapshot, so a delete whose publish did not land left the ids in `open_tabs.json`. The next start
  rebuilt each one as a header-only session: the tabs returned with empty chats while their files sat in
  the trash. The command now drops the deleted ids by name, a start that reads a trashed id skips that
  tab rather than rebuilding it, and a placeholder file an earlier start left under the id moves to the
  trash so the session `/resume-trash` restores is not shadowed.
- A confirmed interrupt stays on the tab that armed it. The retract behind the second `Escape` awaits
  `session.abort()`, and a tab switch during that await moved the runtime host, so the retract finished
  against the tab now in front: it read that tab's branch and queues, and the fallback
  `restoreQueuedMessagesToEditor({ abort: true })` aborted the run the user was
  watching and pulled that tab's queued rounds into its composer. A background tab's run could therefore
  be cut off by an interrupt confirmed on another tab. `retractCurrentTurn` now takes the session that
  armed the interrupt and drops the rewind once that session is no longer mounted; the interrupted run
  stays aborted, and the tab in front is left untouched.
- A batch request that empties the session of the tab on screen rebuilds that tab's transcript. `mode="clear"`
  and a `/reset` prompt both call `resetLeafToRoot()` without the transcript rebuild the composer's `/reset`
  does, so the model context was emptied while the screen kept the old conversation, the next round was
  appended below it, and switching tabs did not repair it (a tab's transcript returns from the handover
  cache). `BatchCommandHost` gained `resyncTabTranscript`, which the interactive mode applies only to the
  tab its UI is mounted on.
- A queued host command runs on the tab that queued it even when MixCode Home is the surface in front.
  `/follow-up <command>` dispatches the round through `FollowUpHost.runQueuedCommand`, which attached the
  owning tab only when `activeTabIdForUi` named another tab. Home leaves that field on the tab behind it
  while taking over the composer, so the guard skipped the attach and the shared submit path re-derived its
  target from `homeSelectedTab(...)`: the round ran on whatever the roster had selected. A queued
  `/rename`, `/close-session`, `/delete-session`, `/clear`, `/model` or extension command could therefore act
  on a different tab. The guard now attaches the owning tab whenever Home owns the composer.
- A tab behind another one pauses its own follow-up queue when its run fails. The failure marker lives in the
  focused session's turn checkpoints (`TurnController` writes `followUpRunFailed` through
  `host.followUpState`), and switching tabs unsubscribes the outgoing session, so a round queued on a tab and
  then left in the background was dispatched into the session that had just failed, without the documented
  `Paused · /follow-up to resume` step. `TabManager` already sees every tab's `message_end` and
  `agent_settled`; it now tracks a failed assistant message per tab and reports it for the tabs that are not on
  screen, where the interactive mode pauses that tab's queue. The marker is per run: a failed or aborted
  message sets it, the next run's start clears it, and settling consumes it, so a later round starts unpaused.
- `package-lock.json` is in sync with `packages/coding-agent/package.json` again, so `npm ci` succeeds. The
  upstream v1.1.0 merge took upstream's side of the lock conflict and dropped `fengari@0.1.5` and its three
  transitive dependencies, which the `.lua` batch executor needs; every `npm ci` since failed with
  `Missing: fengari@0.1.5 from lock file`. The sprintf-js denial-of-service advisory fengari brings in is now
  accepted in `scripts/npm-audit.mjs`, because 1.1.3 is the newest release and the format string comes from the
  local user's own batch script.
- A tab opened with `/new-session --no-focus` loads its extensions in the background instead of
  staying in its loading state forever. Only the focus path bound the new session's extensions, so
  the chip kept spinning, MixCode Home listed the tab as loading, and the loading spinner asked for
  a repaint every 80 ms until the tab was focused. A prompt sent to that tab from Home ran on a
  session whose extensions had never loaded. The background path now queues the bind a peer-opened
  tab gets.
- jiti's disk cache of transformed extensions moved out of the shared tmpdir and gained a trim.
  jiti's default is a `node_modules/.cache/jiti` directory beside whichever module calls
  `createJiti`, and `<os.tmpdir()>/jiti` when no such `node_modules` exists, which is the case for
  every layout this package ships. On a shared host the tmpdir fallback can already exist and belong
  to another user: its writability probe then fails, it silently sets `fsCache: false`, and every
  boot re-transforms every extension in pure JS (measured with the Node runtime: 11.9 s of startup
  instead of 3.3 s). The extension loader and the batch executor now pass
  `cache: resolveJitiCacheDir()`, which resolves to `<agent dir>/cache/jiti` — beside the other
  `<agent dir>/cache/<owner>` directories an extension already uses — or to `false` (no disk cache)
  when that cannot hold one. The shared tmpdir is never used and `TMPDIR` is left alone. A
  persistent cache may sit on a network filesystem and cost a few hundred milliseconds to read at
  boot (measured: 133–476 ms for 570 entries, against 18–28 ms on local disk), and entries are keyed
  by module path, so a deleted module would otherwise leave its file behind forever: an entry's
  write time older than 30 days now drops it, at most once per 24 hours, best effort. Ported from
  `mixcode-pi` `ba3ca46`, which redirects `TMPDIR` instead.
- A queued host command that moves the tab (`/follow-up /new-session`, `/follow-up /close-session`,
  `/follow-up /tab 2`) no longer types the origin tab's composer draft into the tab the command
  opened, and no longer wipes it from the origin. `runQueued` put the displaced draft back into
  whatever composer the command left behind; the tab switch had already parked the just-cleared
  composer over the origin's draft, so the text survived only in the new tab and the origin lost it.
  `runQueued` now parks the draft back on the tab it was typed in, the way `runHome` and `runPalette`
  already hand a draft to the surface that owned it.
- A `/command` submitted on MixCode Home from the suggestion list no longer erases the parked draft of
  the tab it runs on. Enter on the list applied the completion and fell through to the composer's submit,
  which dispatched the command without the draft handling that Enter after Escape and the command palette
  use. The list path now uses the same handling.
- A command picked from the `ctrl+p` palette on MixCode Home no longer erases the parked draft of
  the tab it runs on. The palette read the composer's owner before it submitted, and Home's composer
  is ephemeral, so it recorded Home as the owner; the submit then attached the roster's selected tab,
  which loads that tab's own parked draft into the shared composer, and the command cleared it. The
  restore path compared against Home, took the "the command moved focus" branch and handed nothing
  back, and the next park wrote that emptiness over the tab's draft, so the text was gone for good.
  `runPalette` attaches Home's selection before it reads the composer, the way a command typed on Home
  already did, so the draft comes back exactly as it does for a command started on an agent tab.
- `install.sh` and `run.sh` refresh the generated model catalog on every build instead of only when
  `check:model-data` fails. The catalog under `packages/ai/src/providers/data/` is gitignored, so an
  upstream sync leaves the local copy behind, and `check:model-data` compares only its structure: an
  entry that keeps the same layout but lost a field the generator now always writes passed the check
  and was baked into the binary. That is what happened to `claude-haiku-5-5`, whose missing
  `thinkingLevelMap` capped it at `high` for every consumer of the static catalog — extension
  providers such as `claude-bridge` read it directly, while the built-in picker was masked by the
  pi.dev catalog overlay. `SKIP_MODEL_HYDRATE=1` keeps the existing catalog for an offline
  build and fails loudly when it is structurally stale.
- Vim mode no longer removes the blank row between the transcript and the editor. The dock's
  above-editor widget slot draws that row even while it hides its widget rows, but the fullscreen
  dock also carried a `widgetsVisible` predicate that dropped both slot entries from the layout,
  taking the row with them: in inline widget mode the last widget body sat directly against the
  input card, and a docked widget stack lost the same row. The slot owns that decision now
  (`widgetsHidden` covers vim mode), and the viewport keeps every entry, so the row stays.
  `createChatViewport` drops the predicate and returns to upstream's shape. Home and an open side
  panel hide their widget rows through the same slot, so in fullscreen they gain that row too,
  which regular mode already draws.
- A manual `/compact` no longer leaves the interrupt retract and the steer flush dead for the rest
  of the process when its compaction ends on a background tab. `compactionClaimed` is a
  process-wide guard that `/compact` sets synchronously and only the focused session's own
  `compaction_end` used to clear, so a tab that compacted and then lost the focus kept the guard
  set forever: the confirmed `Escape` fell through to a plain abort and `Escape` with queued steer
  texts stopped flushing them. The guard now records the session that claimed it, and that session's
  own `compaction_end` releases it from either path, including the tab manager's callback for a tab
  that is not on screen.
- Extension chrome no longer disappears when a tab keeps its session slot but gets a new session.
  `ExtensionUiController.attachTabUi` mounts a tab's record, and a session replacement drops that
  record (`rebindCurrentSession`) while the tab's own extensions install again through the focus it
  still holds. Attaching the tab that is already mounted therefore mounted an empty record and wiped
  its footer, statuses, widgets and replaced editor, and the next switch parked the wiped state, so
  it never came back. `/delete-session` and `/delete-all-sessions` replace the session of the tab
  they keep and re-attach it, so they dropped the chrome of the tab the user stayed on; the live
  chrome of the mounted tab is the record now.
- `/close-session` no longer leaves the active session with two live event listeners when the close
  is refused. The command called the module-level `handleCloseTab` without the unsubscribe the
  keyboard path did first, and the refusal branch re-subscribed on top of the existing listener, so
  every later event was handled and rendered twice (duplicate user bubbles, duplicated streaming
  components) until the process exited. `handleCloseTab` owns the subscription move now, so both
  paths take the same unsubscribe/re-subscribe step.
- A tab switch to a session that is compacting or summarizing no longer leaves `Working` stuck in
  the composer's top edge after the summary ends. `TabUiHandover.switchActiveTab` can only read
  `session.isCompacting`, so it paints a plain working indicator, while `compaction_end` and the
  branch summary path cleared with `clearStatusIndicator("compaction")`/`("branchSummary")`, whose
  kind check finds no match and returns without clearing. `InteractiveMode.clearSummaryStatusIndicator`
  now clears that working indicator too, and leaves it alone while an agent run owns it
  (`session.isStreaming`).
- `/reload` no longer leaves the mounted tab without `$` skill completion until it is remounted.
  `ExtensionUiController.resetExtensionUI` replaced the live `autocompleteProviderWrappers` array,
  while a tab restored in the background keeps a tab-scoped extension context that pushes into the
  tab record, so the provider was rebuilt without the wrappers the reloaded extension registered.
  The reset now empties that record's array and adopts it as the live one.
- `install.sh` compiles the standalone binary with `src/extensions/codemode/worker.ts` as an explicit
  entrypoint, matching `scripts/build-binaries.sh`. A bun-compiled binary resolves the codemode
  worker to that embedded source path, so the omitted entrypoint made every codemode script fail
  with `Cannot find module './src/extensions/codemode/worker.ts'`.
- Restored the send time at the right end of a user message's first text row. The v1.0.0 merge took
  upstream's `UserMessageComponent` wholesale and left `mixcode/message-clock.ts` unreferenced, so
  the block lost its clock. The timestamp is the component's last constructor argument again, and
  the clock body finds the first row that carries text and paints the cells it takes over with the
  block's own background, because the component no longer wraps its Markdown in a filled `Box`.
- Restored the tab routing of extension dialogs. The v1.1.0 merge resolved the conflict by keeping
  upstream's direct implementations of `showExtensionSelector`, `showExtensionConfirm`,
  `showExtensionInput` and `showExtensionEditor`: they mount a dialog on whichever surface is in
  front and ignore the tab the scoped context passes. The four delegate to `ExtensionUiController`
  again, so a background tab's dialog parks with that tab, and each one still reports its block to
  the terminal while the extension waits, clearing it when the dialog is answered or when its tab's
  interactions are dropped.
- Gave the fake hosts in `test/mixcode/turn-events.test.ts` and
  `test/mixcode/follow-up-mode-wiring.test.ts` the `programStatus` field `handleEvent` reads, and
  covered the parked input, confirm and editor dialogs in `test/mixcode/tab-dialog-scope.test.ts`.
- Restored upstream's `packages/coding-agent/test/format-resume-command.test.ts`. The fork deleted it
  with the exit resume hint, but upstream's install-change warning reuses `formatResumeCommand`, so
  the helper is live again and its 8 cases cover it. `docs/upstream-drift.md` and `docs/keybindings.md`
  also lost their `tui.altScreen.top`/`bottom` and `formatResumeCommand` rows: upstream v1.0.3 moved
  transcript scrolling to `ctrl+home`/`ctrl+end` and left plain `home`/`end` to the editor, which is
  what the fork had asked for, so the fork no longer patches those defaults.
- Three fork docs described behavior the code does not have. `docs/windowed-transcript.md` said vim's
  user-message jumps read rows from the height table without materializing, while the jump calls
  `matchingBlocks`, which measures the whole document because the preview panel needs each match's
  label and its row; the preview-panel change left the sentence behind. `docs/inline-widgets.md` said
  nothing suppresses the inline widget block, while the widget panel stands it down; that sentence
  predates the panel. `docs/mouse-selection.md` called `selectedBg` the transcript search's token,
  which held while the shipped themes aliased `searchMatchBg` to `selectedBg`; the v0.99.0 merge gave
  `searchMatchBg` its own colour, so the parenthetical is gone. Each `.zh.md` mirror carries the
  corrected statement.

### Removed

- `WindowedTranscript.findBlockRow`: the preview-panel change replaced its single caller in
  `interactive-mode.ts` with `matchingBlocks`, which also returns the block the panel has to label,
  so the row-only helper had no call site left.

## base pi v1.1.0 — 2026-10-09

## base pi v1.0.4 — 2026-10-09

## base pi v1.0.3 — 2026-10-09

## base pi v1.0.2 — 2026-10-09

## base pi v1.0.1 — 2026-10-09

### Fixed

- Fixed `/settings` theme submenu showing "automatic" instead of "Automatic" as the option label
- Fixed hover cue test asserting a hardcoded ANSI color instead of the theme token, which broke when `blueBg` changed

### Removed

## base pi v1.0.0 — 2025-07-14

## base pi v0.99.2 — 2025-07-14

## base pi v0.99.1 — 2025-07-14

## base pi v0.99.0 — 2025-07-14

## [Unreleased] — base pi v0.87.1

### Breaking Changes

- pi-tui's `ClipboardResult` reports the copied length as `graphemes` instead of `chars`, and the
  count is grapheme clusters rather than UTF-16 code units. The `WindowedWindow` type is renamed
  `RenderedLineWindow`. Both are exported from `@earendil-works/pi-tui`, so an importer of either
  needs the new name.

### Added

- A Herdr pane reports its agent state. `main()` marks the process as MixCode (`MIXCODE ??= "1"`),
  and every tab's `EventBus` is registered so the host broadcasts `mpi:waiting-for-input`
  `{count, active}` (extension dialogs across every open tab) and `mpi:mark-done`
  `{reason: "command"}` (5 s after `/mark-done`) to all of them. The `mpi-herdr-report` extension
  under `<agent dir>/extensions/` consumes both and reports `blocked`/`working`/`idle` to Herdr,
  which is how MixCode Pi already does it; this fork does not ship a reporter of its own. See
  [Herdr Pane Reporting](docs/herdr.md).
- Fork documentation gains `docs/keybindings.md` and its `.zh.md` mirror: the ids this fork rebinds,
  the ids it adds on each surface, the composer's key resolution order, and the `Escape` steps.
  Upstream's `packages/coding-agent/docs/keybindings.md` cannot hold them, since patching it conflicts
  on every merge, so the fork's own bindings had no single page to be read from.
- `/editor` hands the composer's draft, pasted blocks expanded, to the configured external editor
  (`externalEditor`, else `$VISUAL` / `$EDITOR`, else the platform default) and keeps what that editor
  writes, an emptied draft included, exactly like the external-editor key (`ctrl+g`).
  Typing it submits the command, so the external editor opens an empty buffer; picked from the command
  palette (`ctrl+p`), where the editor slot holds the command text, it edits the draft the palette took
  over. A failed launch leaves the draft untouched, and an argument reports `Usage: /editor`. The
  command is listed in the `/` autocomplete and in the palette, where it sits next to `/jump`. See
  [Input Dock](docs/input-dock.md#external-editor).
- `MPI_PROJECT_SKILLS_ONLY` restricts skill discovery to the session's workdir. With it on, the
  resource loader drops two kinds of skill: any skill it hands the filter with `user` scope (in
  practice the whole `<agent dir>/skills` root) and any skill whose file lives outside the workdir.
  That covers `~/.agents/skills` and the ancestor `.agents/skills` directories above the workdir; a
  skill from `~/.agents/skills` survives only when that directory falls inside the workdir. The
  filter runs inside the loader's `skillsOverride` hook, so the system prompt and every surface built
  from the loaded skills (the interactive startup panel, `/skill:<name>`, `--rpc`) agree; an embedder
  that builds its own loader is not gated. Off when unset, empty or set to `0`/`false`/`off`/`no`;
  any other non-empty value counts as on. See [Skill Isolation](docs/skill-isolation.md).
- `/delete-session` moves the session file into `<agent dir>/mixcode-pi/trash/` instead of
  unlinking it, and records it in `trash-index.jsonl` (`sessionId`, `title`, `deletedAt`,
  `originalPath`, `trashPath`, `size`). The trash is capped at 2 GiB and evicts the oldest
  entries first; a session past the cap, or a move that fails, falls back to the system `trash`
  CLI and then to an unlink, so a delete never leaves the session half-removed. `/resume-trash`
  opens the session selector over the trash dir — `Current Folder` shows entries deleted from the
  active workdir, `All` shows every trashed session — restores the picked file to its original
  path before opening it, and removes a row for good when that row is deleted from that selector.
  The state directory is the one MixCode shares with mixcode-pi, so both agents read the same
  trash.
- A failed model request records its exception's bounded facts as a `[provider-error]` console
  line: `provider`, `model`, `api`, and up to five `{name, code, status}` nodes drawn from the
  exception's `cause` chain and `AggregateError.errors`. Messages, stacks, headers, bodies and
  credential fields are never recorded. The built-in text adapters accept a new
  `onProviderError(error, model)` stream option (`StreamOptions` and `SimpleStreamOptions`, forwarded
  by `streamSimple`) and call it with the raw exception before formatting the message a user sees,
  and the interactive app installs an observer on its shared `ModelRuntime`, so agent turns and
  compaction are covered. The provider's own message is what a user acts on, and what actually
  failed was otherwise unrecoverable once the process ended. See
  [Provider Error Diagnostics](docs/provider-errors.md).
- Batch scripts run Lua or TypeScript/JavaScript plans that open named agent tabs and dispatch
  prompts into them, from the CLI (`--batch`, `--batch-dry-run`) or the interactive `/batch`
  command. A request carries its workdir, model, thinking level, context limit, and either one
  prompt or an ordered `prompts` sequence; requests with the same name run in order and different
  names run concurrently. See [Batch scripts](docs/batch-scripts.md).
- `/reset` moves the active conversation back to its session root in the same file: the leaf drops to
  the point before the first entry, so the next prompt starts a new root, while the entries already
  written stay in `/tree`, the tab stays where it is and keeps its title, and extensions see a
  `session_tree` event. It reports that there is nothing to reset when the leaf is already the root,
  and refuses while a turn or a bash command is running. Upstream has no such command, so re-rooting
  meant opening `/tree` and navigating by hand. See [Agent Tabs](docs/tabs.md#reset).
- When an extension replaces the prompt editor (`ctx.ui.setEditorComponent`), the agent chrome moves
  from the card's top edge to the rule under the tab bar: the tab name and the `[VIM]`/`[ZEN]` badges
  are right- and left-anchored there, and the exact context reading appears while `/context-limit`
  supplies the window. The card that normally carries them leaves with the replaced editor, and the
  rule is painted every frame anyway. Labels drop in the card's own order as the row narrows, and Home
  keeps the plain rule. See [Input Dock](docs/input-dock.md#replaced-editors).
- `/context-limit [tokens|reset]` caps the current agent tab at a context window of its own: `32k`,
  `32.5k`, `32000` and `reset` are accepted, and the bare command opens a picker offering ¼, ½ and ¾ of
  the model's window, the full window (= reset) and a free-text row. Two things then carry the limit:
  the card's `used/limit` reading appends a `*` and the meter below computes its percentage against it,
  and the live session model reports the window, so Pi's own compaction and extensions reading
  `ctx.model` agree. The compaction reserve shrinks to fit (`reserveTokens = 10%` of the limit, capped
  at 16384; `keepRecentTokens = 25%`), and a reset hands both back to the user's settings. A model
  change — from the selector, `/model`, a cycle key or a provider login — drops the limit, and so does
  replacing the session (`/new`, `/resume`, fork, import) or `/reload`.
  See [Input Dock](docs/input-dock.md) for the `*` mark.
- `ctrl+t` (or `/jump`) opens Tab Jump, a searchable overlay listing MixCode Home and every open
  agent tab: a status glyph, the title and the tab id per row, with the focused tab highlighted
  first. The header row labels the query and reports `matched/total tabs`. `up`/`ctrl+k`/`shift+tab`
  (`app.tabJump.selectPrevious`) and `down`/`ctrl+j`/`tab` (`app.tabJump.selectNext`) move the
  highlight and wrap, typing filters by title, `ctrl+f` (`app.tabJump.toggleNonIdle`) keeps only the
  tabs with something to report, `enter` jumps to the highlighted entry and `esc` closes (with nothing
  left to select, `enter` just closes); the wheel moves the highlight, pointer motion underlines a row
  and a left click jumps to it. A list longer than the panel shows is cut around the highlight and
  marked `... (N more above/below)`; the id column shows the whole id while the row has room for it.
  The rows reuse the tab bar's own projection, so a tab still coming up keeps its spinner, and the
  glyph is the one its chip paints. Clicking the chip of the tab that is already focused opens
  the same overlay instead of re-activating it. `/jump` with an argument reports `Usage: /jump`. The
  chord is ignored while the editor's `/` popup is up, and both the chord and a chip click are ignored
  while a floating overlay or an editor-slot selector (tree, model, resume) owns the keyboard. In zen
  mode the overlay is the switcher (`tab`/`shift+tab` stay swallowed), and in vim mode `ctrl+t` keeps
  passing through. See [Agent Tabs](docs/tabs.md#tab-jump).
- `ctrl+c` with text in the composer now clears it and parks that text at the front of the prompt
  history, so `up` recalls it (a stash). The stash is kept per tab and rebuilt into the composer on
  each activation, so it survives a tab switch and a revisited tab does not repeat it. Home's
  ephemeral composer parks nothing, a new session keeps parked drafts, and a second `ctrl+c`
  within 500 ms still quits.
- `/compact` accepts an optional `provider/modelId` before its instructions, including model IDs containing `/`. Only the summary request uses that model; the session model and thinking level stay unchanged. Model references are offered by slash-command completion until the instruction separator is entered.
- Compaction status names a requested summary model and colors its message by reason: accent for manual, warning for threshold, and error for context overflow.
- Startup lists the previous run's tabs before building any of them: the tab bar carries a chip per
  persisted tab from the first frame, each showing a spinner until its tab is ready, and the tabs are
  built one at a time in the recorded order. The session opens on MixCode Home with the tab that was
  focused last selected in the roster instead of opened, so nothing waits on the restore. See
  [Agent Tabs](docs/tabs.md).
- `install.sh` accepts `--name <name>` (or `MIXCODE_INSTALL_NAME`) and uses that name for both the installed bin wrapper and its runtime directory, allowing one-command installation under a custom command name.
- The `aurora` theme ships as a built-in, selectable from `/theme` and the settings panel. It is
  not the default: with no `theme` in `settings.json` the terminal background still picks between
  `dark` and `light`. Built-in themes are now discovered by scanning the theme directory for
  `*.json` and keying each file by the `name` inside it, rather than loading `dark.json` and
  `light.json` by name — so a new built-in theme is a new file, and a file that fails to parse or
  validate is skipped instead of taking the whole built-in set with it.
- The dock meta row carries icons: a Nerd Font glyph before the model and the thinking level in its
  full layouts, the context meter's own glyph, and a mark on the git branch. `ui.icons.mode` in
  `mixcode_settings.json` (`nerd`, `ascii`, `auto`) picks the alphabet — `auto` probes the terminal,
  and the ASCII set (`M`, `~`, `#`, `*`, with a `#`/`-` meter) keeps a terminal without the font
  readable — and `/settings` exposes it as *Icon mode* in the MixCode section. See
  [Icons](docs/icons.md).
- `/toggle-zen-mode` (also in the `ctrl+p` palette) hides the tab bar's chips and leaves their row to
  the transcript. The separator under the bar stays and takes over what the chips still reported: one
  dot per other agent with something to report, in tab order — an accent braille frame while a tab
  works, a success dot for a tab that finished unopened, an error dot for a failed turn. Past five
  dots they collapse into `[+N]`, and a row too narrow for that falls back to a plain rule instead of
  truncating. The card's top edge gains a `[ZEN]` badge. See [Zen Mode](docs/zen-mode.md).
- `tab`/`shift+tab` stop switching agents while an agent tab is in zen, because the surface that
  shows where focus went is exactly what zen hides; `/tab <index|title>` still switches, and chip
  clicks resume once zen is off.
  Zen follows focus like vim: at most one tab holds it, a tab opened or focused while another holds it
  takes it over, Home puts the full bar back, and nothing about it is persisted, so a session
  restored at startup starts with the bar. See [Zen Mode](docs/zen-mode.md).
- `/workdir [path]` moves the active tab onto another working directory, and without a path it opens
  a directory picker over the composer. The session keeps running: the transcript is unchanged, the
  agent's cwd-bound services are rebuilt in the new directory, and the session header records it so a
  later resume starts there. The picker browses directories only, with `left` for the parent, `tab`
  to walk into a directory, `enter` to apply the one being browsed, `ctrl+h` for dot-directories, and
  a `/`- or `~`-prefixed filter that becomes a typed path. The workdir cells of the dock meta row
  join the model and thinking cells as click targets, and a press opens the same picker. See
  [Agent Tabs](docs/tabs.md#workdir) and [Input Dock](docs/input-dock.md).
- User messages carry their send time at the right end of their first row (`Sep 29, 9:29 PM`),
  painted dim. The reading comes from the message's own timestamp, so a resumed session shows when each
  message was sent; the body renders narrow enough that no text can reach it, and a message without a
  timestamp is drawn exactly as before.
- Extension widget side panel: `→` (`app.widgets.panel`) on an empty composer opens a per-tab
  right-hand column that collects the above- and below-editor widgets beside the chat, so they stop
  stacking around the composer. The column carries a pinned `Widgets` title, a dim section rule per
  widget, and a `→ to close` hint; content taller than the panel scrolls with the wheel (routed by
  region, so chat keeps its own wheel), wide lines wrap rather than truncate, and hidden rows are
  marked `↑ more`/`↓ more`. Opening needs at least one widget and a terminal of at least 80 columns
  (a toast says why otherwise). A drag that starts on the panel selects within the panel only —
  points clamp to its body cells and releasing copies the text ANSI-clean without the frame, so a
  selection never crosses the chat/panel split in either direction.
- Input dock: the composer is framed by a rounded card whose top edge carries the working status,
  the mode badges (`[VIM]`, `[SHELL]`, `[ZEN]`, `↑ N`), the tab name and the exact context usage
  (`12.3k/200k`), and whose bottom edge carries `↓ N more`. Under it sits one meta row with the
  model, the thinking level and the workdir on the left and an eight-cell context meter plus the git
  branch on the right, followed by the extension status row. Both replace pi's flat editor rules and
  its status footer, so the dock states which agent and which context the input belongs to
  without a separate header. The card needs ten columns; below that the plain editor is kept so the
  working status always has a row. See [Input Dock](docs/input-dock.md).
- The empty composer now hints in every state instead of only on Home: `Describe your next
  change...  @ files  / commands  ← Home · → widgets` on an agent tab, and the vim navigation keys
  while vim mode owns the input. The two key labels are read from the keybindings, so a rebound key
  keeps the hint honest; the widgets half is dropped in TUI modes that do not split the chat, where
  the key does nothing.
- Mouse drag selection: a drag now selects only inside the transcript, the prompt card and the
  notice panel, and the copied text is cleaned per surface, so dragging over the prompt card or the
  notice no longer pastes that surface's frame and key-hint rows. Wide characters are kept whole,
  the selection is painted with the theme's `selectedBg` (re-opened after every SGR, so a block
  background cannot swallow it), and releasing copies through the existing toast. A press also pins a
  following transcript for as long as the button is down, so output that streams in during a drag
  cannot slide the selected rows away; releasing leaves the transcript where the user left it when
  output arrived or they scrolled it, and a press that moved nothing follows again. The highlight goes
  with the release that copies the selection: a release with copy-on-select on (the default) drops it,
  and one with the setting off leaves it up for the copy command. Selected card rows inside a
  block that carries the pointer cue — a tool call, a summary card, a skill invocation, the thinking
  block — also gain an underline, because the cue fills those cells with the same background. The text cleanup
  lives in `core/mixcode/selection/chat-selection.ts` and the surface registry in
  `modes/interactive/mixcode/selection/`; pi-tui keeps owning the drag, the slicing and the edge
  auto-scroll. Its `TuiSelectionOptions` gained `clearOnRelease` and a `highlight` handed the painted
  line's surface kind and row, and `Container` and `Box` gained `componentAtRow`, so a host can
  resolve a row to the component that painted it and to the row inside that component.
  See [Mouse Selection](docs/mouse-selection.md).
- Follow-up queues with `/follow-up`: user follow-ups no longer ride the SDK follow-up queue.
  `alt+enter` and `/follow-up <message>` queue host-side rounds (an exclusive round each, or merged
  into one round with `/follow-up --batch <message>`) that dispatch one prompt turn per round when
  the agent goes idle. A failed run, compaction failure, or dispatch error pauses the queue (shown
  as `Paused · /follow-up to resume`), `/follow-up` without a message resumes it, and a queued local
  command (e.g. `/follow-up /model <id>`) runs host-side when its round arrives. Queued texts draw
  as boxed previews above the editor: `Steer (n)` with `Esc->send now` and `ctrl+u->edit` hints,
  `Follow-up (n)` with `Round k · next|command · <text>` numbering and `SDK ·` companions, showing
  the latest five entries of each queue. Esc with queued steer texts aborts the run and sends them
  as one immediate turn without promoting follow-up rounds, and `ctrl+u` pops a single queue entry back
  into the editor (`ctrl+u` then `s`/`f` picks the queue when both are queued) (steer/follow-up choice toast when both are queued). Backed by a new
  `AgentSession.removeQueuedMessages`/`restoreQueuedMessages` dequeue API and an
  `Agent.removeQueuedMessages`/`restoreQueuedMessages` queue splice.

- Toast notifications: a typed card in the top-right corner of the transcript, with a rounded frame,
  an icon and color per kind, a width that follows the terminal, and a three second lifetime. The
  copy command reports through it, a failing copy reports the error, and closing the last tab
  reports the refusal; vim's entry prompt and message-jump notices use it too. The card fills its
  cells with a new `panelBg` theme background, so it reads as a surface instead of an outline.
- Interactive console output: `console.log`, `console.info`, `console.debug`, `console.warn` and
  `console.error` no longer write raw text onto the tty from interactive mode, where it corrupted
  the frame and duplicated the tab bar. Their output is prefixed with `[console.<method>]:` and
  painted into a bottom-centered `Notice` panel that does not take focus, wraps long lines, and
  stops growing at about 60% of the terminal. `c`/`y` copies it (`app.notice.copy`), `Esc`/`q`
  closes it (`app.notice.dismiss`), and `/console-history` opens the last 1,000 lines in the
  external editor, with their timestamps and the tab that emitted each one. See [Console History](docs/console-history.md).
- `mixcode-manual-e2e` skill: creates user-runnable TUI demos through this checkout's
  source launcher, with local faux models, isolated runtime state, and per-state evidence.
- Command palette: `ctrl+p` (`app.palette`) opens a fuzzy-searchable list of every command the UI
  can run (built-ins, extension commands, skill commands, prompt templates), floating over the
  draft and painting the characters the query matched. Enter submits the selection through the
  normal command path, so arguments, gating and error messages match typing the command, and the
  draft comes back once the command is done with the editor. `/palette` opens the same list.
- A quit confirmation: `ctrl+q` (`app.quit`) asks with a `y`/`n` panel before shutting down,
  so a stray chord cannot end a session mid-task. `/quit` still quits without asking.
- `install.sh` at the repo root: builds the workspace and installs a standalone `mpi`
  binary under a prefix (default `~/.local`). The compiled binary resolves themes,
  export templates, docs, and native prebuilds from its own directory, so the binary
  lives in a versioned directory under `<prefix>/lib/mpi/` and `<prefix>/bin/mpi`
  is a wrapper that execs it.
  `scripts/build-binaries.sh` stays the release-archive path; this covers single-machine
  installs.
- Multi-tab agent sessions: several agents run side by side in one terminal, each tab
  owning its own `AgentSessionRuntime`. Upstream keeps a single runtime host, so watching
  N agents otherwise means N terminals.
- A tab bar above the editor showing each tab's title, one of eight named colors, and a
  live status (`idle`, `running`, `thinking`, `error`, `done`), so a tab's state is visible
  without switching to it.
- A shimmer wave on the focused tab's title, so the focused chip is obvious without a second
  color cue: the wave sweeps to the right edge and back over 2 s, rests for 1 s, and eases
  into each turnaround. A colored chip inverts the lit cells instead, because theme
  foregrounds have no contrast over a chip color.
- Open tabs persist per workdir as `open_tabs.json` in the agent state directory, so a restart
  reopens the same tabs.
- Tab slash commands: `/new-session`, `/close-session`, `/close-all-sessions`,
  `/delete-session`, `/delete-all-sessions`, `/rename`, `/tabs`, `/tab`, `/color`,
  `/group-colored-tabs`, `/mark-done`. `app.tab.new` and `app.tab.close` ship unbound,
  so the commands are the only way to open or close a tab.
- Keybindings `app.tab.next` (`tab`, `ctrl+shift+right`) and `app.tab.previous`
  (`shift+tab`, `ctrl+shift+left`).
- Vim mode for the fullscreen transcript: `/vim`, or `ctrl+u` then `u`/`ctrl+u` from an
  empty editor, then `q` to leave. `j`/`k` scroll 3 rows, `ctrl+u`/`ctrl+d` page,
  `gg`/`G` jump to the ends, and `right`/`shift+right` jump between user messages. Every
  key is a configurable `app.vim.*` action. See [Vim Mode](docs/vim-mode.md).
- Windowed transcript rendering: the fullscreen scroll view's child reports a virtual row
  count and renders only the visible blocks, so frame cost stays bounded on long
  conversations instead of growing with the whole transcript. Unmeasured blocks contribute
  an estimated height, and the window is assembled from the nearest end so new output cannot move
  the rows above it. See
  [Windowed Transcript](docs/windowed-transcript.md).
- pi-tui windowed layout node (`WindowedLayoutState` / `WINDOWED_NODE`), so any component
  can serve a line window to a scroll view. Transcript search and prompt jumps read the
  full line range through the same provider.
- MixCode Home: a `home` pseudo-tab listing every open agent with a status chip, model,
  context usage, recency, and the newest output, plus a conversation pane beside the roster
  on wide terminals. It starts and resumes sessions from its heading, and `left` on an empty
  composer returns to it. Sending from Home targets the highlighted agent without attaching;
  `/commands` and `!shell` lines attach first, and a message to a busy agent steers its turn.
  See [MixCode Home](docs/home.md).
- Keybindings `app.home.selectPrevious`, `app.home.selectNext`, `app.home.attach`,
  `app.home.send`, `app.home.returnHome`, `app.home.toggleNonIdle` (defaults `up`, `down`,
  `right`, `enter`, `left`, `ctrl+f`). Each declines the key whenever Home is not the active
  surface, so the composer keeps them on agent tabs.
- MixCode Home lists outdated extension packages above the roster, with the command that updates
  them, when the startup check finds any.
- MixCode Home hides the footer, the working indicator and the extension widgets while it is shown:
  the working directory, the usage and model line, the statuses and those widgets are per-agent
  chrome.
- MixCode Home names the target of the next message in the empty composer
  (`Send to <agent>...  @ files  / commands`, or `Select an agent...` with an empty roster) and frames
  the composer in the neutral thinking colour, since Home has no agent of its own.
- `MPI_DISPLAY_WORKDIR` and `MPI_DISPLAY_MODEL` mask the workdir and model shown on
  MixCode Home, so a recording can hide the real paths and provider.
- Response model mismatch notice: when a provider answers with a model other than the one
  requested, the transcript says so under that reply
  (`[Model mismatch] requested X → returned Y · via provider`). Restoring a session or
  switching a branch brings them back, because they derive from the `responseModel` metadata
  each assistant message carries. The OpenAI Responses adapters (OpenAI, Azure, Codex) now
  capture that metadata, alongside the existing Anthropic Messages and OpenAI Completions
  capture. The notice follows its own `ui.showResponseModelNotices` setting in
  `mixcode_settings.json`, on by default and listed as *Response model notices* in the MixCode
  section of `/settings`, instead of pi's `showCacheMissNotices`. The message itself keeps its
  requested model and persisted content.
- Inline widget mode: extension widgets render at the tail of the chat instead of the editor
  dock, behind a viewport-derived row budget that collapses whole widgets to `▸ Inline · <key>`
  headers. `ui.inlineWidgets` in `mixcode_settings.json` sets the global default (on), `/settings`
  has an `Inline widgets` row in its own `MixCode` section, `/toggle-inline-widgets` switches one
  tab, and `/widgets expand|collapse|toggle [key]` steers the collapse state. See
  [Inline Widgets](docs/inline-widgets.md).
- A dock row budget for extension widgets: the slots above and below the editor share one budget
  derived from the terminal height, so a tall widget stack cannot squeeze the chat and the dock
  chrome. Overflow rows are marked with a dim `… (widgets truncated)`, a partly shown widget keeps
  the rows it shows, and the budget is re-decided every frame. See
  [Widget Layout](docs/widget-layout.md).
- `core/mixcode/mixcode-settings.ts` reads and writes `mixcode_settings.json` in the state
  directory shared with mixcode-pi, so both agents see the same global settings.
- Pointer hover feedback: passive mouse motion highlights what a click would hit, without
  moving the keyboard selection, the active tab, the editor draft, or the scroll position.
  Tab chips, command-palette rows and the transcript blocks that answer a click (agent tool
  calls, compaction and branch summaries, skill invocations, the thinking block) paint the
  hovered cells with the selection background and an underline, so the cue stays visible in a
  monochrome theme; a block is painted as one rectangle, row padding and blank rows included,
  and the jump-to-end label underlines while the pointer is over it. A primary click anywhere
  on a block expands or collapses it. The fullscreen renderer tells the component under the
  pointer when the pointer leaves it, drops the cue when an overlay is open, and drops it when
  the terminal is resized. Hover needs all-motion mouse reporting, which the fullscreen
  renderer only asks for outside tmux, zellij and screen.
- Hidden thinking as a tail: with hiding on, each thinking block renders as a three-row tail that
  follows the stream — a `Thinking` header whose duration ticks live and freezes when the block
  stops growing, then the last three visual rows of the reasoning behind a left rail, with `…` on
  the first row when earlier content was dropped. A `setHiddenThinkingLabel` override still
  replaces the whole block. The `Thinking tail preview` row in `/settings` (`ui.boxedHiddenThinking`
  in `mixcode_settings.json`) turns it off, and it defaults to on.
- Vim mode paints a `User Messages` panel at the bottom right while `right` / `shift+right` walk the
  chat's user messages: one row per message (its first text line) plus a `<NEWEST>` row for the newest
  output, the row the viewport landed on highlighted, `↑ N older above` / `↓ N newer below` hints when
  the list is longer than its row budget, and a 1.8 s lifetime. The panel sits above the dock with the
  scrollbar column left clear. See [Vim Mode](docs/vim-mode.md).
- `/system-prompt` shows the prompt the provider receives — the system message replayed from the
  transcript, so sections a `before_agent_start` extension wrote are included, or the base render
  before the first request records one — followed by a table that sizes every named prompt section
  (chars, estimated tokens, share, and `project_instructions` files one row each). `/system-tools`
  shows every active tool's description, owner and parameter schema, followed by the same table over
  what a tool definition actually sends (name, description, parameter schema). Both open in the
  read-only external editor (`/system-tools` also takes `--editor=<cmd>` and `--editor=false` for the
  in-app block), and both estimate tokens at ~4 characters per token with one token per CJK character.
- The SDK exports `getDefaultSessionDirPath(cwd, agentDir?)`, the encoder behind a cwd's
  `~/.pi/agent/sessions/<encoded cwd>` directory, so an embedder that reads a workdir's session
  directory no longer has to re-derive that encoding.
- The host process publishes its own pid as `MIXCODE_PID` beside `MIXCODE`, written once at startup.
  Tooling that finds a running instance gets a handle that survives `nohup`/`setsid`, where `$PPID`
  does not; this fork does not read the value itself.
### Changed

- The fork-owned `TabUiHandover` owns transcript caching/warming, serialized UI switching,
  bind deduplication and deferred resource mounting. The host supplies live render/session
  collaborators while `ExtensionUiController` remains the mounted chrome owner.
- The fork-owned `ForkCommands` module owns command recognition, tab command parsing/actions,
  and palette/Home/queued command draft restoration. Unhandled input falls through synchronously
  to upstream dispatch so a deferred focus change cannot redirect ordinary messages.
- The fork-owned `TurnController` owns retract run markers and failure/settle reactions at
  explicit event checkpoints. Rendering, interrupt arms and compaction claim/model state retain
  their existing host responsibilities and ordering.
- Fork-specific selection-copy and toast coverage lives in `test/mixcode/clipboard.test.ts`;
  upstream TUI copy tests retain only the adaptations required by the fork's actual behavior.
- Extension UI workflow tests construct typed controller hosts and exercise real terminal input,
  chrome ownership, background updates, and parked dialogs without private host method access.

- The fork-owned `ExtensionUiController` owns per-tab extension chrome, dialogs, widgets,
  custom editors, and terminal-input subscriptions. `InteractiveMode` supplies live session
  settings, editor surfaces, Home visibility, and status callbacks, keeping the extension UI
  lifecycle in one module.
- `InteractiveMode` now delegates tab-manager construction, shared-layout lifecycle, tab session actions, resume routing, and layout publication to the fork-owned `TabController`. Home rendering, transcript caching, extension binding, and runtime UI rebinds remain in the host so this step changes the merge boundary without changing tab behavior.
- `Escape` interrupts a running turn in two steps: the first press arms a 1 s window and shows
  `<interrupt key> again: stop`, and the second press inside that window interrupts. A turn that has
  produced nothing readable yet (no assistant text, no thinking, no tool call, no displayed
  extension message or rendered custom entry, with an empty composer and no queued follow-up round)
  is retracted instead of merely stopped: the branch leaf rewinds to before that run's own user
  message and the text returns to the composer, so a prompt sent too early can be edited and sent
  again. Every other run aborts as before, leaving queued steer texts in the editor and a queued
  follow-up round paused in the queue.
  The notice names the configured `app.interrupt` key, and a run a custom message started is never
  retracted, since rewinding to an older user message would drop completed turns. See
  [Keybindings](docs/keybindings.md#escape).
- `/resume` and `/resume-trash` open the picked session in a tab of its own instead of replacing the
  focused tab's session, matching `/clone` and a tab opened for a peer. A session that is already
  open in a tab is focused rather than opened twice, because two runtimes on one session file would
  append to it concurrently. The extension API's `ctx.switchSession` and a host without a tab manager
  keep the in-place replacement, and a resume that mounts a tab reaches extensions as a
  `session_start` with reason `resume` instead of the runtime-level `session_before_switch` veto,
  which the fork's other tab-opening paths already skip. See [Tabs](docs/tabs.md#commands).
- Vim mode's `ctrl+u` / `ctrl+d` (`pageUp` / `pageDown`) scroll a fixed 10 rows instead of the
  viewport height minus one, so one press moves the same distance on a short and a tall terminal.
  `j` / `k` keep their 3 rows. See [Vim Mode](docs/vim-mode.md#keys).
- `/new` is renamed to `/clear`, matching mixcode-pi. Where `/new` aborted a running turn before
  replacing the session, `/clear` refuses while a response or a bash command is running and reports
  why, so a clear cannot cut a turn short. The replacement session inherits the outgoing header's
  `parentSession` instead of starting a new parent chain, and the tab's chip color goes with the
  session, since that color is keyed by session id. Everything else is unchanged: the tab, its
  workdir, its model and its thinking level stay, the title returns to a free `Agent-NN`, and the old
  session file stays resumable. See [Tabs](docs/tabs.md#commands).
- `/clone` opens the current branch in a new tab titled `<current title>-cloned` and focuses it,
  instead of replacing the active tab's session with a branched copy. The source tab keeps its
  session file and stays open, so both tabs continue from the same conversation independently, as
  `/fork` already does. The branch point is the source's leaf, so the clone carries the whole
  conversation rather than rewinding to a user message. Without a tab manager `/clone` keeps the
  upstream behavior. See [Tabs](docs/tabs.md#commands).
- The fork no longer patches `packages/coding-agent/docs/keybindings.md` for the fullscreen
- The CLI presents itself as `mpi`: `piConfig.name` in `packages/coding-agent/package.json` is
  `mpi`, so `--help`, the package-command help, the terminal title and runtime messages name the
  tool `mpi`. `ENV_AGENT_DIR` / `ENV_SESSION_DIR` are pinned to their upstream `PI_CODING_AGENT_DIR` /
  `PI_CODING_AGENT_SESSION_DIR` names in `config.ts`, so external tooling and the shared `.pi` agent
  dir keep working; the debug log becomes `mpi-debug.log`.
- Home's startup restore now shows the whole persisted tab layout from the first frame and labels each
  card with the phase its tab is in: a persisted tab whose runtime does not exist yet is a placeholder
  row, and a still-loading tab reports `session`, `resources` or `waiting for input` rather than the
  generic `loading`. Previously the roster appeared one tab at a time and every not-yet-ready card
  carried the same chip, so a slow restore read as an empty Home.
- Tab Jump takes `ctrl+t`, so the composer no longer reaches `app.thinking.toggle` on that key: the
  toggle keeps its `ctrl+t` default but the jump handler is registered first, the start-up instructions
  no longer name it, and `/hotkeys` reports it with a note that its chord is taken. Rebind
  `app.thinking.toggle` in `keybindings.json` to give it a chord again, or use the `Hide thinking` row
  in `/settings`. See [Upstream Drift](docs/upstream-drift.md).
- Prompt-history recall puts the caret at the end of the recalled entry instead of its start, and
  `up`/`down` keep stepping between entries while one is browsed rather than moving the caret
  inside a multi-line entry. See [Upstream Drift](docs/upstream-drift.md).
- The session confirmations take the keys directly: `/close-session`, `/delete-session` and the
  two all-sessions variants confirm on `y` and cancel on `n` next to the arrow-key selector, so the
  question is answered without stepping onto the `Yes`/`No` row first. `esc` still cancels and the
  `[yes]` argument still skips the prompt.
- The composer card holds its text one column further from the left border: the draft, the empty
  composer's placeholder and the autocomplete menu all move right by one cell, the card's right edge
  stays where it was, and a click is translated so it still lands on the character under it. A pointer
  selection over the draft now copies its leading spaces intact as well, which the old inset ate.
- The dock meta row's model and thinking level are click targets: the pointer lights the field up
  with the same hover cue the tab bar and the command palette use, and a left click opens that
  field's picker, so the model selector and the thinking selector are reachable with the pointer
  instead of only through `/model`, `/models` and `Alt+T`. The regions are computed from the row
  that was rendered last, so a truncated or compacted row never answers for cells it no longer
  paints, and a click on a gap, on the context meter or on the git branch stays inert.

- The workdir picker reads its key hints from the configured bindings instead of fixed text, so a
  rebound key keeps the row accurate, and it splits them over two rows, because the panel is too
  narrow for one row naming all six actions and a clipped hint silently drops one. It also tells an
  empty directory apart from a filter that matched nothing. The dock's workdir badge and the picker
  now resolve the home directory through one helper, so `~` names the same path in both, and an
  unreadable directory reports the directory that was read.

- `/settings` is a centred floating panel in the MixCode style instead of a selector that replaces the
  editor area: a framed surface titled `Settings`, a dim `filter: type to filter  N/N` line in place of
  the search input, a `Pi` / `MixCode` heading above each settings file's path, `›` rows with the label
  and the value in their own columns, booleans shown as `On`/`Off`, the selected item's description,
  and one key-hint footer row. The draft and the transcript stay visible behind the panel, so opening
  settings no longer costs the composer its place. Choosing `TUI mode` takes the panel down before
  switching, because a mode switch refuses while an overlay is open. The items, the submenus and the
  fuzzy filter are pi's own and are unchanged. See [Upstream Drift](docs/upstream-drift.md).

- The default TUI mode is `fullscreen` instead of pi's `regular`, so an installation that never set
  `tuiMode` opens on the alternate screen, where the fork's transcript features live. An explicit
  `tuiMode: "regular"` in `settings.json` keeps the plain transcript; `/settings` switches between
  the two.
- The built-in footer is now the dock meta row. pi's footer rows (the working directory with the
  session name, then the token and cost totals with `percent (auto)` beside the right-aligned model
  and thinking level) are gone from the dock: the card's top edge carries the name and the exact
  token counts, and the meta row carries the rest. The `(auto)` marker, the cumulative `↑ ↓ R W`
  and cache-hit line, the cost total, and the `(sub)` subscription and `• xp` markers are no longer
  drawn there; `/session` still prints the token, cache and cost sections, and `/settings` still
  reports auto-compaction. See [Input Dock](docs/input-dock.md).
- The fullscreen transcript's clipboard confirmation: the alternate screen hands the result to the
  host through a new `onCopyResult` option, so a mouse-selection copy reports with the same toast as
  the copy command instead of the screen's own one-line flash.
- `app.model.cycleForward` ships with no default key, because `ctrl+p` now opens the command
  palette; `shift+ctrl+p` (`alt+p` on Windows and WSL) still cycles backwards.
- On Windows and WSL the quit chord is `ctrl+shift+q`, keeping `ctrl+q` for
  `app.message.followUp`, the only follow-up chord those terminals deliver.
- `/hotkeys` lists the palette and quit chords.
- `app.palette` and `app.quit` join the keybindings an extension shortcut may not override, so a
  loaded extension cannot take the palette or the quit chord out from under the user.
- `app.thinking.cycle` moved from `shift+tab` to `alt+t`, because `shift+tab` now switches
  tabs.
- Session deletion refuses while the owning tab has a turn in progress, and reports why;
  another tab may still be writing that session file.
- Session file deletion moved from the session selector into
  `core/mixcode/session-delete.ts`, so the selector and the tab commands share one
  implementation.
- The fullscreen transcript is the windowed container instead of the document container;
  regular mode still mounts the document container unchanged.
- `TuiAltScreen.scrollToPrompt(direction)` is public and returns whether a prompt was
  found, for the alternate screen's own prompt keys. It clamps its search to the rows that exist,
  because a windowed child keeps a virtual line count.
- `LayoutBox.scrollContentLines` is replaced by a `ScrollLineProvider` on the scroll box, so
  search, prompt jumps, selection and image cropping read a windowed transcript on demand. The
  provider's `materialize()` renders the whole document exactly, which is what search and copy
  use; the line count stays an estimate so the scroll range needs no full render.
- `createChatViewport` accepts a `widgetsVisible` predicate, so a surface that wants the widget
  rows can hide both slots.
- `CustomEditor.onAction` handlers may return `false` to decline a key, which then reaches the
  editor. Existing handlers are unaffected; the Home bindings rely on it.
- pi-tui's `SettingItem` gained an optional `section`; consecutive items sharing one render under
  a heading row, which is how the `MixCode` group stays apart from pi's own settings.
- The dock's widget slots are `DockWidgetBudget` components instead of plain containers, so the
  slots decide per frame what fits and forward mouse rows to the widget they came from.
- The fork code went through a readability pass, because most of it was written in one burst and
  the same helper had been written twice in several places. The duplicated terminal-text
  sanitizer, the per-tab Home caches, the transcript-notice and external-editor paths, the tab
  bar's overflow hints and the scroll-box assembly in pi-tui's layout now each have one
  implementation, and names, comments and magic numbers were brought back in line with what the
  code does. No behaviour change beyond the fixes below and the renames above.
- `TuiAltScreen`'s `scrollToEndIndicator` callback now receives whether the pointer is over
  the label, so a caller can style the hovered state.
- Another readability pass over the fork's MixCode code. Hint rows now resolve their keys from
  the bindings instead of quoting them (the console notice reads `app.notice.copy`/
  `dismiss`, and `app.queueEdit.steer`/`followUp`/`cancel` are new, which makes the
  queue-edit keys rebindable, and the arm prompt names them), the repeated tab-title,
  selection-unframing and theme-escape helpers collapsed to one implementation each, the three
  clickable summary cards share one base, the oversized TUI methods split into named steps, and
  duplicated literals and magic numbers got names. Two defects fell out: `VISUAL=" vim"` no
  longer fails the editor probe and skips the fallback, and the workdir picker counts directories
  instead of rows in its `N dirs` line. The session workdir writer names its temp file with a
  UUID, so two writers of one session file no longer collide.
- Another readability pass over the fork's MixCode code. Duplicated helpers collapsed to one
  implementation each: the SGR re-open that three surfaces had written three ways, the input card's
  frame arithmetic, the tab-title scan, the right-aligned dim clock the message row and the thinking
  tail each computed, and the toast icon/color tables. A generated tab title is now flagged rather
  than re-derived from the tab's position, `markDone` goes through the tab-status seam, and the zen
  separator's glyph map is the tab bar's table. `interactive-mode.ts` sheds the composer's frame-time
  reads: `composer-state.ts` renders the placeholder and the input-card chrome from a
  `ComposerContext` the interactive mode gathers.
- The outdated-package notice lives only on Home: the chat transcript no longer repeats it. Home now
  carries the full wording (the heading, the `Package updates are available. Run pi update --extensions`
  instruction line with the command accented, the `Packages:` label), and the package lines are no
  longer dim.

### Fixed

- Prompt history stays on its tab across default and extension editor replacements: each mounted
  editor is seeded after the handover. Raw inputs handled by extensions remain recallable when
  revisiting their tab. Submits capture their tab and session before extension binding waits,
  so switching during that wait cannot send the input or record its history on another tab;
  failures restore only the owner's empty draft and preserve later edits.

- Model protocol regressions use fixed fixtures for delisted models, while catalog checks and
  optional provider tests use current model IDs. Catalog refreshes no longer break type checking
  or remove coverage of historical reasoning and cache behavior.

- Repository checks skip `tmp/`, `.worktrees/`, and `.sync-feature/`, so scratch projects and
  nested checkouts do not contribute configuration, dependency, or import errors.
- The submit-routing test fixture supplies the Home-selection callback required by the editor
  submission path.

- `Session compacted N times` reports a session's history once per process instead of on every
  transcript rebuild, and no longer shares the status line, which used to overwrite it. It appears
  on startup, on a tab's first view, and after branch navigation; returning to a tab that was left
  keeps it away, because switching tabs does not compact the session.
- The TUI status, startup-input and thinking-toggle test hosts include the Home state, submit
  attachment/binding and response-model notice callbacks their host integration reads, retaining
  the original rendering and startup-input assertions. The submit-routing, prompt-history and
  transcript-parking hosts provide the mounted-tab lookup, editor text and park-time notice
  release the extracted controllers call.

- The theme JSON schema resolves `panelBg` through the shared `colorValue` definition, so JSON
  schema validators can check themes containing panel backgrounds.

- `/reload` leaves the other tabs' extension dialogs alone. Only the mounted tab's session reloads
  (`this.session.reload(...)`), but the command first called `resetExtensionUI()` with no tab id, which
  takes the "every tab" branch: it hid and disposed every tab's interactions and dropped every tab's
  terminal-input listeners. A dialog parked on a background tab was destroyed by a reload started on
  another tab, and the extension's `await ctx.ui.confirm(...)` never settled, which left that tab's turn
  running for the rest of the process. The reset is now pinned to the mounted tab, the scoping the tab
  close and session replacement paths already use.

- A command dispatched from Home no longer consumes the parked draft of the tab it targets. Home
  attaches the selected tab before it dispatches, which loads that tab's own parked draft into the
  shared composer; the command then takes the composer and its branch clears it, so the draft was gone
  once `/settings`, `/model`, `/name` or another composer-clearing command ran, and the tab's parked
  copy was overwritten with the emptied composer on the next switch. `submitHomeCommand` now takes the
  draft out before the dispatch and puts it back after it, unless the command left text of its own
  there or moved focus to another tab, the rule the command palette applies to its own draft.
  Home's action buttons dispatch through the same helper.
- The inline-widget Home-return test restores its scrollbar-setting dependency and checks that
  leaving Home restores the configured scrollbar and the widget block at the transcript tail.
- A queued host command no longer consumes the composer draft of the tab that queued it.
  `runQueuedCommand` mounts the owning tab, which loads that tab's parked draft into the shared
  composer, and then submits the command; the command's branch clears the composer, so a draft typed
  while a turn was streaming, with a `/follow-up /<command>` round queued behind it, was gone once
  that round drained, and the tab's parked copy was overwritten with the emptied composer on the next
  tab switch. The round now takes the draft out before the dispatch and puts it back after it, unless
  the command left text of its own in the composer, the rule the command palette applies to the draft
  it replaces.

- Deleting two sessions that share an id keeps both, instead of the second delete overwriting the
  first. `/delete-session` and the session selector move a session file into
  `<agent dir>/mixcode-pi/trash/`, and the trash name was built from the session id alone. Session
  ids are unique per project directory only, so the same explicit `--session-id` in two directories
  produced two files under one trash name, and the second delete renamed its file over the first one.
  That session's conversation was gone for good, and `/resume-trash` in its own project listed
  nothing to restore. A file now keeps its own name in the trash, and a name another file already
  holds gets a numeric suffix, so no delete can overwrite a file that is already there. Restoring is
  addressed by trash path instead of session id, so `/resume-trash` restores the entry that was
  picked even when two projects trashed the same id.

- Closing an agent tab leaves the other tabs' extension dialogs alone. `TabManager.closeTab` removed the
  tab from its list before awaiting the runtime's disposal, so the disposal's `beforeSessionInvalidate`
  handler resolved no tab and `resetExtensionUI` fell back to its "every tab" branch: it hid and disposed
  every tab's interactions and dropped every tab's terminal-input listeners. A dialog parked on a
  background tab was destroyed by an unrelated close, and the extension's `await ctx.ui.confirm(...)`
  never settled, which left that tab's turn running for the rest of the process. The reset is now pinned
  to the closing runtime's tab and skips the every-tab branch for a runtime the manager no longer holds,
  and the close path drops that tab's own terminal-input listeners with the rest of its UI.

- An edited TypeScript batch script re-runs its old code inside one TUI. `runTsScript` created its
  jiti instance with `moduleCache: true`, so the second `/batch <script.ts>` in the same process was
  answered from Node's module cache keyed by path and never re-read the file: a script iterated on in
  a running agent kept executing the first revision until the process restarted, while
  `/batch-dry-run` in a fresh process showed the edited plan. The loader now uses
  `moduleCache: false`, the setting the extension loader already uses so an edited extension reloads.

- A refused `/workdir` move leaves the session file alone. `reopenActiveSession` ignored the
  `{cancelled}` result of `AgentSessionRuntime.switchSession`, which an extension sets through
  `session_before_switch` (the shipped `confirm-destructive` example cancels it when the user
  declines), and rewrote the session header's `cwd` anyway: the tab kept running in the old
  directory while the file recorded the refused one, so a later resume started the session there.
  The command now reports `Workdir change cancelled` and returns before the header is touched.

- A `/tree` branch summary keeps its result on the tab that started it. The navigation's completion
  resolved the tab from the mounted UI after the summary finished, so a `tab` press while the summary
  streamed re-rendered that other tab's transcript, showed it `Navigated to selected point`, and typed
  the target user message into its composer, where it looked like the user's own next prompt. The
  completion now compares the tab it was opened on with the mounted one: the transcript and composer
  are only touched while that tab is still in front, otherwise the restored message is parked as that
  tab's draft, and the compaction flush is addressed to it explicitly.

- A completion badge on an unfocused tab reaches the persisted tab layout. Settling a background tab's
  turn set `unread` and only repainted, unlike `/mark-done`'s set and a focus's clear, so the badge never
  reached `unseen_done`: the 2 s peer layout sync adopted the stale disk value and dropped the badge about
  a second after it appeared, and a restart restored the tab without it.

- A tool card and a user message block rebuild their content on the next paint after `invalidate()`, so
  every renderer that refreshes its own card works again. The tab-switch and startup-loading perf
  change moved the rebuild out of `invalidate()` and left it to `render()`, which only re-rendered the
  existing child tree; the children cache their rows against text and width, so the old rows came back.
  A running tool's `Elapsed` line stuck at `0.0s` until output or the result arrived, the `edit` tool's
  asynchronous diff preview never appeared, and a replaced Markdown transformer had no effect on a user
  message. Both blocks now rebuild on that paint, so rows the windowed transcript never paints still pay
  nothing.

- Subagent lists remain keyboard navigable after attaching a tab from MixCode Home. Home parks
  each tab's input listeners; attaching restores them even when the tab UI is already mounted.
  Home keeps its own arrow-key navigation.

- The queue-edit choice (`s`/`f` after the dequeue key) works in an extension's editor.
  `setEditorComponent()` copies the app's special handlers onto editor components that extend
  `CustomEditor`, so the app's keys keep working there; `onQueueEditArmKey` was missing from that list
  and the armed `ctrl+u` choice fell through to `CustomEditor.handleInput`, which typed the printable
  `s` into the composer instead of pulling the queued steer back into it.

- Vim entry checks the surface it enters on. In regular (non-fullscreen) mode the modal surface does
  not exist, but the empty-queue `ctrl+u` arm still fired: it promised vim in a flash line instead of
  letting the key reach the queue's own binding, and then ate the confirmation key with a refusal.
  MixCode Home was the other way round: it covers the tab transcript, yet both `ctrl+u` then `u` and
  `/vim` entered vim on the tab behind the page, which left Home's composer ignoring every keystroke
  behind a `[VIM]` frame. The arm now declines without the fullscreen viewport and on Home, a window
  armed elsewhere can no longer be confirmed on either, and `/vim` refuses on Home with a reason.

- Fullscreen transcript scrolling keeps the visible message block anchored when terminal width changes. The windowed transcript records the top block and its progress before reflow, then remeasures that block at the new width and reapplies the offset, so a reader who scrolled up stays on the same conversation instead of the old numeric row.

- A slash command submitted on MixCode Home runs on the agent its roster has selected. The
  composer's completion-submit path and the command palette reached `defaultEditor.onSubmit`
  without the attach that `handleHomeSend` and `runHomeAction` do, so the command resolved its tab
  from the session mounted behind Home: `/delete-session` moved that tab's session file to the
  trash while the roster highlighted another agent. The submit handler attaches Home's selection
  first (`attachHomeSelectionForSubmit`).

- A message parked during `/compact` reaches the tab that queued it, even when that tab is not on
  screen. The parked queue was keyed by tab, but the flush read the focused tab's queue and sent
  through the focused session, and only the focused session's `compaction_end` reached the mode, so
  a compaction that ended behind another tab left the text in its queue: the `Steer (1)` preview
  stayed and the session never received the turn. The flush now carries the tab that owns the queue,
  and a background tab's `compaction_end` asks that tab to flush its own queue.

- `/fork` keeps the source tab's parked draft. The `/fork` branch clears the composer itself, and the
  confirmation then parked what was left in it, the command text or an empty string, over the draft
  that tab had stored. A draft typed in an agent tab, parked by Home, and then followed by `/fork` from
  Home's composer was gone when the tab came back. The confirmation now parks the composer only while
  it still belongs to the source tab, so neither Home's ephemeral composer nor a command's text touches
  that stored draft.

- The composer-level queue keys no longer act on the tab behind MixCode Home. `ctrl+u`
  (`app.message.dequeue`) popped that tab's queued round into Home's ephemeral composer, which the
  next `tab` discarded, so the message ended up in no queue and in no session; `alt+enter`
  (`app.message.followUp`) sent the text to the mounted tab while Home's own hint named the roster's
  selection, so it reached a different agent than the one the composer promised. Both keys leave the
  text where it is while Home owns the composer.

- `Escape` keeps working on every tab while a branch summary runs. `/tree` followed by a summary
  choice replaced the composer's `onEscape` with a closure calling
  `this.session.abortBranchSummary()`, and only `navigateTree` settling restored the previous
  handler. That closure reads the mounted session, so switching tabs during the summary made
  `Escape` abort a summary on the wrong session and return, which disabled every other Escape step
  on every tab - the interrupt confirm, the steer flush, the compaction and retry aborts and the
  double-`Escape` selector - until the summary finished. The composer's own handler cancels a
  branch summary the way it already cancels a compaction, so no handler is swapped in or restored.

- `/delete-session` and `/delete-all-sessions` honor a vetoed session replacement. An extension can
  cancel `session_before_switch`, which the shipped `confirm-destructive` and `dirty-repo-guard`
  examples do when the user declines a confirmation or the repo is dirty. The delete ignored that
  result and moved the file to the trash while the tab kept its conversation, so the live session
  recreated the path without the session header. It now reports `Session delete cancelled.` and
  leaves the file where the session writes.

- `ctrl+u` takes a message queued during `/compact` out of the compaction queue as well as out of
  the preview. `queueCompactionMessage` parks the text in `compactionQueuedMessages` and mirrors it
  into `pendingSteer`; the dequeue popped only the mirror, so `flushCompactionQueue` still sent the
  retracted message and left its text in the editor.

- `ctrl+u` keeps the composer draft when it pops a queued message back into the editor. The draft
went into the follow-up display mirror, which every queue sync rebuilds from the local rounds, so the
box showed it as an SDK continuation (`SDK · <draft>`) and then dropped it. It is now parked through
`ctrl+c`'s stash: `up` recalls it, and neither a steer flush nor a follow-up drain delivers text the
user has not submitted.

- Clicking a partially measured fullscreen transcript keeps the visible rows in place. Word
  selection and copying read only the requested rows in the window's coordinate space; rendering
  the whole history during a press changed estimated heights while retaining the old scroll offset,
  which jumped the viewport upward and could copy text from a different message.

- The `/resume` session selector refuses to delete a session file that any open tab holds, not only
  one whose tab is busy. It removed the file of an idle tab, and that tab kept appending to the path,
  which recreated it without the session header, so the tab's later conversation could no longer be
  loaded. `/resume-trash` already refused every open tab's file; both selectors share the check now.

- Session renames update ordinary tab titles even after a previous automatic rename, `/rename`,
  or resume, so `/auto-rename-force` no longer leaves the tab showing its old name. Batch-locked
  titles remain protected.

- Returning to a tab during an assistant response keeps its streaming text and final answer visible.
  A tab switch reset the live message component while replaying only persisted messages, so later
  updates and the completed answer were discarded by the UI even though the session saved them.
  Streaming tabs now rebuild from history plus the current live message instead of reusing a frozen
  transcript snapshot.

- Vim mode's locked composer draws no caret. The editor still drew its reverse-video caret
  and emitted the hardware-cursor marker while vim mode owned input, so the accent-framed
  card looked like it took the typing it ignores. `Editor.cursorVisible` turns both off, and
  the input card reads it from the tab's vim state on every frame.

- A command dispatched from Home no longer replaces the focused tab's parked draft. `/new-session
  <title>` typed in Home's composer closes the `/` autocomplete list, so the key reaches Home's send
  handler, which attaches the selected tab before dispatching; the command's own branch then clears
  the composer, and the draft handover parked that emptiness over the draft the tab had left with
  Home. The handover stays suspended for the run of a command Home dispatches, and the one
  `activateTab` performs suspends itself the same way, so a command that moves focus, such as `/tab
  <index>`, keeps the draft too.

- A draft typed in an agent tab survives a visit to Home followed by `/resume` (or `/new-session`).
  `handleResumeIntoTab` and `handleNewTab` parked the composer's text unconditionally, and from
  Home that text is the empty ephemeral composer, so the pick overwrote the draft the tab had
  parked. The handover now goes through the host's `saveComposerDraft`, which skips while Home owns
  the composer, and `activateTab`'s already-on-screen guard puts the tab's parked draft back in the
  composer after Home cleared it.

- `/resume` picking the session the focused tab already holds no longer wipes that tab's extension
  chrome. The already-open branch called `switchActiveTab` directly, which has no same-tab guard and
  rebuilt the tab's widgets, footer/header, statuses and custom editor from the empty `tabUi` record
  a foreground tab never has. The branch now goes through `activateTab`, whose guard leaves a tab
  that is already on screen untouched, so the current session can be re-picked without losing what
  its extensions drew.

- Pointer hover again fills the entire message card, including blank rows and horizontal padding.
  The card's own background could override the cue after the shared SGR helper was narrowed to
  resets only; block hover now re-opens only its background after every inner SGR, preserving
  foreground colors and keeping the gap between cards unhighlighted.

- An extension dialog requested after its session was backgrounded stays on that session's own tab.
  A session bound while its tab was on screen received a UI context with no owner tab, and an
  unowned context resolves `select`/`confirm`/`input`/`custom`/`editor` against whatever tab is on
  screen when the dialog is asked for. A dialog requested later, such as a permission prompt from a
  tool that awaited something or a question from an asynchronous handler, therefore painted over the
  tab in front and carried the `?` waiting mark there, while the answer resolved the pending work in
  the requesting session. The bind now passes a getter that resolves the owning tab when the dialog
  is requested, so the dialog parks on the tab that opened it and the chip reports the wait there.
- A terminal resize no longer stalls on a long conversation in fullscreen mode. The chat viewport
  wraps the transcript in an `HStack` with the widget panel column, and the layout measured every
  stretched `HStack` child by rendering it whole. That call rendered the entire transcript on every
  frame, so the windowed transcript bounded nothing and a width change dropped every width-keyed
  message cache at once. The layout now skips the intrinsic-height measurement for a stretched child
  that has a known height, and a resize re-renders only the window.
- A follow-up command queued on a tab (`alt+enter` with a local command while it streams, or
  `/follow-up <command>`) now runs on that tab. The round executes through the shared composer, so a
  round whose tab was not in front ran against whichever tab was focused when it settled, and the
  command text entered that tab's `up` history: the queued tab's command showed up as another tab's
  recalled prompt. The drain now mounts the owning tab through the serialized switch path first,
  which is how Home's action buttons and `/batch` reach the tab they act on.
- An extension's terminal-input listener survives a tab switch. `ctx.ui.onTerminalInput` listeners
  were cleared from the shared renderer whenever a tab was detached (`detachTabUi`) and never put
  back, so an extension that hides an overlay on collapse and reopens it from that listener could
  not answer it again after any tab switch, leaving the overlay hidden with no way back. Each
  listener now belongs to the tab whose extension registered it: detaching parks it, attaching the
  tab registers it again, and a session replacement drops only its own tab's listeners.
- App-level shortcuts answer while an extension dialog owns the keyboard. A dialog an extension opens
  as a capturing overlay takes focus from the composer, so every action bound with
  `defaultEditor.onAction` went dead for as long as it waited: `tab`/`shift+tab` no longer switched
  agent tabs and `ctrl+q` no longer asked to quit. Those chrome actions (tab cycling and jump, tab
  open/close, palette, quit) are now also answered from a raw input listener while the focused
  overlay belongs to an extension; the fork's own overlays and editor-slot selectors keep their keys,
  and a dialog keeps its own arrow-key navigation, since `tab` means "switch agent tabs" on every
  surface.
- A steer box no longer keeps showing a steer that another tab already sent. The host mirror behind
  the box (`followUpState.pendingSteer`) is written only by `queue_update`, and the mode subscribes to
  the active tab's session alone: a tab that was backgrounded while its steer drained never saw the
  event, so returning to it repainted the consumed entry and `Esc` would have flushed it a second time.
  Showing a tab now re-derives its steering and follow-up mirrors from the live session queues
  (`resyncQueuedMessageMirrors`), on both transcript paths (`restoreTranscript`, `renderCurrentSessionState`).
  A steer parked while compaction runs now enters the mirror ahead of the SDK-mirrored tail instead of
  after it, so that re-derivation tells the two apart and keeps both.
- The input card's top edge survives a tab name wider than the edge. The title was budgeted as
  `available - modes` and then drawn padded as ` title `, so the label overran its room by two
  columns and the fill count went negative, which `"─".repeat(fill)` rejects: a narrow pane holding
  a long session name killed the process before the card painted. The label's padding now comes out
  of the same budget, an empty label spends no columns, and the fill is clamped like the bottom
  edge's, so every edge row keeps the exact `width` the module promises.
- A `/settings` change now reaches every open tab. Each tab owns a `SettingsManager` whose merged
  settings are read once at construction, so a row toggled in one tab moved that tab alone: a
  background tab kept running under the old value (its own image, compaction and queue policy), and
  switching to it made `applyRuntimeSettings` put that older value back over the change on screen.
  Every row now re-reads the settings file in the whole roster and re-applies the values a session
  copies out of its manager (transport, steering and follow-up modes, cache warming), with a tab's
  project-level value still winning; parked transcripts are dropped so their rows rebuild under the
  new value.
- A queued steer/follow-up box stays on screen when a tab is left and re-entered. Coming back to a tab
  whose session moved on while it was away rebuilds its transcript, and that path
  (`renderCurrentSessionState`) cleared the pending-message container without repainting it, so the box
  stayed hidden until the next queue change redrew it. The rebuild now refreshes the display like the
  cached-transcript path (`restoreTranscript`) already did for a reused one.
- A message parked while compaction runs stays with the tab it was typed in. The parked queue was a
  single shared array and every tab switch reset it, so a message queued during compaction did not
  survive the switch, and a flush that outlived one could have sent it into whichever tab happened to be
  focused. The queue is keyed by tab now, like the follow-up queues; the switch leaves it alone, and the
  flush keeps the array it started with.
- An extension dialog (a question, a confirm, a picker, an editor takeover) belongs to the tab whose
  session opened it. It used to be a single surface on the InteractiveMode, so a background tab's
  question appeared over whichever agent the user was reading, and answering it there answered for the
  wrong tab. A tab that is not on screen now parks the interaction: the tab bar paints `?` in its chip
  (the Home roster says `[input]` and the masthead counts it), and the dialog comes back with the tab,
  still awaiting its answer.
- A plain tab's active title shows its highlight wave again. The chip painter re-opened its own
  background and foreground after every escape sequence in the title, so the wave's lit cell lost
  its accent color to the chip foreground the instant that cell opened; only a colored chip
  survived, because it inverts the lit cells instead of recoloring them. The painter now re-opens
  after resets only, matching mixcode's `paintTabChip`, so a nested foreground keeps its color
  until it resets.
- A command picked from the palette (`ctrl+p`) leaves the composer's draft with the tab it was typed
  in. Restoring the draft wrote it into the editor after the command returned, but the editor is shared
  and a tab command (`/new-session`, `/tab`, `/close-session`, …) leaves the switched-to tab's composer
  mounted: the draft typed in tab A appeared in tab B, and tab A lost it. The palette now records which
  surface owned the composer and parks the draft on that tab, so `/new-session` opens an empty composer
  and `shift+tab` back to tab A brings its draft back.
- A steer message still queued when the agent settles now starts its own turn. The SDK drains the
  steering queue only at an agent turn boundary, so a text left over from the ending run (the tail
  of `flushCompactionQueue` queues its remaining steer texts that way) had no run left to pick it up
  and sat in the queue until the next submission. `scheduleSteerSettleFlush` runs on
  `agent_settled` and sends the queue as one turn when no compaction or resume claimed the session,
  matching mixcode's `scheduleRuntimePendingMessageFlush`; it waits out a post-settle handoff and
  leaves a discarded conversation alone.
- A compaction started through `session.compact()` no longer lets a submission in its first window
  start a competing run. `compact()` awaits `abort()` before it installs the compaction abort
  controller, so `isCompacting` stayed false while the running turn stopped, and a message sent then
  was submitted as an ordinary prompt instead of being queued for after compaction. The manual claim
  is now set before that await and stays out of `isIdle`, which `compact()`'s own `waitForIdle()`
  call resolves on: folding it in deadlocks that wait.
- The `/settings` **Cache miss notices** row reaches every open tab. Each tab is built by its own
  `createRuntime`, so each owns a `SettingsManager` whose merged settings are read once: writing the
  global file from the tab the toggle happened in left every other open tab on the value it was created
  with, so a tab switched to after the toggle kept the notices off (or on) until `/reload` or a restart.
  A parked transcript is dropped with the change as well, since reusing one would keep the rows built
  while its notices were off. A tab that names `showCacheMissNotices` in its project settings keeps that
  value.
- Reopened sessions highlight code in the conversation again. Rows painted during startup were held in
  render caches while the deferred syntax grammars were still registering, and no plain invalidation
  reached them: a message block keeps its children's rows unless the theme changed, and the fullscreen
  layout mounts the windowed transcript, which does not forward invalidation into its blocks. Code fences
  in a deferred language, `diff` included, stayed in the plain code-block color until `/reload` rebuilt
  the chat; the grammar load now drops those rows in the chat and in every parked transcript.
- `docs/upstream-drift.md`'s "Upstream files modified by this fork" list names five more files the
  fork edits: `packages/coding-agent/src/config.ts`,
  `packages/coding-agent/src/modes/interactive/components/extension-selector.ts`,
  `packages/tui/src/keybindings.ts`, `packages/tui/src/components/editor.ts` and
  `packages/tui/src/editor-component.ts`. A sync reading that list as complete could treat them as
  upstream code and let a merge overwrite the fork's behavior there.
- `docs/windowed-transcript.md` no longer claims plain `End` reaches the transcript bottom:
  `tui.altScreen.bottom` carries no default key, so only vim mode's `G` / `End` do.
- The vim-entry chord (`ctrl+u`, then `u` or `ctrl+u`) works while the composer holds a draft. The arm
  required an empty editor, so a written-but-unsent prompt, the moment the modal surface is most
  useful, answered `ctrl+u` with `No queued messages to restore`. The arm now matches mixcode's
  `src/ui/app-input.ts` and depends only on the queues: a queued message still takes `ctrl+u` first,
  and an open autocomplete popup still keeps it.
- An unread badge no longer returns after the tab is focused. Focusing cleared `unread` in memory
  only, so the persisted `unseen_done` kept the session and the periodic peer layout poll restored the
  badge from disk a moment later. Focusing a tab now persists the cleared badge through the tab
  manager.
- `/mark-done` survives a restart that resumes a session. Such a start skips the layout restore, so
  the first publish wrote the tab's default badge over the recorded one. The shared layout adopts the
  stored badge before its first publish, and `/mark-done` persists through the tab manager.
- `install.sh` builds the runtime tree beside the live one and renames it into place, rather than
  deleting the runtime directory first. Reinstalling while the installed binary was still running
  aborted with `Device or resource busy` wherever the filesystem refuses to unlink an open file, and
  a failure partway through the copy left the runtime directory incomplete. The swap never deletes
  the live tree, and the displaced one is removed best-effort, kept for a later run when still in
  use.
- A prompt typed in one tab reaches that tab even while another tab's turn is running. The main loop
  runs one prompt at a time, so a submit received while a turn was in flight was parked in a single
  shared queue and drained to whichever tab was focused when that turn ended: the tab that received
  the input showed nothing, and the message later appeared in the other tab. A submit from a tab's
  composer now goes straight to that tab's session, and the shared queue serves only a session
  without tabs. See [Agent Tabs](docs/tabs.md).
- `home` and `end` move the composer's caret to the line start/end again in fullscreen mode. The
  alternate screen answered both keys for its transcript top/bottom actions before the focused editor
  saw them, so the keys stopped working the moment the fork defaulted to fullscreen. `tui.altScreen.top`
  and `tui.altScreen.bottom` now carry no default key and can be rebound in `keybindings.json`;
  `pageUp`/`pageDown`, the prompt jumps and the `↓ Jump to latest` label keep the transcript reachable,
  and vim mode still jumps to either end because `app.vim.top`/`app.vim.bottom` also default to
  `home`/`end` and run inside the editor.
- A restored tab that parks in an extension dialog no longer holds up the tabs behind it. `session_start`
  handlers run while the tabs restore one at a time, so a handler that opened a dialog left that bind
  pending until the user answered and every later tab stayed unbuilt. The restore queue now moves on
  when a tab parks, and the parked tab finishes on its own: it reads `waiting for input` on its Home
  card, and its session rename and transcript warm land when its bind settles. See
  [Agent Tabs](docs/tabs.md#startup-restore).
- The built-in `dark` and `light` themes no longer carry a `panelBg` key. Both restated the value
  `withThemeColorFallbacks` already derives from `toolPendingBg`, so the fork no longer edits two theme
  files upstream also churns, and both match upstream again. `panelBg` itself stays, so a user theme
  may still override the panel background.
- A tab whose session is replaced by one that carries no name — `/new`, or `/resume` onto a session
  nobody named — drops a custom title and falls back to the next free `Agent-NN`. `/rename` keeps
  the title and the session name in step, so keeping the title left the tab announcing a
  conversation that was gone and claiming a name its session no longer had; the title is dropped
  from persisted state as well, since the generated flag returns. A title that was already
  generated keeps its number.
- An extension that another extension loads during `session_start` now receives that event. Emission
  snapshots its handler list and defers handlers registered while the event runs to a later dispatch,
  which `session_start` never has, so an extension loaded by model never ran its own `session_start`
  and the status line it set there stayed absent for the whole session. `session_start` now also
  dispatches handlers added during it, bounded against self-registration; repeating events keep the
  deferral.
- An extension status set by a tab that is already on screen now reaches the footer. Every tab's
  extensions bind through the tab-scoped UI context, whose `setStatus` wrote only the tab's record,
  and the footer re-read that record on mount; the next switch then snapshotted the stale footer back
  over the record, so a status set after the tab mounted never showed. The startup tab, which binds
  live, was unaffected.
- Startup restores every recorded tab again. The loader capped the layout at 12 tabs and left the
  rest to the peer poll, which opened them one by one seconds later, so a large layout grew a tab
  after it had settled; the cap is removed.
- Starting on a session that is already part of the recorded layout no longer adds a late extra tab.
  The restore excluded that id from the tabs it rebuilt and then closed the tab holding it, so the
  peer poll reopened it once the layout had settled; the startup session now stays that layout's tab.
- A tab whose file name and session header disagree no longer opens another tab on every poll, and a
  recorded tab whose session file is gone no longer adds one per launch. Both rebuilt an id instead
  of adopting the one the session actually holds; the shared set now follows the real id, and a
  rebuilt session keeps the recorded one.
- A tab the peer reconcile opens now binds its extensions instead of showing the loading state until
  its first focus. It goes through the same one-at-a-time bind worker the restored tabs use.

- A tab opened after startup no longer swallows the notifications its extensions raise. Its
  extensions bind through the tab-scoped UI context, which recorded a notice for that tab's next
  focus instead of showing it, so the TPS line pi-tps prints at the end of a turn stayed invisible
  until the tab was switched away and back. The tab that owns the mounted transcript now shows its
  notifications at once, and only a background tab records them for its next mount.

- Reopening a saved tab layout no longer opens a second tab per session: peer tab sync started
  before the startup restore finished, so its first poll treated the tabs the loader had not built
  yet as missing and opened them again, and the transient startup session was written into the
  shared layout as well. Peer sync now starts once the restore settles.
- Switching tabs no longer paints an empty transcript after the first couple of switches: the
  windowed transcript resynced its running height only when the block list's length or edges
  changed, and a tab switch replaces the conversation in the middle, so the previous tab's
  measured blocks stayed counted and the total went negative. The counters now resync on the
  identity of the block list.
- Warming a restored tab's transcript no longer wipes the chat when a tab is already on screen:
  the cache is built in the shared chat container, which the warm pass then clears. Warming now
  stops once the user has left Home and that tab builds its transcript on the focus path instead.
- `up`/`down` stopped recalling a restored tab's messages: the startup restore warm-builds every
  persisted tab, and a warm build deliberately seeds nothing, so the composer's history was never
  filled, and attaching from Home to the already-focused tab skipped the tab switch that used to
  fill it. The composer now rebuilds its prompt history from the bound session on every activation,
  replacing it so two tabs cannot interleave, and `activateTab` compares against the tab whose UI is
  mounted rather than the manager's focus, so a restore that moves the focus still switches the
  surface. `pi-tui`'s editor gains `setHistory(texts)`, also declared on `EditorComponent`.

- The chat tail lost both of its separating rows in inline widget mode: the dock dropped every row
  while its above-editor widgets were hidden, including the row that keeps the editor off the chat,
  and the inline widget block started flush against the last message. The above-editor slot now
  keeps its separating row when its widget rows are hidden, and the inline block leads with a blank
  row, so the widget block is framed by the chat above and the composer below.

- Shared tab layouts publish local changes incrementally, so creating, closing, reordering, or
  replacing a session no longer erases tabs opened in another instance. Peers reconcile every
  2 seconds through the tab operation queue, preserve editor focus, and defer closing busy tabs.
  Empty persisted sessions are written before their ids are published, so peers can resume them.
- Tab metadata merges only changed per-session values under a lock, preserving peer titles,
  colors and unread badges. See [Agent Tabs](docs/tabs.md#concurrency).
- Pointer hover stopped painting on message blocks: the render memo added for tab-switch performance
  cached the hover-painted rows, and a passive move requests a render without invalidating, so the
  cached pre-hover rows were served and the cue never appeared. The tool card now memoizes only the
  unpainted card and paints the cue after the memo, and a hovered thinking region reports the flip so
  the assistant block drops its memo.

- A theme switch (preview or permanent) left message blocks showing the old colors: `invalidate()` only cleared the block-level memo but did not propagate to child Markdown/Box components, whose caches are keyed on content and width only. The fix propagates `super.invalidate()` down the subtree when the theme name has changed, and skips the walk on relayouts and background tab-binds where the theme is unchanged.

- The first visit to a tab still re-rendered its whole visible window, so a switch to an
  unvisited tab took 0.1-1.5 s while a repeat visit took 0.05 s. Two causes, both invisible
  without a per-call counter: the tool-display extension re-installs its row adapters while a
  tab binds, and its `invalidate` callback ran the row's eager `updateDisplay`, which threw away
  the rendered lines the row had just been warm-built with; assistant and user blocks did the
  same through `updateContent`/`rebuild` on every tree invalidation. All three now drop only
  their memo in `invalidate()` and rebuild lazily in `render()`, so a relayout or a background
  extension bind no longer discards rendered lines, and a genuine content change still clears the
  memo through its own setter. Restored tabs are also built once at startup, beside the bind that
  already walks their resources, so their first visit paints parked blocks instead of building
  them. The same 10-tab switch pass now runs at 0.04-0.18 s on the first pass, matching the
  source's 0.05 s. See [Agent Tabs](docs/tabs.md).
- Agent-tab switching paid three costs the focus path did not need: every focus change rewrote
  `open_tabs.json` and `mixcode_state.json` under a lock (~9 ms of synchronous writes on a network
  home, plus a lock wait another instance could hold), the first visit to a tab bound that tab's
  extensions inline (0.3-7 s of `session_start` handlers, measured), and the windowed transcript
  table was dropped on every switch, so the first frame re-parsed every rendered block (median frame
  48 ms before, 1.2 ms after). Focus now writes nothing (the layout is written when it actually
  changes, and once more on shutdown), a tab's extensions are bound by a background worker that drains
  right after the restored layout is in place and records its chrome against the tab, and the
  transcript table survives a switch. See [Agent Tabs](docs/tabs.md).
- Selecting a user message in `/fork` opens an independent tab immediately after its source,
  leaving the original session open. Fork titles use `-fork`, then `-1`, `-2`, and so on on
  collisions, and the selected message fills the new tab's editor. Failed startup leaves the
  source untouched and removes the generated fork file.

- A steer flush whose batch turned out to hold nothing deliverable dropped the texts it had already
  taken out of the queue: `flushSteerQueue` spliced them out, removed the mirrored copies from the
  session queue, then returned before the block that restores both on failure. A flush of only blank
  entries now puts them back.
- A tab title the user typed as `Agent-NN` was lost on save. Persisting a layout decided whether a title
  was worth keeping by comparing it against the default title for the tab's position, so a hand-typed
  `Agent-03` read as generated and was left out of `mixcode_state.json`; on the next start the title came
  back renumbered. The tab now carries `autoTitle`, set where a title is chosen and cleared where one is
  picked by hand, and the restore pass renumbers only the flagged tabs.
- The queue-text mirror in `AgentSession` removed a different occurrence than the agent's own pending
  queue when the same text sat in the queue twice: `removeQueuedMessages` dropped the last match while
  the `message_start` handler dropped the first. Both walk from the end now, so the mirror and the
  queue agree on which copy was consumed.
- `TabManager.markDone` wrote `status` directly, leaving the timer fields as the last run left them. It
  now goes through `setTabStatus`, so flagging a tab done records the transition time like every other
  status change.
- Vim mode no longer loses transcript and chrome hover highlights when entering or leaving changes
  the fullscreen layout while the pointer stays still; the last pointer cell is re-tested after
  the new frame commits, and non-capturing Vim toasts/previews no longer block hover outside their
  own rectangles.

- MixCode Home's working indicators only moved when something else repainted the frame: a tab that
  worked without emitting session events (a blocked or long-running tool, a stalled model response)
  left the roster card's spinner and its `running <n>s` counter frozen at whatever second they last
  painted. A repaint loop at the indicator's own frame cadence now runs while Home shows a working
  tab, and the same loop covers the zen separator's working dot for another agent; the focused tab's
  own indicator is a loader that already repainted itself.

- A clipped row lost its background fill from the ellipsis on. `truncateToWidth` ends a cut line with
  a full SGR reset and puts one before its ellipsis, so a row painted with `theme.bg` fell back to
  the terminal's own background for the ellipsis, the padding after it and anything else on the row.
  A shared `paintBackground` re-opens the fill after every reset the row carries; the panels, the
  `/settings` selected row and the Home roster's selected card use it, so a truncated row stays
  filled edge to edge.
- Vim mode's user-message jump never moved: the fullscreen transcript took its windowed blocks from
  `documentContainer.children`, where the chat is nested one level down, so the jump matched no
  `UserMessageComponent` and every key reported `Newest output` or `No older user message`. The same
  nesting made one block hold the whole conversation, so a painted window rendered every message
  instead of the visible ones (12-18x the flat shape's frame cost on a 400-message chat across runs,
  growing with the conversation). The chat's own blocks are the windowed units again, with the
  flattened list cached, so a frame no longer grows with the conversation.
- The vim user-message jump was relative to the viewport's top row, so a message the transcript could
  not scroll to the top was unreachable and the jump could land on an earlier message than the one it
  came from. It follows a per-tab cursor now, and the cursor's row is measured before the scroll, so
  the target is the row the scroll view reports rather than a height estimate. See
  [Vim Mode](docs/vim-mode.md).
- Vim mode swallowed `ctrl+q` (`app.quit`), so the quit confirmation could not be opened while the modal
  surface was active. Quit now passes through, like tab switching and tool expansion. See
  [Vim Mode](docs/vim-mode.md).
- Vim mode could only be entered from an idle session: an empty-editor `ctrl+u` declined while the agent was
  streaming or compacting, so the key fell through to its non-vim handler and the confirming `u` was typed into
  the composer. Entry now needs only an empty composer and no queued message, so the modal reading surface can be
  opened while output is arriving, which is when it is most useful. See [Vim Mode](docs/vim-mode.md).
- Extensions loaded under `run.sh` (bun executing the built dist) resolved their
  `@earendil-works/*` imports through ambient `node_modules` (e.g. symlinks under
  `~/.pi/agent/node_modules` pointing into another checkout) instead of the running
  host, so renderer extensions such as `mpi-tool-display` silently fell back to the
  built-in tool rows and lost the bash `description` label. The bun-dist runtime now
  routes extension imports through `virtualModules` like the compiled binary, pinning
  the specifiers that map lists to the host's own module instances; subpaths outside
  the map still resolve normally. Unbundled Node keeps the dist aliases, and bun
  running the TypeScript source (`PI_DEV=1`) stays on the source branch.
- Vim mode no longer survives a switch to MixCode Home. Tabbing from a tab in vim mode onto Home
  left the modal surface active over a page that is neither a tab nor a transcript: the composer
  swallowed every key, so no message could be typed for the roster's selected agent. Home now leaves
  vim mode, which also stops the input card from claiming `[VIM]` there. See
  [Vim Mode](docs/vim-mode.md).
- The copy confirmation counted UTF-16 code units, so an emoji or a combining sequence was
  reported as two or more characters. It counts grapheme clusters now, the unit the terminal
  paints as one character.
- The fork's settings group was labelled `Mixcode` while the rest of the UI says `MixCode`.
- The dock's truncation marker painted the muted colour while the feature describes one `dim` row;
  it paints `dim` now.
- The vim entry and top-jump notices name the keys bound to those actions instead of the shipped
  defaults, so a rebind no longer leaves a notice naming a key that does nothing. The `/vim`
  command description no longer names the leave key at all, for the same reason.
- `install.sh` prepares each runtime in a separate directory and activates it only after
  compilation and all resource copies succeed. Failed installs leave the current version
  usable; previous runtimes remain intact for running processes, including on NFS. Wrapper
  paths and PATH instructions now quote shell characters literally.
- The tab bar's wrapped rows indented past the first agent chip, so a second row started under
  the second chip and left the first chip's column empty as if it were a continuation of the
  pinned Home chrome. They now line up under the first agent chip.
- A batch tab now applies its requested model, thinking level and context limit before its
  extensions bind, requires the bind to succeed before it persists the requested name and shows
  the tab, and switches the visible tab through the serialized switch queue. Previously the tab
  was named and focused before its extensions bound, so a `session_start` plugin's commands and
  widgets were missing, and a failed bind still looked like a ready tab.
- Batch `prompts` now queue as owner-scoped follow-up rounds instead of awaiting one
  `session.prompt` per entry, and a queued command (`/color`, a plugin command, a template) is
  dispatched into the tab that queued it rather than whichever tab is focused when the round runs.
  A batch that opens one tab and runs `/color` in another no longer paints the wrong tab, and a
  plugin command no longer lands in the focused tab's session.
- MixCode Home no longer shows the transcript scrollbar. Home fits the viewport exactly and never
  scrolls, so the `always` setting only painted a full-height track beside a page with nothing to
  scroll. The scrollbar is hidden while Home is the rendered surface, and the setting applies again
  once a transcript returns.

### Removed

- The `update` command is no longer listed in `--help`: this fork installs as a standalone `mpi`
  with no supported self-update path. Its handler and sub-help stay in place.
- pi's own version-update prompt is gone: the startup check against the release endpoint, the
  `Update Available` transcript block with its changelog link, and the `PI_SKIP_VERSION_CHECK`
  environment variable that gated them are removed. The only update notice left is Home's list of
  outdated extension packages.
- The `To resume this session: pi --session <id>` line printed on interactive quit is gone, and so
  is the `formatResumeCommand` helper that built it. MixCode resumes through its own tabs, so the
  hint named a command its users do not need.
