# MixCode Home

[中文文档](home.zh.md)

MixCode Home is the landing surface of the fork: one page listing every open agent tab, with a
preview of the selected agent's conversation and the two actions that start a session. It exists
in the tab cycle as a pseudo-tab (`home`) that owns no session and no runtime.

## Getting there

| From | Action | Result |
| --- | --- | --- |
| An agent tab | `left` with an empty composer | Home opens with that agent selected |
| Any tab | `tab` / `shift+tab` | Cycles `[Home, ...agents]` and wraps, unless the focused agent is in [zen mode](zen-mode.md) |
| An agent tab | Click the `MixCode Home` chip | Home opens. With Home already focused the same click opens [Tab Jump](tabs.md#tab-jump) instead |

`left` does nothing while the composer holds text: the key belongs to the editor then, so cursor
movement keeps working.

## The page

```text
   MixCode / HOME                                                            v0.87.1
   ~/project                                                             1 working
   ──────────────────────────────────────────────────────────────────────────────
   Agents 3                                                     + New session  [ Resume ]
   ──────────────────────────────────────────────────────────────────────────────
   › ● Worker-01                                                        ⠹ [running]
     faux-1 · 21k/200k · running 1m 05s
     ⎿ Running the test suite
     ✓ Research                                                        [done]
     grok-4.6 · 8k/500k · 3m ago
     ⎿ Found the parser bug

   ↑/↓: select  →: attach  Enter: send  Tab: cycle tabs  Ctrl+F: non-idle
```

Each card is three rows plus a blank: title with status chip, `model · context · recency`, and
the newest assistant (or system, or user) text. The selected card carries the selection
background. The roster windows around the selection and marks the hidden sides with
`↑ older above` / `↓ newer below`.

When the startup check finds outdated extension packages, Home lists them above the roster:
`Package Updates Available`, the instruction line `Package updates are available. Run pi update
--extensions`, the `Packages:` label, and one line per package. Home is the only place this notice
appears: the chat transcript does not carry it, and pi does not prompt about its own releases. A
viewport too short for the list keeps the first entries and ends with `… more package updates · pi
update --extensions`.

Home paints no footer: the working directory, the usage and model line, extension statuses and the
extension widgets are per-agent chrome, so it also hides the working indicator. Everything comes back
when an agent is attached.

When the table body has at least 114 columns and 18 rows to work with (roughly a 120-column
terminal, with the masthead and tab bar already taken out of the height) the page splits: roster
on the left, the selected agent's conversation on the right. Below that the conversation
collapses into a short preview panel under the roster, and very short viewports give every row
to the roster.

## Keys

| Key | Action id | Behavior |
| --- | --- | --- |
| `up` / `down` | `app.home.selectPrevious` / `app.home.selectNext` | Move the selection through the visible roster |
| `right` | `app.home.attach` | Attach to the selected agent (requires an empty composer) |
| `enter` | `app.home.send` | Send the composer to the selected agent, staying on Home |
| `ctrl+f` | `app.home.toggleNonIdle` | Show only agents that are working, failed, finished, or unread |
| `left` | `app.home.returnHome` | Return to Home from an agent tab with an empty composer |

Every one of these declines the key when it does not apply, so the editor keeps `up`/`down`
(prompt history), `left`/`right` (cursor), `ctrl+f` (cursor right) and `enter` (submit) as
usual on agent tabs. They also decline while the editor's `@`/`/` completion popup is open, so the
popup keeps the keys. `ctrl+j` inserts a newline in the composer instead of sending.

## Sending from Home

The composer is ephemeral: entering Home clears it, and the text never becomes a tab draft. While it
is empty it names the agent the next message goes to (`Send to <agent>...  @ files  / commands`, or
`Select an agent...` with an empty roster), and Home frames the composer in the neutral thinking colour
rather than the bound session's.
`enter` with plain text submits to the selected tab's session while Home stays focused, so an
agent can be given work without attaching to it, and a message to an agent that is already
working is taken as steering. A `/command` or a `!shell` line acts on the bound session, so it
attaches to the selected tab first and then submits through the normal dispatcher. Sending does
not clear the target tab's unread badge; only attaching does.

`MIXCODE_DISPLAY_WORKDIR` replaces the workdir shown in the masthead and on each card, and
`MIXCODE_DISPLAY_MODEL` replaces the model label, so a recording can hide the real paths and
provider. Both are unset by default.

## Actions

` + New session ` and `[ Resume ]` run `/new-session` and `/resume`. Clicks fire on release over
the button that was pressed; dragging out cancels, hovering only repaints, and a resize or a
dialog resets the capture. Both commands can also be typed into the composer.

## Known divergences

Where mixcode-pi's Home page relies on machinery this fork does not have, the fork keeps its own:

- no toast overlay, title shimmer, or loading-phase status chip;
- no zen mode; vim mode is a per-tab transcript surface, and Home neither enters it nor hands it on;
- the empty composer's hint names its own surface rather than mixcode-pi's: Home names the target
  agent, an agent tab reads `Describe your next change...  @ files  / commands`, and vim mode lists
  its navigation keys;
- the masthead's `N input` counter never appears, because nothing tracks a tab waiting on the user;
- startup lands on the restored tab rather than Home, so the fork's tab-layout restore is not
  overridden;
- an extension's terminal-input handler runs before Home's keys, and file completion on Home
  resolves against the bound tab's workdir rather than the selected tab's.
