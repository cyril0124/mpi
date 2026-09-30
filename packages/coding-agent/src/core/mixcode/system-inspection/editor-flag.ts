/**
 * The `--editor` flag accepted by the read-only inspection commands.
 *
 * It lets a command name the editor that opens its report, and lets
 * `--editor=false` reach the in-app block when no editor should take over.
 */

/** Editor request parsed from an inspection command's arguments. */
export interface EditorFlagRequest {
	/** Explicit editor command; empty means "resolve the configured one". */
	editor?: string;
	/** True when the command asked to skip the editor and render in-app. */
	editorDisabled: boolean;
}

/**
 * Parse `--editor[=<cmd>]` arguments.
 *
 * `--editor` alone forces the configured editor, `--editor=<cmd>` runs that
 * command, and `--editor=false` renders the report in-app. Every other argument
 * is ignored, so an inspection command never fails on stray words.
 */
export function parseEditorFlag(args: string): EditorFlagRequest {
	let editor: string | undefined;
	let editorDisabled = false;
	for (const part of args.trim().split(/\s+/).filter(Boolean)) {
		if (part === "--editor") {
			editor = "";
			editorDisabled = false;
		} else if (part.startsWith("--editor=")) {
			const value = part.slice("--editor=".length);
			editorDisabled = value === "false";
			editor = editorDisabled ? undefined : value;
		}
	}
	return { editor, editorDisabled };
}
