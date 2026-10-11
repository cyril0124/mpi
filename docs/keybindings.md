# Keybindings

[中文文档](keybindings.zh.md)

Upstream's [Keybindings](../packages/coding-agent/docs/keybindings.md) page lists the ids the two
share. This page covers what the fork rebinds, the ids it adds, the order the composer
resolves a key in, and what `Escape` does. Where the two pages disagree, upstream's is stale and
[Upstream Drift](upstream-drift.md) says why.

## Rebinding

Overrides live in `<agentDir>/keybindings.json`, that is `~/.pi/agent/keybindings.json` or
`$PI_CODING_AGENT_DIR/keybindings.json`. Each id takes a key string or an array of them:

```json
{
  "app.tab.next": ["tab", "alt+right"],
  "app.thinking.toggle": "ctrl+alt+t"
}
```

- `/reload` re-reads the file without restarting.
- `/hotkeys` prints the common editor and app chords that are in force, extension shortcuts included.
  It is a curated list, not an enumeration: several ids this page documents are not in it.
- Two ids may share a default when their surfaces never overlap — `left` is both
  `app.home.returnHome` and `app.workdir.parent`. Where two ids on the same surface collide,
  registration order decides; `ctrl+t` and `ctrl+u` below are the two that matter.

## Rebound ids

| Id | Upstream default | This fork | Why |
| --- | --- | --- | --- |
| `app.thinking.cycle` | `shift+tab` | `alt+t` | `shift+tab` switches agent tabs |
| `app.model.cycleForward` | `ctrl+p` | none | `ctrl+p` opens the command palette |
| `app.message.dequeue` | `alt+up` (`alt+q` on Windows and WSL) | `ctrl+u` | the action edits one queue instead of restoring every entry, and `ctrl+u` matches that workflow; a queued message takes the key before the vim-entry arm |

`app.model.cycleForward` keeps `app.model.cycleBackward` (`shift+ctrl+p`, `alt+p` on Windows and
WSL) as the way to step back to the previous model.

## Ids the fork adds

Context-scoped, so a key may appear once per surface.

| Id | Default | Surface |
| --- | --- | --- |
| `app.quit` | `ctrl+q` (`ctrl+shift+q` on Windows and WSL) | quit, asking first — see [Command Palette](command-palette.md) |
| `app.palette` | `ctrl+p` | command palette |
| `app.notice.copy` | `c`, `y` | copy the console notice while the composer is empty — see [Console History](console-history.md) |
| `app.notice.dismiss` | `escape`, `q` | close the console notice |
| `app.tab.next` | `tab`, `ctrl+shift+right` | next agent tab — see [Agent Tabs](tabs.md) |
| `app.tab.previous` | `shift+tab`, `ctrl+shift+left` | previous agent tab |
| `app.tab.new` | none | open a new agent tab |
| `app.tab.close` | none | close the current agent tab |
| `app.tab.jump` | `ctrl+t` | Tab Jump overlay |
| `app.tabJump.selectPrevious` | `up`, `ctrl+k`, `shift+tab` | Tab Jump: move the highlight up |
| `app.tabJump.selectNext` | `down`, `ctrl+j`, `tab` | Tab Jump: move the highlight down |
| `app.tabJump.toggleNonIdle` | `ctrl+f` | Tab Jump: show only tabs with something to report |
| `app.home.returnHome` | `left` | return to MixCode Home when the composer is empty — see [MixCode Home](home.md) |
| `app.home.selectPrevious` | `up` | Home: previous agent |
| `app.home.selectNext` | `down` | Home: next agent |
| `app.home.attach` | `right` | Home: attach to the highlighted agent |
| `app.home.send` | `enter` | Home: send the composer to the highlighted agent |
| `app.home.toggleNonIdle` | `ctrl+f` | Home: non-idle filter |
| `app.widgets.panel` | `right` | toggle the widget side panel when the composer is empty — see [Widget Layout](widget-layout.md) |
| `app.workdir.parent` | `left` | workdir picker: go to the parent directory |
| `app.workdir.enterDir` | `tab` | workdir picker: enter the highlighted directory |
| `app.workdir.toggleHidden` | `ctrl+h` | workdir picker: show or hide dot-directories |
| `app.workdir.clearQuery` | `ctrl+u` | workdir picker: clear the filter |
| `app.queueEdit.steer` | `s`, `shift+s` | armed queue choice: steer the queued message |
| `app.queueEdit.followUp` | `f`, `shift+f` | armed queue choice: keep it as a follow-up |
| `app.queueEdit.cancel` | `escape` | armed queue choice: cancel |
| `app.vim.enter` | `ctrl+u` | vim mode: arm entry while no message is queued, whatever the composer holds, on an agent tab in fullscreen mode — see [Vim Mode](vim-mode.md) |
| `app.vim.enterConfirm` | `u` | vim mode: confirm entry while armed |
| `app.vim.exit` | `q` | vim mode: leave the modal transcript |
| `app.vim.lineUp` | `k`, `up` | vim mode: scroll 3 rows towards older output |
| `app.vim.lineDown` | `j`, `down` | vim mode: scroll 3 rows towards newer output |
| `app.vim.pageUp` | `pageUp`, `ctrl+u` | vim mode: scroll 10 rows towards older output |
| `app.vim.pageDown` | `pageDown`, `ctrl+d` | vim mode: scroll 10 rows towards newer output |
| `app.vim.top` | `home` | vim mode: oldest output |
| `app.vim.topPrefix` | `g` | vim mode: press twice for the oldest output |
| `app.vim.bottom` | `end`, `shift+g` | vim mode: newest output |
| `app.vim.nextUserMessage` | `right` | vim mode: next user message |
| `app.vim.previousUserMessage` | `shift+right` | vim mode: previous user message |

Two defaults share a key with an upstream id, and both resolve by registration order rather than by
conflict: `ctrl+t` is `app.tab.jump` here while `app.thinking.toggle` keeps its own `ctrl+t`, and
`ctrl+u` is `app.message.dequeue` while `tui.editor.deleteToLineStart` keeps its own `ctrl+u`. In
both cases the fork registers its handler first, so the chord reaches the fork action and the
upstream action needs a rebind; `/hotkeys` prints both ids' keys and marks `app.thinking.toggle` as
taken by Tab Jump.

## Key resolution order

The order is fixed in the composer's input handler, and only the first match runs:

```text
key from the terminal
  │
  ├─ vim mode active? ────────► vim mode owns it, except six passthrough
  │                             actions (tabs, Tab Jump, tools, thinking
  │                             toggle, quit); the rest is swallowed
  ├─ empty queue, ctrl+u? ────► arms vim entry (fullscreen on an agent tab
  │                             only; a queued message declines it)
  ├─ empty composer, right? ──► widget side panel
  ├─ queue choice armed? ─────► s / f / escape
  ├─ extension shortcut? ─────► the extension's handler
  ├─ paste-image chord? ──────► clipboard paste
  ├─ escape? ─────────────────► Escape dispatch below (declined while
  │                             the autocomplete popup is open)
  ├─ ctrl+d on an empty editor► exit
  ├─ tab / shift+tab with the
  │  autocomplete popup open ─► the editor keeps them
  ├─ history bindings? ───────► the editor's own history
  ├─ another app id? ─────────► its handler; returning false declines
  │                             and the next id is tried
  └─ otherwise ───────────────► the editor
```

Extension shortcuts sit below vim mode, the vim entry arm, the widget panel and an armed queue
choice, so none of those can be taken from them; above every other app id.

## Escape

`Escape` walks a fixed list and stops at the first step that applies:

1. MixCode Home is on screen: nothing happens. Home is a navigation surface that owns an ephemeral
   composer, so `Escape` never reaches the tab behind it; interrupt that run from its own tab, and
   leave Home with `right` on a row or `tab`.
2. A compaction or a branch summary is running on the tab on screen: it is cancelled, which is what
   the status line that announced it says. One running on a tab behind another one is left alone;
   switch to that tab to cancel it.
3. An automatic retry is waiting on the tab on screen: it is cancelled, which is what the status line
   that announced it says. A retry on a tab behind another one is left alone; switch to that tab to
   cancel it.
4. A queued steer message sends now: the run is aborted and the steer queue is flushed as one turn.
   Follow-up rounds are never promoted this way.
5. The session is streaming: the first `Escape` only arms a 1 s confirm window and says so; a
   second `Escape` inside that window interrupts the run, and one after it arms again. A turn that
   has not produced anything readable yet - no assistant text, no thinking, no tool call, no
   displayed extension message or rendered custom entry - with an empty composer and no queued
   follow-up round is retracted instead: the branch leaf rewinds to before that run's own user
   message and the text returns to the composer, so a prompt sent too early can be edited and sent
   again. Every other run aborts as before: a queued steer text returns to the editor, while a
   queued follow-up round stays in the queue, paused.
6. A bash command is running: the bash command is aborted.
7. The composer is in `!` bash mode: the editor is cleared and bash mode is left.
8. The editor is empty: a second `Escape` within 500 ms opens the session tree or the fork
   selector, whichever `doubleEscapeAction` selects; `none` disables it.

A capturing overlay consumes the key before the composer sees it. The confirm window belongs to the
run: it is dropped when the run starts or ends, when the active tab changes, and when a compaction or
an automatic retry takes the key. A tab switch while a confirmed interrupt is still settling drops the
retract instead of applying it to the tab now in front: the interrupted run stays aborted, and that
tab keeps its own run and queue. Vim mode replaces this list while it is active - `q` leaves it.
