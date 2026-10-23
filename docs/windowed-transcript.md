# Windowed Transcript

[中文文档](windowed-transcript.zh.md)

By default the fullscreen layout renders every message component on every frame and clips the
result to the viewport, so frame cost grows with the whole conversation. This fork gives the
fullscreen scroll view a *windowed* transcript child instead: it reports a virtual row count and
renders only the rows near the viewport. Long conversations scroll at a bounded per-frame cost.

## How it works

1. The transcript viewport is `VStack[ScrollView(transcript), dock]`, mounted under the tab bar; its
   scroll child is a `WindowedTranscript`
   (`packages/coding-agent/src/modes/interactive/components/mixcode/windowed-chat/`), and the open
   widget panel splits those rows in an `HStack`. The layout measures no intrinsic height for a
   stretched `HStack` child, so the panel column cannot render the transcript whole either.
2. The layout engine asks it for a line count and for the rows of the current viewport
   (`packages/tui/src/mixcode/windowed-node.ts`, `WindowedLayoutState`).
3. Blocks the user has already scrolled past keep their last measured height; blocks that were
   never rendered contribute an estimate (4 rows). The sum is the scroll range, so the scrollbar
   and vim mode's `G` / `End` still reach the newest output.
4. The window is rendered with 20 rows of overscan above and below (`WINDOW_OVERSCAN_LINES`), so a
   one-row scroll does not re-render the neighbouring block.
5. Rows are counted from the top and only blocks inside the window are measured, so appending output
   leaves the rows above it where they are. A jump renders the offset it was given.
6. The windowed child also reports the row offset and the total its own measurements settled on, and the
   layout paints and scrolls against those. A frame that measured part of the content therefore leaves the
   scroll range and the visible rows consistent with each other, instead of painting an offset the estimates
   produced.
7. Search, prompt jumps (`ctrl+shift+up/down`) and clipboard selections ask for exact rows on demand,
   and materialize the document once. The open search overlay keeps its materialized lines until the
   transcript's measured height changes, so an idle frame stays O(window). Vim's user-message jumps
   read the matched blocks and their exact rows through `matchingBlocks`, since the preview panel
   lists every match; one jump measures the whole document once.
8. A surface swap keeps the row the reader was on. Each tab remembers the block at its viewport top,
   and the incoming tab resolves its own anchor on the next frame instead of reusing the outgoing
   offset; a tab that was at its newest output, or whose transcript was rebuilt while parked, opens
   at the end. See [Agent Tabs](tabs.md).

## What stays the same

- Regular mode is untouched: `documentContainer` is mounted directly and renders the whole
  document.
- The final document printed when leaving fullscreen is the whole transcript followed by the dock.
- Message components keep their own caches (Markdown, Text, Box). The container adds no
  cross-frame line cache: it re-renders the window each pass, with a short-lived per-pass cache so
  one pass does not render a block twice.
- Mouse events still reach the block under the pointer: rows are in content coordinates, and the
  container maps them back to a block before dispatching. The same mapping is readable without
  dispatching (`componentPathAtRow`), so a host can ask what a content row is made of and where in each
  component it sits; the mouse selection uses it to tell a row inside a pointer-cued card from a plain
  one.
- A conversation that fits the viewport window is measured in full, so a short conversation reports
  exact heights.

## Limits

- Estimated rows are only replaced by real measurements once a block enters the window, so the total
  height of a long conversation converges as it is scrolled through. Rows are counted from the top
  and the window is assembled from the nearest end, so following the end paints the newest rows on
  the first frame, whatever the estimate says about the blocks above.
- A frame mid-history costs the window plus the distance to the nearest end of the conversation, the
  same shape as the walk the original renderer uses; frames at the end and at the top are flat in the
  conversation's length.
- A windowed transcript is not the same object as the mounted `documentContainer`; code that adds
  or removes messages keeps using `chatContainer`, which both trees read.
