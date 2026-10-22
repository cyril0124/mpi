import { describe, expect, test, vi } from "vitest";
import { ExtensionUiController } from "../../src/modes/interactive/mixcode/extensions/extension-ui-controller.ts";
import { createExtensionUiHost } from "./helpers/extension-ui-host.ts";

describe("concurrent extension dialogs across tabs", () => {
	// Regression for #11166: concurrent dialogs must remain answerable after another closes.
	test("aborting a parked middle dialog preserves the active tab and restores the newest remaining dialog", async () => {
		const host = await createExtensionUiHost();
		const blocked = vi.fn();
		const controller = new ExtensionUiController(Object.assign(host, { setDialogBlocked: blocked }));
		host.bindController(controller);
		try {
			host.switchTab("tab-a");
			const abortMiddle = new AbortController();
			const first = controller.showExtensionConfirm("FIRST-A", "first", undefined, "tab-a");
			const middle = controller.showExtensionConfirm("MIDDLE-A", "middle", { signal: abortMiddle.signal }, "tab-a");
			const newest = controller.showExtensionConfirm("NEWEST-A", "newest", undefined, "tab-a");
			expect(await host.capture()).toContain("NEWEST-A");

			host.switchTab("tab-b");
			const other = controller.showExtensionConfirm("ONLY-B", "other tab", undefined, "tab-b");
			abortMiddle.abort();
			await expect(middle).resolves.toBe(false);
			const tabB = await host.capture();
			expect(tabB).toContain("ONLY-B");
			expect(tabB).not.toContain("NEWEST-A");
			expect(controller.tabInteractions.get("tab-a")).toHaveLength(2);
			expect(blocked).toHaveBeenLastCalledWith({ kind: "permission", message: "ONLY-B" });

			host.switchTab("tab-a");
			expect(await host.capture()).toContain("NEWEST-A");
			host.terminal.sendInput("\r");
			await expect(newest).resolves.toBe(true);
			expect(await host.capture()).toContain("FIRST-A");
			expect(blocked).toHaveBeenLastCalledWith({ kind: "permission", message: "FIRST-A" });
			host.terminal.sendInput("\x1b");
			await expect(first).resolves.toBe(false);
			expect(controller.tabWaitingForInput("tab-a")).toBe(false);
			expect(controller.tabWaitingForInput("tab-b")).toBe(true);

			host.switchTab("tab-b");
			expect(await host.capture()).toContain("ONLY-B");
			host.terminal.sendInput("\r");
			await expect(other).resolves.toBe(true);
			expect(controller.tabInteractions.size).toBe(0);
			expect(blocked).toHaveBeenLastCalledWith(undefined);
		} finally {
			host.dispose();
		}
	});
});
