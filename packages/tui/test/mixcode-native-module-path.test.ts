import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { getNativeModuleCandidates } from "../src/native-module-path.ts";

test("compiled MixCode finds an extracted native helper without a sidecar", () => {
	const runtimeDir = fs.mkdtempSync(path.join(os.tmpdir(), "mpi-native-asset-"));
	const previousPackageDir = process.env.PI_PACKAGE_DIR;
	const nativePath = path.join("native", "linux", "prebuilds", "linux-x64", "linux-platform-x11.node");
	const helperPath = path.join(runtimeDir, nativePath);
	try {
		fs.mkdirSync(path.dirname(helperPath), { recursive: true });
		fs.writeFileSync(helperPath, "native bytes");
		process.env.PI_PACKAGE_DIR = runtimeDir;
		const candidates = getNativeModuleCandidates(nativePath, {
			moduleUrl: pathToFileURL(path.join(runtimeDir, "compiled", "bundle", "native-platform.js")).href,
			execPath: path.join(runtimeDir, "install", "mpi"),
			resolvePackage: () => {
				throw new Error("no installed TUI package");
			},
		});
		assert.equal(candidates[0], helperPath);
		assert.ok(candidates.some((candidate) => fs.existsSync(candidate)));
	} finally {
		if (previousPackageDir === undefined) delete process.env.PI_PACKAGE_DIR;
		else process.env.PI_PACKAGE_DIR = previousPackageDir;
		fs.rmSync(runtimeDir, { recursive: true, force: true });
	}
});
