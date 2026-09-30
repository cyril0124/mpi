/**
 * Which editor reads command output such as `/console-history`.
 *
 * The output is meant to be read, not edited, so the text goes to an external
 * editor when one is available and falls back to an in-app view otherwise. Any
 * read-only output surface can use it, so the module and its entry point are
 * named for the capability rather than for `/console-history`, the first caller.
 *
 * Order: the `externalEditor` setting (project scope before global), then
 * `$VISUAL`, then `$EDITOR`, then `nvim`, then `vim`. A candidate has to answer
 * `--version` within a second: a stale path, a wrapper that waits for input, or a
 * command that is not an editor at all is skipped instead of taking over the
 * terminal. A configured editor that fails the probe is not replaced by the
 * nvim/vim fallbacks, so a deliberate setting always wins over chance.
 */
import { spawnSync } from "node:child_process";

const PROBE_TIMEOUT_MS = 1_000;
const FALLBACK_EDITORS = ["nvim", "vim"] as const;

/** Editor to open read-only command output in, or undefined when none answers the probe. */
export function resolveOutputEditor(
	configured: string | undefined,
	probe: (editor: string) => boolean = isEditorAvailable,
): string | undefined {
	const editor = (configured?.trim() || process.env.VISUAL || process.env.EDITOR)?.trim();
	if (editor) return probe(editor) ? editor : undefined;
	return FALLBACK_EDITORS.find(probe);
}

/**
 * Whether `editor --version` exits 0 within a second. The command is split on
 * spaces, the same way `editInExternalEditor` runs it.
 */
export function isEditorAvailable(editor: string): boolean {
	const [command, ...args] = editor.split(" ");
	if (!command) return false;
	const probe = spawnSync(command, [...args, "--version"], { stdio: "ignore", timeout: PROBE_TIMEOUT_MS });
	return probe.status === 0;
}
