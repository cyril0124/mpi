import { describe, expect, test } from "vitest";
import { ExtensionUiController } from "../../src/modes/interactive/mixcode/extensions/extension-ui-controller.ts";
import { createExtensionUiHost } from "./helpers/extension-ui-host.ts";

/** A notice reaches the transcript of the tab that owns it, whenever that tab becomes visible. */
describe("tab-scoped extension UI context", () => {
	test("shows a notice at once for the tab that owns the mounted transcript", async () => {
		const host = await createExtensionUiHost();
		const controller = new ExtensionUiController(host);
		host.bindController(controller);
		try {
			host.switchTab("tab-2");
			const context = ExtensionUiController.createTabScopedExtensionUIContext(host.createTabScope(), "tab-2");
			context.notify("TPS 100.0 tok/s", "info");
			expect(host.shown).toEqual([{ tabId: "tab-2", message: "TPS 100.0 tok/s", type: "info" }]);
			expect(controller.tabExtensionUi("tab-2").notices).toEqual([]);
			expect(await host.capture()).toContain("TPS 100.0 tok/s");

			host.switchTab("tab-1");
			expect(await host.capture()).not.toContain("TPS 100.0 tok/s");
			host.switchTab("tab-2");
			expect(await host.capture()).toContain("TPS 100.0 tok/s");
			expect(host.shown).toHaveLength(1);
		} finally {
			host.dispose();
		}
	});

	test("records a notice for a tab that is not on screen", async () => {
		const host = await createExtensionUiHost();
		const controller = new ExtensionUiController(host);
		host.bindController(controller);
		try {
			host.switchTab("tab-1");
			const context = ExtensionUiController.createTabScopedExtensionUIContext(host.createTabScope(), "tab-2");
			context.notify("TPS 100.0 tok/s", "info");
			expect(host.shown).toEqual([]);
			expect(controller.tabExtensionUi("tab-2").notices).toEqual([{ message: "TPS 100.0 tok/s", type: "info" }]);
			context.notify("Slow tool", "warning");
			context.notify("Retry failed", "error");
			expect(await host.capture()).not.toContain("TPS 100.0 tok/s");

			host.switchTab("tab-2");
			const replay = await host.capture();
			expect(replay).toContain("info: TPS 100.0 tok/s");
			expect(replay).toContain("warning: Slow tool");
			expect(replay).toContain("error: Retry failed");
			expect(replay.indexOf("TPS 100.0 tok/s")).toBeLessThan(replay.indexOf("Slow tool"));
			expect(replay.indexOf("Slow tool")).toBeLessThan(replay.indexOf("Retry failed"));
			expect(host.shown).toEqual([
				{ tabId: "tab-2", message: "TPS 100.0 tok/s", type: "info" },
				{ tabId: "tab-2", message: "Slow tool", type: "warning" },
				{ tabId: "tab-2", message: "Retry failed", type: "error" },
			]);
			expect(controller.tabExtensionUi("tab-2").notices).toEqual([]);
			host.switchTab("tab-1");
			expect(await host.capture()).not.toContain("Slow tool");
			host.switchTab("tab-2");
			context.notify("Turn complete");
			expect(await host.capture()).toContain("info: Turn complete");
			expect(host.shown).toHaveLength(4);
		} finally {
			host.dispose();
		}
	});

	test("records a notice while Home covers the tab", async () => {
		const host = await createExtensionUiHost();
		const controller = new ExtensionUiController(host);
		host.bindController(controller);
		try {
			host.switchTab("tab-2");
			const context = ExtensionUiController.createTabScopedExtensionUIContext(host.createTabScope(), "tab-2");
			host.homeActive = true;
			context.notify("TPS 100.0 tok/s", "info");
			expect(host.shown).toEqual([]);
			expect(controller.tabExtensionUi("tab-2").notices).toEqual([{ message: "TPS 100.0 tok/s", type: "info" }]);
			const home = await host.capture();
			expect(home).toContain("HOME");
			expect(home).not.toContain("TPS 100.0 tok/s");

			host.switchTab("tab-1");
			expect(await host.capture()).not.toContain("TPS 100.0 tok/s");
			expect(host.shown).toEqual([]);
			host.switchTab("tab-2");
			expect(await host.capture()).toContain("TPS 100.0 tok/s");
			expect(controller.tabExtensionUi("tab-2").notices).toEqual([]);
			host.switchTab("tab-1");
			host.switchTab("tab-2");
			expect(host.shown).toEqual([{ tabId: "tab-2", message: "TPS 100.0 tok/s", type: "info" }]);
		} finally {
			host.dispose();
		}
	});
});
