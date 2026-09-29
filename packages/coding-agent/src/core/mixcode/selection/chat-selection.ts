/**
 * Text cleanup for a mouse drag selection.
 *
 * pi-tui owns the drag/release/copy engine; what it cannot know is which part of the
 * screen the drag ran over. A selection that crossed the prompt card or the notice panel
 * would otherwise copy that surface's own frame: border rows, the `│` columns, the card
 * padding and the hint row that names the keys.
 *
 * The transcript needs no cleanup beyond what pi-tui already does, so `chat` passes the
 * text through.
 */

/** The surface a drag ran over, deciding how its copied text is cleaned. */
export type MouseSelectionSurface = "chat" | "input" | "notice";

/** Clean the text copied from `surface`, one line at a time; an unknown surface passes through. */
export function normalizeSelectionText(text: string, surface: string): string {
	if (surface === "input") return normalizeLines(text, normalizeInputSelectionLine);
	if (surface === "notice") return normalizeLines(text, normalizeNoticeSelectionLine);
	return text;
}

function normalizeLines(text: string, normalize: (line: string) => string | undefined): string {
	return text
		.split("\n")
		.map(normalize)
		.filter((line): line is string => line !== undefined)
		.join("\n");
}

/**
 * Prompt-card body: drop the frame rows, the border columns, the card's padding column and the
 * hint row. Only a framed line has that padding column; on a plain line the leading space is text.
 */
function normalizeInputSelectionLine(line: string): string | undefined {
	const visible = line.trimEnd();
	if (isBoxBorderLine(visible)) return undefined;
	const unframed = stripVerticalBorders(visible);
	const body = unframed.framed ? dropPaddingColumn(unframed.text) : unframed.text.trimEnd();
	if (unframed.framed && isFramedInputHintLine(body)) return undefined;
	return body;
}

/**
 * Notice panel: drop the frame rows, the panel's padding column and the row that spells out the
 * panel's keys.
 */
function normalizeNoticeSelectionLine(line: string): string | undefined {
	const visible = line.trimEnd();
	if (isBoxBorderLine(visible)) return undefined;
	const unframed = stripVerticalBorders(visible);
	const body = unframed.framed ? dropPaddingColumn(unframed.text) : unframed.text.trimEnd();
	if (/\bc\/y copy\b/i.test(body) || /\bEsc(?:\/q)? close\b/i.test(body)) return undefined;
	return body;
}

/** Whether a row is nothing but a frame edge. */
function isBoxBorderLine(line: string): boolean {
	const trimmed = line.trim();
	if (!trimmed) return false;
	// A horizontal rule, or a row that opens and closes with corner glyphs.
	if (/^[─━═]{3,}$/.test(trimmed)) return true;
	return /^[┌└╭╰╔╚╒╘╓╙].*[┐┘╮╯╗╝╕╛╖╜]$/.test(trimmed) && /[─━═]/.test(trimmed);
}

/** Whether the row carries a left, right, or both border columns, and return it without them. */
function stripVerticalBorders(line: string): { text: string; framed: boolean } {
	if (/^[│┃║].*[│┃║]$/.test(line)) return { text: line.slice(1, -1), framed: true };
	if (/^[│┃║]/.test(line)) return { text: line.slice(1), framed: true };
	if (/[│┃║]$/.test(line)) return { text: line.slice(0, -1), framed: true };
	return { text: line, framed: false };
}

/** A framed surface puts one column of padding in front of its body, and it is not text. */
function dropPaddingColumn(line: string): string {
	return line.startsWith(" ") ? line.slice(1).trimEnd() : line.trimEnd();
}

/** A row that spells out how to drive a framed surface, not text the user wrote. */
function isFramedInputHintLine(line: string): boolean {
	return /[↑↓←→⏎]/.test(line) && /\b(?:enter|ctrl|shift|tab|scroll|select|accept|cancel)\b/i.test(line);
}
