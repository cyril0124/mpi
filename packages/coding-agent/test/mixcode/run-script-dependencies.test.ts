import { spawnSync } from "node:child_process";
import {
	chmodSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	utimesSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { expect, it } from "vitest";

it.skipIf(process.platform === "win32")(
	"reuses complete installs without shx and repairs missing required probes once",
	() => {
		const root = mkdtempSync(join(tmpdir(), "pi-launcher-dependencies-"));
		try {
			writeFileSync(join(root, "package.json"), JSON.stringify({ type: "commonjs" }));
			const workspace = join(root, "workspace");
			const caller = join(root, "caller with spaces");
			const bin = join(root, "bin");
			const records = join(root, "calls.jsonl");
			const script = join(workspace, "run.sh");
			const entry = join(workspace, "packages/coding-agent/dist/bun/cli.js");
			const marker = join(workspace, "packages/coding-agent/dist/bundle/cli.js");
			const compiler = join(workspace, "node_modules/.bin/tsc");
			const declarations = join(workspace, "node_modules/typebox/build/index.d.mts");
			const probes = [
				{ path: compiler, content: "#!/bin/sh\nexit 0\n", mode: 0o755 },
				{ path: join(workspace, "node_modules/typebox/build/index.mjs"), content: "export {};\n", mode: 0o644 },
				{ path: declarations, content: "export {};\n", mode: 0o644 },
			];
			for (const directory of [
				workspace,
				caller,
				bin,
				join(workspace, "scripts"),
				dirname(entry),
				dirname(marker),
			]) {
				mkdirSync(directory, { recursive: true });
			}
			writeFileSync(script, readFileSync(new URL("../../../../run.sh", import.meta.url)));
			writeFileSync(
				join(workspace, "package.json"),
				readFileSync(new URL("../../../../package.json", import.meta.url)),
			);
			writeFileSync(entry, "export {};\n");
			writeFileSync(marker, "export {};\n");
			utimesSync(script, new Date(0), new Date(0));
			utimesSync(join(workspace, "package.json"), new Date(0), new Date(0));
			utimesSync(marker, new Date(1000), new Date(1000));
			for (const probe of probes) {
				mkdirSync(dirname(probe.path), { recursive: true });
				writeFileSync(probe.path, probe.content);
				chmodSync(probe.path, probe.mode);
			}
			const bun = join(bin, "bun");
			writeFileSync(
				bun,
				String.raw`#!/usr/bin/env node
const fs = require("node:fs");
const probes = ${JSON.stringify(probes)};
const args = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(records)}, JSON.stringify({ args, cwd: process.cwd() }) + "\n");
if (args[0] === "install") {
  for (const probe of probes) { fs.writeFileSync(probe.path, probe.content); fs.chmodSync(probe.path, probe.mode); }
}
			`,
			);
			chmodSync(bun, 0o755);
			const args = ["--model", "test/model", "argument with spaces"];
			for (const missing of [undefined, undefined, compiler, undefined, declarations, undefined]) {
				if (missing) rmSync(missing);
				const result = spawnSync("bash", [script, ...args], {
					cwd: caller,
					encoding: "utf8",
					timeout: 10_000,
					env: {
						...process.env,
						PATH: `${bin}:${process.env.PATH ?? ""}`,
						PI_DEV: "0",
						SKIP_MODEL_HYDRATE: "1",
						NODE_OPTIONS: "",
						BASH_ENV: "",
					},
				});
				expect(result.error).toBeUndefined();
				expect(result.status, result.stderr).toBe(0);
			}
			const calls = readFileSync(records, "utf8")
				.trim()
				.split("\n")
				.map((line) => JSON.parse(line) as { args: string[]; cwd: string });
			const launch = { args: [entry, ...args], cwd: caller };
			const install = { args: ["install", "--force", "--ignore-scripts", "--no-save"], cwd: workspace };
			expect(calls).toEqual([launch, launch, install, launch, launch, install, launch, launch]);
			expect(existsSync(join(workspace, "node_modules/.bin/shx"))).toBe(false);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	},
);
