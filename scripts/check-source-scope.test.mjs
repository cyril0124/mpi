import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const scriptsDirectory = dirname(fileURLToPath(import.meta.url));

for (const [checker, filename, invalidContent, diagnostic] of [
	["check-pinned-deps.mjs", "package.json", JSON.stringify({ dependencies: { example: "^1.0.0" } }), "must be pinned"],
	["check-ts-relative-imports.mjs", "source.ts", 'import "./dependency.js";\n', "Relative .js imports"],
]) {
	test(`${checker} ignores scratch checkouts but rejects invalid workspace files`, () => {
		const directory = mkdtempSync(join(tmpdir(), "pi-check-scope-"));
		try {
			for (const root of ["tmp", ".worktrees", ".sync-feature"]) {
				const fixtureDirectory = join(directory, root, "checkout", "packages", "fixture");
				mkdirSync(fixtureDirectory, { recursive: true });
				writeFileSync(join(fixtureDirectory, filename), invalidContent);
			}

			const run = () => spawnSync(process.execPath, [join(scriptsDirectory, checker)], { cwd: directory, encoding: "utf8" });
			const ignored = run();
			assert.equal(ignored.status, 0, ignored.stderr);

			const sourceDirectory = join(directory, "packages", "fixture");
			mkdirSync(sourceDirectory, { recursive: true });
			writeFileSync(join(sourceDirectory, filename), invalidContent);
			const rejected = run();
			assert.equal(rejected.status, 1, rejected.stderr);
			assert.match(rejected.stderr, new RegExp(diagnostic));
			assert.match(rejected.stderr, /packages[/\\]fixture/);
		} finally {
			rmSync(directory, { recursive: true, force: true });
		}
	});
}
