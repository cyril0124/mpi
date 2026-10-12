/**
 * A failing Lua batch script names the file and line that failed, plus the call chain, so a failure
 * inside a helper can be traced back to the request that reached it.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runLuaScript } from "../../src/core/mixcode/batch/batch-lua.ts";

const realAgentDir = process.env.PI_CODING_AGENT_DIR;
const dir = mkdtempSync(join(tmpdir(), "batch-lua-errors-"));

beforeAll(() => {
	// jiti's disk cache lives under the agent dir; keep the test out of the real one.
	process.env.PI_CODING_AGENT_DIR = dir;
});

afterAll(() => {
	if (realAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
	else process.env.PI_CODING_AGENT_DIR = realAgentDir;
	rmSync(dir, { recursive: true, force: true });
});

/** Message of the error the script raises; fails when the script unexpectedly succeeds. */
async function thrownMessage(scriptPath: string, source: string): Promise<string> {
	try {
		await runLuaScript(source, scriptPath, { workdir: dir, tabs: [] });
	} catch (error) {
		return error instanceof Error ? error.message : String(error);
	}
	throw new Error("Expected the batch script to fail");
}

describe("Lua batch script errors", () => {
	it("names the failing line and the Lua call chain", async () => {
		const scriptPath = join(dir, "deep.lua");
		const source = [
			"local function helper()",
			'\treturn mixcode.render("hi {MODEL}", {})',
			"end",
			"",
			"local function go()",
			"\tlocal value = helper()",
			"\treturn value",
			"end",
			"",
			"go()",
			"",
		].join("\n");
		const message = await thrownMessage(scriptPath, source);

		expect(message).toContain(`Lua error in ${scriptPath}:2: Missing template variable: MODEL`);
		expect(message).toContain("stack traceback:");
		// the failing line, its caller, and the chunk that ran the script
		expect(message).toMatch(new RegExp(`${scriptPath}:2:`));
		expect(message).toMatch(new RegExp(`${scriptPath}:6:`));
		expect(message).toMatch(new RegExp(`${scriptPath}:10: in main chunk`));
	});

	it("prints a path too long for a Lua chunk id once, next to the line", async () => {
		const scriptPath = join(dir, "a".repeat(70), "nested", "deep.lua");
		const message = await thrownMessage(scriptPath, 'return render("hi {MODEL}", {})');

		expect(message.split("\n")[0]?.startsWith(`Lua error in ${scriptPath}:1: `)).toBe(true);
	});

	it("keeps the module's own path when the failure is inside require", async () => {
		const helperPath = join(dir, "helper.lua");
		writeFileSync(
			helperPath,
			["local M = {}", "function M.go()", '\treturn render("hi {MODEL}", {})', "end", "return M", ""].join("\n"),
		);
		const mainPath = join(dir, "main.lua");
		const message = await thrownMessage(mainPath, 'local helper = require("helper")\nhelper.go()\n');

		expect(message).toContain(`Lua error in ${mainPath}: ${helperPath}:3:`);
		expect(message).toMatch(/helper\.lua:3: in function 'helper\.go'/);
		expect(message).toMatch(/main\.lua:2: in main chunk/);
	});
});
