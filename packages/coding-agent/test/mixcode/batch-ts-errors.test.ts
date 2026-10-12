/**
 * A failing TypeScript batch script keeps its own stack frames, so the report names the file, the
 * failing line, and its callers, without the executor's frames in between.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runTsScript } from "../../src/core/mixcode/batch/batch-ts.ts";

const realAgentDir = process.env.PI_CODING_AGENT_DIR;
const dir = mkdtempSync(join(tmpdir(), "batch-ts-errors-"));

beforeAll(() => {
	// jiti's disk cache lives under the agent dir; keep the test out of the real one.
	process.env.PI_CODING_AGENT_DIR = dir;
});

afterAll(() => {
	if (realAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
	else process.env.PI_CODING_AGENT_DIR = realAgentDir;
	rmSync(dir, { recursive: true, force: true });
});

describe("TypeScript batch script errors", () => {
	it("names the failing line and keeps the script frames", async () => {
		const scriptPath = join(dir, "deep.ts");
		writeFileSync(
			scriptPath,
			[
				"type Api = { render: (template: string, vars: Record<string, unknown>) => string };",
				"function helper(mixcode: Api): string {",
				'\treturn mixcode.render("hi {MODEL}", {});',
				"}",
				"export default function (mixcode: Api): void {",
				"\thelper(mixcode);",
				"}",
				"",
			].join("\n"),
		);

		let message: string;
		try {
			await runTsScript(scriptPath, { workdir: dir, tabs: [] });
			throw new Error("Expected the batch script to fail");
		} catch (error) {
			message = error instanceof Error ? error.message : String(error);
		}

		expect(message).toContain(`Batch script error in ${scriptPath}: Missing template variable: MODEL`);
		expect(message).toMatch(new RegExp(`at helper \\(${scriptPath}:3:\\d+\\)`));
		expect(message).toMatch(new RegExp(`at _default \\(${scriptPath}:6:\\d+\\)`));
		// the executor's own frames are the harness, not the script's failure
		expect(message).not.toContain("batch-ts.ts");
	});
});
