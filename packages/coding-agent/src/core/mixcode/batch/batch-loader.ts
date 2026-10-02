/**
 * Batch script loader. Dispatches on file extension and returns the collected plan.
 */
import { readFile } from "node:fs/promises";
import * as path from "node:path";
import { runLuaScript } from "./batch-lua.ts";
import type { BatchContext, BatchPlan } from "./types.ts";

/** Script extensions loaded through the TypeScript/JavaScript executor. */
const TS_SCRIPT_EXTENSIONS = new Set([".ts", ".mts", ".js", ".mjs"]);

/**
 * Load a batch script by extension: `.lua` runs under fengari, `.ts` / `.mts` / `.js` /
 * `.mjs` load as modules. Throws with the script path in the message on a missing
 * file, a syntax or runtime error, an unsupported extension, or malformed options.
 */
export async function loadBatchRequests(scriptPath: string, context?: BatchContext): Promise<BatchPlan> {
	const absPath = path.resolve(scriptPath);
	const extension = path.extname(absPath).toLowerCase();
	if (extension === ".lua") {
		let source: string;
		try {
			source = await readFile(absPath, "utf8");
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") {
				throw new Error(`Batch script not found: ${absPath}`, { cause: error });
			}
			throw error;
		}
		return runLuaScript(source, absPath, context);
	}
	if (TS_SCRIPT_EXTENSIONS.has(extension)) {
		// Loaded on demand: the TypeScript executor costs ~45 ms to evaluate, which every
		// startup would otherwise pay, including runs that never load a batch script.
		const { runTsScript } = await import("./batch-ts.ts");
		return runTsScript(absPath, context);
	}
	throw new Error(
		`Unsupported batch script extension '${extension || "(none)"}': ${absPath} ` +
			`(expected .lua, .ts, .mts, .js, or .mjs)`,
	);
}
