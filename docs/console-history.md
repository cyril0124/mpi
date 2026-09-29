# Console History

[中文文档](console-history.zh.md)

Interactive mode paints the terminal itself and writes frames to stdout. Extension code that calls
`console.log`, `console.warn` and the other console methods would write raw text to that same
terminal, corrupting the frame and duplicating the tab bar. Those five methods are therefore
relocated: their output is formatted exactly as Node's console formats it, prefixed with
`[console.<method>]:`, and painted into a notice panel above the composer. `console.group`,
`console.table`, `console.count`, `console.time*`, `console.assert` and `console.trace` still reach
the bridge, because Node implements them on top of `log`, `warn` and `error`; `console.dir` and the
helpers that print nothing stay native.

The bridge is installed at the start of interactive startup, before the runtime loads any extension,
so an extension's first log line is captured too. Lines produced before the TUI exists are queued
and appear in the panel in order once it starts; if the process ends before that (a startup error,
for example), the queued lines are written to the streams they would have reached.

Only interactive mode installs the bridge. `-p`, RPC, `--help`, `--list-models`, `--export` and
the other command line paths keep ordinary console output. A crash that escapes the TUI writes
its report straight to stderr, after the TUI has been torn down, so the report is readable in the
terminal even though `console.error` elsewhere is bridged.

## `/console-history`

The captured lines go to an external editor when one is available:

- Candidates in order: the `externalEditor` setting (project scope before global), `$VISUAL`,
  `$EDITOR`, then `nvim`, then `vim`. Each one has to answer `--version` within a second, so a stale
  path or a wrapper that waits for input is skipped. A configured editor that fails the probe is not
  replaced by `nvim`/`vim`, so a deliberate setting always wins over chance.
- The TUI steps aside while the editor owns the terminal, and comes back when it exits. The text is
  handed over to be read: whatever the editor writes back is discarded.
- With no editor left to try, the lines are printed as a transcript block instead.

| Command | Behavior |
| --- | --- |
| `/console-history` | Open the lines captured by this process in the external editor, oldest first, one per line, as `YYYY-MM-DD HH:MM:SS [<tab>] <line>`. With no editor available, show them as a transcript block. Any argument reports `Error: Usage: /console-history`. |

An interactive process keeps the last 1,000 lines, each with the time it was emitted and, when a
tab's work emitted it, that tab's title. The history lives in memory only: restarting MixCode
clears it. With nothing captured yet the command reports `No console history in this process.`

A message that spans several lines is one entry, and its own newlines are kept, so a multi-line
diagnostic reads as it was written.

## Tab labels

The label comes from the tab whose work was running when the line was emitted: an agent turn, an
extension command, or a shell command. Work that no tab owns, such as startup or extension timers,
carries no label, and its line shows the timestamp alone. Two tabs working at the same time keep
their own labels, even when the user switches to a third tab while both are running.

## The notice panel

The relocated lines land in one panel, bottom-centered above the composer:

- It floats over whatever the screen shows and does not take focus, so the composer keeps accepting
typing while it is up.
- Consecutive lines from the same burst grow the same panel; a dismissed panel is gone, so the next
line opens a new one.
- A long line wraps instead of being cut, and the panel stops growing at about 60% of the terminal
height: older lines are dropped and a dim `(N earlier lines hidden · c/y copy all)` row takes their
place.
- `c` or `y` (`app.notice.copy`) copies the whole panel text; `Esc` or `q` (`app.notice.dismiss`)
closes it. While a run or a bash command is live, `Esc` keeps its interrupt meaning and the panel
then closes on the next one.
- Both bindings are ordinary fork keybindings, so they can be remapped in `keybindings.json`.

The panel is a transient view, not a record: `/console-history` is the list of what was captured.
