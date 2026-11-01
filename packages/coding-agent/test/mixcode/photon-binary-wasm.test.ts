import assert from "node:assert/strict";
import * as fs from "node:fs";
import { createRequire } from "node:module";
import * as os from "node:os";
import * as path from "node:path";
import { it } from "vitest";
import { loadPhoton } from "../../src/utils/photon.ts";

const require = createRequire(import.meta.url);

it("compiled MixCode loads Photon WASM from extracted PI_PACKAGE_DIR", async () => {
	const runtimeDir = fs.mkdtempSync(path.join(os.tmpdir(), "mpi-photon-asset-"));
	const extractedWasm = path.join(runtimeDir, "photon_rs_bg.wasm");
	const installedWasm = require.resolve("@silvia-odwyer/photon-node/photon_rs_bg.wasm");
	fs.copyFileSync(installedWasm, extractedWasm);
	const previousPackageDir = process.env.PI_PACKAGE_DIR;
	const mutableFs = require("node:fs") as { readFileSync: typeof fs.readFileSync };
	const originalRead = mutableFs.readFileSync;
	let forcedMissing = 0;
	process.env.PI_PACKAGE_DIR = runtimeDir;
	mutableFs.readFileSync = ((...args: Parameters<typeof fs.readFileSync>) => {
		const file = args[0];
		if (typeof file === "string" && file.endsWith("photon_rs_bg.wasm") && file !== extractedWasm) {
			forcedMissing++;
			throw Object.assign(new Error("simulated missing package WASM"), { code: "ENOENT" });
		}
		return originalRead(...args);
	}) as typeof fs.readFileSync;
	try {
		const photon = await loadPhoton();
		assert.ok(forcedMissing > 0, "the packaged WASM path must be unavailable");
		assert.equal(typeof photon?.PhotonImage.new_from_byteslice, "function");
	} finally {
		mutableFs.readFileSync = originalRead;
		if (previousPackageDir === undefined) delete process.env.PI_PACKAGE_DIR;
		else process.env.PI_PACKAGE_DIR = previousPackageDir;
		fs.rmSync(runtimeDir, { recursive: true, force: true });
	}
});
