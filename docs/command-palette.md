# Command Palette and Quit Confirmation

[中文文档](command-palette.zh.md)

Two hotkeys: `ctrl+p` lists every command the UI can run, and `ctrl+q` asks before ending the session.

## Command palette

The palette floats over the editor as a framed panel (78% of the terminal width, at most 80% of its
height), so the draft being typed stays visible behind it.

| Action | Keys |
| --- | --- |
| Open the palette | `ctrl+p` (`app.palette`) |
| Move the highlight | `up`, `down` (wraps) |
| Run the highlighted command | `enter` |
| Close without running anything | `esc`, `ctrl+c` |
| Run a row with the mouse | click it (fullscreen mode only; the regular renderer has no mouse input) |

`/palette` opens the same list; `/palette <arg>` reports `Usage: /palette`.

The list holds every command source the editor's `/` autocomplete offers: built-in commands,
extension commands (a name that collides with a built-in is dropped), skill commands when skill
commands are enabled, and prompt templates. The palette never lists itself.

Typing filters the rows. The query is matched against the command name only. The description is
shown beside it but takes no part in the match, so highlighted characters always sit in the column
that decided the row survived. The characters the query matched are painted, so the part of the
command that matched is visible. Rows are ordered by match quality, so an exact or prefix hit leads.
Selecting a row submits `/<command>` through the ordinary submit path, so argument parsing,
gating, confirmations and error messages are exactly what typing the command would produce. Once
the command is done with the editor, the draft that was there comes back, so picking from the
palette never costs the user what they had typed.

`ctrl+p` used to cycle models forward. That binding now opens the palette and `app.model.cycleForward`
ships with no default key; `shift+ctrl+p` (or `alt+p` on Windows and WSL) still cycles backwards, and
`ctrl+l` opens the model selector.

## Quit confirmation

| Action | Keys |
| --- | --- |
| Quit, after confirmation | `ctrl+q` (`app.quit`) |
| Confirm | `y` |
| Cancel | `n`, `esc`, `ctrl+c` |
| Exit immediately, no question | `ctrl+d` (`app.exit`), unchanged |

`ctrl+q` opens a framed panel at the centre of the terminal that names the action and waits for `y`.
It cancels on `n`, `escape` or `ctrl+c` and ignores every other key; cancelling leaves the session,
its draft and its tabs untouched.

On Windows and WSL `ctrl+q` stays bound to `app.message.followUp`, the only follow-up chord those
terminals deliver, so the quit chord there is `ctrl+shift+q`.

`/quit` keeps quitting immediately, without the panel. Since the palette lists `/quit`, running
that row also quits immediately. The panel guards the key, not the command.

## Files

- `packages/coding-agent/src/modes/interactive/components/mixcode/command-palette/`: the list.
- `packages/coding-agent/src/modes/interactive/components/mixcode/quit-confirm/`: the panel.
- `packages/coding-agent/src/modes/interactive/mixcode/command-list.ts`: the command list this panel
  and the editor's `/` autocomplete share.

## Notes

Both chords are reserved against extension shortcuts: an extension that registers `ctrl+p` or the
quit chord is skipped with a warning, the same way `ctrl+d`, `ctrl+c` and `escape` already are.

`ctrl+p` is ignored while the editor's own `/` command popup is open, because that popup already owns
the keyboard.
