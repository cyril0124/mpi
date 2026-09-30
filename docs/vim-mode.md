# Vim Mode

[中文文档](vim-mode.zh.md)

Vim mode turns the fullscreen transcript into a modal, mouse-free reading surface: home-row
scrolling, page jumps, and jumping between user messages with a preview panel.

## Requirements

Vim mode drives the in-app transcript viewport, which only exists in **fullscreen** mode, the
default TUI mode. In regular mode the transcript lives in terminal scrollback and there is no
viewport to scroll, so `/vim` reports the requirement and stays off. To leave fullscreen, pick
regular in `/settings` → `tuiMode`, or set `"tuiMode": "regular"` in the settings file.

## Entering and leaving

| Entry | How |
| --- | --- |
| Command | `/vim` |
| Keyboard | With an empty editor and no queued message (the session may be working): `ctrl+u`, then `u` or `ctrl+u` within one second |
| Exit | `q` |

The keyboard entry arms a one-second window; any other key cancels it. Arming needs an empty editor and no
queued message; the session may be working, which is when reading the arriving output matters most. Otherwise
`ctrl+u` is left to its other bindings (with a queued message it edits that queue).

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
| `app.vim.nextUserMessage` | `right` | Jump to the next user message, or past the last one to the newest output; paints the user-message panel |
| `app.vim.previousUserMessage` | `shift+right` | Jump to the previous user message; paints the user-message panel |
| `app.vim.exit` | `q` | Leave vim mode |
| `app.vim.enter` | `ctrl+u` | Arm keyboard entry from an empty editor |
| `app.vim.enterConfirm` | `u` | Confirm the armed keyboard entry |

Vim mode is modal: any key that is not one of the above is swallowed so it cannot reach the editor.
`tab` / `shift+tab` (tab switching), `ctrl+o` (tool expansion), `ctrl+t` (thinking blocks) and
`ctrl+q` (quit) keep working. Double-`Esc` does not open the session tree or fork while vim mode is
on; `q` is the only way to leave the modal surface.

## User-message navigation

`right` and `shift+right` walk the chat with a per-tab cursor that starts past the newest message:
the first `shift+right` lands on the last user message, and `right` from there goes to the newest
output. The cursor survives manual scrolling and resets when the modal surface is left.

Every jump paints a `User Messages` panel at the bottom right, directly above the composer. It lists
one row per user message, taken from the first line of its text and clipped to 28 columns, followed
by a `<NEWEST>` row that stands for the newest output; the message the viewport landed on is
highlighted. A list longer than the panel's row budget (3 to 7 rows, taken from the transcript
height) reports `↑ N older above` and `↓ N newer below`. The panel lives for 1.8 seconds and another
jump replaces it; leaving vim mode takes it down with the mode.

## Multi-tab behaviour

Vim mode is per tab and follows focus: switching tabs while vim mode is on hands the modal state to
the tab being shown and clears it on the tab being left. At most one tab is in vim mode.

MixCode Home is not a tab and not a transcript, so entering it leaves vim mode. The composer there
belongs to the roster's selection, and leaving the modal surface on would swallow its keys.

## Feedback

The arm prompt, jumps and refusals appear as a transient flash line in the transcript, and a jump
also paints the [user-message panel](#user-message-navigation) above the composer. A message that is
not found in the current transcript reports `No older user message` or `Newest output` rather than
failing silently.
