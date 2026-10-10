# Mouse Selection

[中文文档](mouse-selection.zh.md)

In fullscreen mode, dragging with the primary mouse button over the transcript, the prompt card,
or the notice panel highlights the text and copies it on release. Hold the drag past the top or
bottom edge of the transcript and it scrolls, extending the selection as it goes.

The drag itself, the grapheme-snapped slicing, the viewport anchoring and the edge auto-scroll are
pi's fullscreen selection. What it cannot know from the screen alone is which surfaces may take a
selection and which cells of them are not text, so this fork supplies both.

## What may be selected

| Surface | What a drag selects |
| --- | --- |
| Transcript | the chat blocks, ANSI-clean, one line per row |
| Prompt card | the draft body, without the card's frame or its hint row |
| Notice panel | the console lines, without the panel's frame or its `c/y copy · escape/q close` row |

A press outside all three starts no selection, so the tab bar, the model/thinking/workdir badges,
the footer, and the dock widgets keep whatever a click on them already did.

While a modal overlay owns the pointer (`/settings`, a picker, a quit confirmation, an extension
dialog), only the notice stays selectable: the transcript and the prompt card are not published as
surfaces at all. The notice is non-capturing, so it never blocks the rest of the UI and its own
text can still be dragged out of it.

## While output arrives

Pressing the mouse in the transcript pins it for as long as the button is down. Output that streams in
meanwhile is painted below the pinned rows instead of scrolling them away, so the drag keeps selecting
the text it started on. Releasing leaves the transcript where you left it when output arrived during the
press or you scrolled it; a press that moved nothing follows again. Either way, the `↓ Jump to latest`
label or a wheel scroll back to the bottom returns to the end.

## Copied text

The clipboard gets plain text, never the frame the drag crossed:

- Syntax highlighting, block backgrounds, and terminal sequences are stripped.
- The prompt card's frame goes with it: rows that are only a box border (`────`, `┌─ … ─┐`, `└──┘`) are
  dropped, a leading and trailing `│` column are removed, one column of card padding is dropped, and
  inside a frame a hint row is dropped when it carries an arrow glyph plus one of
  `enter|ctrl|shift|tab|scroll|select|accept|cancel`.
- The notice row naming `c/y copy` or `escape/q close` never reaches the clipboard.
- Wide characters survive: a CJK glyph or emoji under either end of the drag is copied in full, never
  half a cell.

A drag that selects only frame rows copies nothing and reports nothing, so an accidental brush
against the prompt card's border does not wipe the clipboard.

## Highlight

Selected cells are painted with the theme's `selectedBg`, not with reverse video. The background is
re-opened after every SGR inside the selection, so a tool block's or a thinking block's own
background cannot swallow it.

Inside a block that carries the pointer cue — a tool call, a summary card, a skill invocation, the
thinking block — the selected cells of its card rows also gain an underline. The cue fills those same
cells with the same background, so without it a selection inside a block would be indistinguishable
from hovering it. Every other row of the transcript keeps the plain background, including the blank
gap a block renders above its card.

## Release

Releasing the mouse button copies the selection and reports `Copied N chars.` through the toast,
where `N` is the length of the cleaned text. With `fullscreenCopyOnSelect` on (the default) the
release also drops the highlight in the same frame, so a drag shows a selection only while the button
is down; with the setting off the selection stays on screen for `ctrl+x`. A failed clipboard write
reports the reason instead, and an empty selection reports nothing.

`ctrl+x` (`app.message.copy`) still copies the last assistant message; when
`fullscreenCopyOnSelect` is off and a selection is on screen, it copies that selection instead,
exactly as before.
