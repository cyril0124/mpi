import { Editor, Text } from "@earendil-works/pi-tui";
import { describe, expect, test, vi } from "vitest";
import { ExtensionUiController } from "../../src/modes/interactive/mixcode/extensions/extension-ui-controller.ts";
import { type BlockedStatus, ProgramStatusReporter } from "../../src/modes/interactive/program-status-reporter.ts";
import { getEditorTheme } from "../../src/modes/interactive/theme/theme.ts";
import { createExtensionUiHost } from "./helpers/extension-ui-host.ts";

describe("concurrent extension dialogs across tabs", () => {
	test("reports the owning dialog's blocked kind and first title line as tabs and dialogs change", async () => {
		const host = await createExtensionUiHost();
		const reported = vi.spyOn(host.terminal, "setProgramStatus");
		const reporter = new ProgramStatusReporter(
			() => host.terminal,
			() => undefined,
		);
		const controller = new ExtensionUiController(
			Object.assign(host, {
				setDialogBlocked: (status: BlockedStatus | undefined) => reporter.setBlocked("extension-dialog", status),
			}),
		);
		host.bindController(controller);
		const expectBlocked = (kind: BlockedStatus["kind"], message: string) => {
			expect(reported).toHaveBeenLastCalledWith(expect.objectContaining({ state: "blocked", kind, message }));
		};
		try {
			host.switchTab("tab-a");
			const contextA = controller.createExtensionUIContext("tab-a");
			const contextB = ExtensionUiController.createTabScopedExtensionUIContext(host.createTabScope(), "tab-b");
			const editor = contextA.editor("Review note\nA-editor-details", "Draft note");
			expectBlocked("question", "Review note");
			const select = contextA.select("Choose account\r\nA-select-details", ["Work", "Personal"], {
				blockedKind: "auth",
			});
			expectBlocked("auth", "Choose account");
			const input = contextB.input("Enter identifier\nB-input-details", undefined, { blockedKind: "permission" });
			expectBlocked("auth", "Choose account");
			const tabA = await host.capture();
			expect(tabA).toContain("A-select-details");
			expect(tabA).not.toContain("B-input-details");

			host.switchTab("tab-b");
			expectBlocked("permission", "Enter identifier");
			expect(await host.capture()).toContain("B-input-details");
			const confirm = contextB.confirm("Keep identifier?\nB-confirm-details", "It will be saved.", {
				blockedKind: "auth",
			});
			expectBlocked("auth", "Keep identifier?");
			host.terminal.sendInput("n");
			await expect(confirm).resolves.toBe(false);
			expectBlocked("permission", "Enter identifier");
			host.terminal.sendInput("user-47");
			host.terminal.sendInput("\r");
			await expect(input).resolves.toBe("user-47");
			expectBlocked("auth", "Choose account");

			host.switchTab("tab-a");
			host.terminal.sendInput("j");
			host.terminal.sendInput("\r");
			await expect(select).resolves.toBe("Personal");
			expectBlocked("question", "Review note");
			expect(await host.capture()).toContain("Draft note");
			host.terminal.sendInput("\x1b");
			await expect(editor).resolves.toBeUndefined();
			expect(reported).toHaveBeenLastCalledWith(expect.objectContaining({ state: "idle" }));
		} finally {
			host.dispose();
		}
	});

	test("extension composer updates repaint the owning tab without crossing tab switches", async () => {
		const host = await createExtensionUiHost();
		const controller = new ExtensionUiController(host);
		host.bindController(controller);
		try {
			host.switchTab("tab-a");
			let ownerA: string | undefined = "tab-a";
			const contextA = controller.createExtensionUIContext(() => ownerA);
			const contextB = ExtensionUiController.createTabScopedExtensionUIContext(host.createTabScope(), "tab-b");
			await host.capture();
			contextA.setEditorText("Draft in A");
			await host.terminal.waitForRender();
			expect(host.terminal.getViewport().join("\n")).toContain("Draft in A");
			contextA.pasteToEditor("\r\nPasted line in A");
			await host.terminal.waitForRender();
			expect(host.terminal.getViewport().join("\n")).toContain("Pasted line in A");

			host.switchTab("tab-b");
			contextB.setEditorText("Draft in B");
			await host.capture();
			contextA.setEditorText("Replacement from parked A");
			contextA.pasteToEditor("Paste from parked A");
			expect(contextA.getEditorText()).toBe("");
			ownerA = undefined;
			contextA.setEditorText("Replacement from closed A");
			contextB.pasteToEditor("\r\nPasted line in B");
			await host.terminal.waitForRender();
			const tabB = host.terminal.getViewport().join("\n");
			expect(tabB).toContain("Draft in B");
			expect(tabB).toContain("Pasted line in B");
			expect(tabB).not.toContain("from parked A");
			expect(tabB).not.toContain("from closed A");
		} finally {
			host.dispose();
		}
	});
	// Regressions for #11428 and #11431: blocked dialogs retain their tab, slot and focus across editor swaps.
	test("preserves auth dialogs, overlays and drafts across editor replacements and tab switches", async () => {
		const host = await createExtensionUiHost();
		const blocked = vi.fn();
		const controller = new ExtensionUiController(Object.assign(host, { setDialogBlocked: blocked }));
		host.bindController(controller);
		try {
			host.switchTab("tab-a");
			host.editor.setText("DRAFT-A");
			const contextA = controller.createExtensionUIContext("tab-a");
			let finishAuth: ((result: string) => void) | undefined;
			const auth = contextA.custom<string>(
				(_ui, _theme, _keys, done) => {
					finishAuth = done;
					return new Text("AUTH-A");
				},
				{ blocked: { kind: "auth", message: "Sign in on A" } },
			);
			expect(await host.capture()).toContain("AUTH-A");
			expect(blocked).toHaveBeenLastCalledWith({ kind: "auth", message: "Sign in on A" });

			const replacement = new Editor(host.ui, getEditorTheme());
			controller.setCustomEditorComponent(() => replacement);
			expect(await host.capture()).toContain("AUTH-A");
			expect(host.editor).toBe(replacement);
			expect(host.editor.getText()).toBe("DRAFT-A");

			let finishOverlay: ((result: string) => void) | undefined;
			const overlayComponent = new Text("AUTH-OVERLAY-A");
			const overlay = contextA.custom<string>(
				(_ui, _theme, _keys, done) => {
					finishOverlay = done;
					return overlayComponent;
				},
				{ overlay: true, blocked: { kind: "auth", message: "Finish signing in" } },
			);
			expect(blocked).toHaveBeenLastCalledWith({ kind: "auth", message: "Finish signing in" });
			expect(await host.capture()).toContain("AUTH-OVERLAY-A");
			controller.setCustomEditorComponent(undefined);
			expect(host.ui.getFocusedComponent()).toBe(overlayComponent);
			expect(await host.capture()).toContain("AUTH-OVERLAY-A");

			host.switchTab("tab-b");
			host.editor.setText("DRAFT-B");
			const permission = controller.showExtensionConfirm("PERMISSION-B", "Allow?", undefined, "tab-b");
			const tabB = await host.capture();
			expect(tabB).toContain("PERMISSION-B");
			expect(tabB).not.toContain("AUTH-A");
			expect(tabB).not.toContain("AUTH-OVERLAY-A");
			expect(blocked).toHaveBeenLastCalledWith({ kind: "permission", message: "PERMISSION-B" });

			host.switchTab("tab-a");
			expect(await host.capture()).toContain("AUTH-OVERLAY-A");
			expect(host.ui.getFocusedComponent()).toBe(overlayComponent);
			expect(blocked).toHaveBeenLastCalledWith({ kind: "auth", message: "Finish signing in" });
			finishOverlay!("signed in");
			await expect(overlay).resolves.toBe("signed in");
			expect(await host.capture()).toContain("AUTH-A");
			expect(blocked).toHaveBeenLastCalledWith({ kind: "auth", message: "Sign in on A" });
			finishAuth!("done");
			await expect(auth).resolves.toBe("done");
			expect(host.editor.getText()).toBe("DRAFT-A");
			expect(host.ui.getFocusedComponent()).toBe(host.editor);
			expect(controller.tabWaitingForInput("tab-a")).toBe(false);
			expect(controller.tabWaitingForInput("tab-b")).toBe(true);

			host.switchTab("tab-b");
			expect(await host.capture()).toContain("PERMISSION-B");
			host.terminal.sendInput("y");
			await expect(permission).resolves.toBe(true);
			expect(controller.tabInteractions.size).toBe(0);
			expect(blocked).toHaveBeenLastCalledWith(undefined);
		} finally {
			host.dispose();
		}
	});

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
