# Vim Mode

[中文文档](vim-mode.zh.md)

Vim mode turns the fullscreen transcript into a modal, mouse-free reading surface: home-row
scrolling, page jumps, and jumping between user messages.

## Requirements

Vim mode drives the in-app transcript viewport, which only exists in **fullscreen** mode
(`/settings` → `tuiMode: fullscreen`, or `"tuiMode": "fullscreen"` in the settings file). In
regular mode the transcript lives in terminal scrollback and there is no viewport to scroll, so
`/vim` reports the requirement and stays off.

## Entering and leaving

| Entry | How |
| --- | --- |
| Command | `/vim` |
| Keyboard | With an empty editor, nothing streaming or compacting, and no queued message: `ctrl+u`, then `u` or `ctrl+u` within one second |
| Exit | `q` |

The keyboard entry arms a one-second window; any other key cancels it. Arming needs an empty editor, an idle
session, and no queued message; otherwise `ctrl+u` keeps its normal delete-to-line-start binding.

While vim mode is on the editor is locked: it renders with the accent frame, ignores typing, and
refuses to submit. Extension widgets above and below the editor are not rendered, so their rows go
to the transcript; registrations and lifecycle are untouched.

## Keys

Every key below is a configurable action: override it in `keybindings.json` under the action name.

| Action | Default keys | Effect |
| --- | --- | --- |
| `app.vim.lineUp` | `k`, `up` | Scroll 3 rows towards older output |
| `app.vim.lineDown` | `j`, `down` | Scroll 3 rows towards newer output |
| `app.vim.pageUp` | `pageUp`, `ctrl+u` | Scroll one page towards older output |
| `app.vim.pageDown` | `pageDown`, `ctrl+d` | Scroll one page towards newer output |
| `app.vim.top` | `home` | Jump to the oldest row |
| `app.vim.topPrefix` | `g` | Press twice (`gg`) to jump to the oldest row |
| `app.vim.bottom` | `end`, `shift+g` | Jump to the newest row and follow new output |
| `app.vim.nextUserMessage` | `right` | Jump to the next user message; past the last one, to the newest output |
| `app.vim.previousUserMessage` | `shift+right` | Jump to the previous user message |
| `app.vim.exit` | `q` | Leave vim mode |
| `app.vim.enter` | `ctrl+u` | Arm keyboard entry from an empty editor |
| `app.vim.enterConfirm` | `u` | Confirm the armed keyboard entry |

Vim mode is modal: any key that is not one of the above is swallowed so it cannot reach the editor.
`tab` / `shift+tab` (tab switching), `ctrl+o` (tool expansion) and `ctrl+t` (thinking blocks) keep
working. Double-`Esc` does not open the session tree or fork while vim mode is on; `q` is the only
exit.

## Multi-tab behaviour

Vim mode is per tab and follows focus: switching tabs while vim mode is on hands the modal state to
the tab being shown and clears it on the tab being left. At most one tab is in vim mode.

## Feedback

The arm prompt, jumps and refusals appear as a transient flash line in the transcript. A message that is not
found in the current transcript reports `No older user message` or `Newest output` rather than
failing silently.
