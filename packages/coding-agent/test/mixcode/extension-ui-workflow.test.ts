import { type Component, Text } from "@earendil-works/pi-tui";
import { describe, expect, test } from "vitest";
import type { AutocompleteProviderFactory } from "../../src/core/extensions/index.ts";
import { ExtensionUiController } from "../../src/modes/interactive/mixcode/extensions/extension-ui-controller.ts";
import { createExtensionUiHost, type ExtensionUiTestHost } from "./helpers/extension-ui-host.ts";

/** Paint a real TUI widget and record exactly when its owner releases it. */
function trackedWidget(label: string, disposed: string[]): Component & { dispose(): void } {
	const text = new Text(label, 0, 0);
	return {
		render: (width) => text.render(width),
		invalidate: () => text.invalidate(),
		dispose: () => disposed.push(label),
	};
}

/** Offer two distinguishable completions while keeping the base provider's editing semantics. */
function completionFactory(owner: string, requested: string[]): AutocompleteProviderFactory {
	return (base) => ({
		triggerCharacters: ["#"],
		getSuggestions: async (lines, cursorLine, cursorCol, options) => {
			const prefix = lines[cursorLine].slice(0, cursorCol);
			if (!prefix.startsWith("#")) return base.getSuggestions(lines, cursorLine, cursorCol, options);
			requested.push(owner);
			return {
				prefix,
				items: [
					{ value: `#${owner}-first`, label: `${owner} first choice` },
					{ value: `#${owner}-second`, label: `${owner} second choice` },
				],
			};
		},
		applyCompletion: base.applyCompletion.bind(base),
	});
}

/** Select the second suggestion through terminal keys and check the popup and the edited draft. */
async function completeFromTerminal(host: ExtensionUiTestHost, owner: string): Promise<void> {
	host.editor.setText("");
	host.terminal.sendInput("#");
	host.terminal.sendInput("\t");
	const menu = await host.capture();
	expect(menu).toContain(`${owner} first choice`);
	expect(menu).toContain(`${owner} second choice`);
	host.terminal.sendInput("\x1b[B");
	host.terminal.sendInput("\t");
	const completed = await host.capture();
	expect(host.editor.getText().trim()).toBe(`#${owner}-second`);
	expect(completed).toContain(`#${owner}-second`);
}

describe("extension UI controller workflows", () => {
	test("A-B-A restores owned chrome, completions and input while background updates wait for their tab", async () => {
		const host = await createExtensionUiHost();
		const controller = new ExtensionUiController(host);
		host.bindController(controller);
		const disposed: string[] = [];
		const requested: string[] = [];
		const receivedA: string[] = [];
		const receivedB: string[] = [];
		try {
			host.switchTab("tab-a");
			const contextA = controller.createExtensionUIContext("tab-a");
			const scope = host.createTabScope();
			const backgroundA = ExtensionUiController.createTabScopedExtensionUIContext(scope, "tab-a");
			contextA.setWidget("shared", () => trackedWidget("WIDGET-A-INITIAL", disposed));
			contextA.setWidget("tail", ["A-TAIL"], { placement: "belowEditor" });
			contextA.setStatus("shared", "STATUS-A-INITIAL");
			contextA.setStatus("retired", "STATUS-A-RETIRED");
			contextA.addAutocompleteProvider(completionFactory("alpha", requested));
			contextA.onTerminalInput((data) => {
				if (!data.startsWith("!")) return undefined;
				receivedA.push(data);
				return { consume: true };
			});
			expect(await host.capture()).toContain("WIDGET-A-INITIAL");
			await completeFromTerminal(host, "alpha");
			host.terminal.sendInput("!a-initial");

			host.switchTab("tab-b");
			const contextB = controller.createExtensionUIContext("tab-b");
			contextB.setWidget("shared", () => trackedWidget("WIDGET-B", disposed));
			contextB.setWidget("tail", ["B-TAIL"], { placement: "belowEditor" });
			contextB.setStatus("shared", "STATUS-B");
			contextB.addAutocompleteProvider(completionFactory("beta", requested));
			contextB.onTerminalInput((data) => {
				if (!data.startsWith("!")) return undefined;
				receivedB.push(data);
				return { consume: true };
			});
			await completeFromTerminal(host, "beta");
			host.terminal.sendInput("!b");
			expect(receivedA).toEqual(["!a-initial"]);
			expect(receivedB).toEqual(["!b"]);
			expect(disposed).toEqual([]);

			// A late extension bind replaces A's widget placement while B owns the screen and footer.
			backgroundA.setWidget("shared", () => trackedWidget("WIDGET-A-BACKGROUND", disposed), {
				placement: "belowEditor",
			});
			backgroundA.setStatus("shared", "STATUS-A-BACKGROUND");
			backgroundA.setStatus("retired", undefined);
			backgroundA.addAutocompleteProvider(completionFactory("alpha-updated", requested));
			backgroundA.onTerminalInput((data) => {
				if (!data.startsWith("?")) return undefined;
				receivedA.push(`late:${data}`);
				return { consume: true };
			});
			host.terminal.sendInput("?b-falls-through");
			expect(host.editor.getText()).toContain("?b-falls-through");
			expect(receivedA).toEqual(["!a-initial"]);
			const tabB = await host.capture();
			expect(tabB).toContain("WIDGET-B");
			expect(tabB).toContain("B-TAIL");
			expect(tabB).toContain("STATUS-B");
			expect(tabB).not.toContain("WIDGET-A");
			expect(tabB).not.toContain("STATUS-A");
			expect(disposed).toEqual(["WIDGET-A-INITIAL"]);
			await completeFromTerminal(host, "beta");

			host.switchTab("tab-a");
			const restoredA = await host.capture();
			expect(restoredA).toContain("WIDGET-A-BACKGROUND");
			expect(restoredA).toContain("A-TAIL");
			expect(restoredA).toContain("STATUS-A-BACKGROUND");
			expect(restoredA).not.toContain("RETIRED");
			expect(restoredA).not.toContain("WIDGET-B");
			expect(restoredA).not.toContain("STATUS-B");
			expect(restoredA.indexOf("WIDGET-A-BACKGROUND")).toBeGreaterThan(restoredA.indexOf("#beta-second"));
			await completeFromTerminal(host, "alpha-updated");
			controller.rebindExtensionTerminalInputListeners();
			controller.rebindExtensionTerminalInputListeners();
			host.terminal.sendInput("!a-restored");
			host.terminal.sendInput("?a-now-mounted");
			expect(receivedA).toEqual(["!a-initial", "!a-restored", "late:?a-now-mounted"]);
			expect(receivedB).toEqual(["!b"]);
			expect(host.editor.getText()).not.toContain("!");
			expect(host.editor.getText()).not.toContain("?");
			expect(new Set(requested)).toEqual(new Set(["alpha", "beta", "alpha-updated"]));
		} finally {
			host.dispose();
		}
	});

	test("resetting mounted A and disposing parked B releases only their widgets, dialogs and terminal hooks", async () => {
		const host = await createExtensionUiHost();
		const controller = new ExtensionUiController(host);
		host.bindController(controller);
		const disposed: string[] = [];
		const received: string[] = [];
		const requested: string[] = [];
		const pendingInput = new AbortController();
		try {
			host.switchTab("tab-a");
			const contextA = controller.createExtensionUIContext("tab-a");
			contextA.setWidget("shared", () => trackedWidget("RESET-A", disposed));
			contextA.setStatus("shared", "RESET-STATUS-A");
			contextA.addAutocompleteProvider(completionFactory("reset-a", requested));
			contextA.onTerminalInput((data) => {
				if (data !== "!") return undefined;
				received.push("a");
				return { consume: true };
			});
			host.terminal.sendInput("!");

			host.switchTab("tab-b");
			const contextB = controller.createExtensionUIContext("tab-b");
			contextB.setWidget("shared", () => trackedWidget("KEEP-B", disposed));
			contextB.setWidget("tail", () => trackedWidget("KEEP-B-TAIL", disposed), { placement: "belowEditor" });
			contextB.setStatus("shared", "KEEP-STATUS-B");
			contextB.addAutocompleteProvider(completionFactory("keep-b", requested));
			contextB.onTerminalInput((data) => {
				if (data !== "!") return undefined;
				received.push("b");
				return { consume: true };
			});
			host.terminal.sendInput("!");
			const answer = contextB.input("B owns this question", "Answer", { signal: pendingInput.signal });
			host.terminal.sendInput("partial");
			expect(await host.capture()).toContain("partial");

			host.switchTab("tab-a");
			controller.resetExtensionUI("tab-a");
			host.editor.setText("");
			host.terminal.sendInput("!");
			const resetA = await host.capture();
			expect(resetA).toContain("!");
			expect(resetA).not.toContain("RESET-A");
			expect(resetA).not.toContain("RESET-STATUS-A");
			expect(resetA).not.toContain("B owns this question");
			expect(received).toEqual(["a", "b"]);
			expect(disposed).toEqual(["RESET-A"]);

			host.switchTab("tab-b");
			const survivingB = await host.capture();
			expect(survivingB).toContain("KEEP-B");
			expect(survivingB).toContain("KEEP-B-TAIL");
			expect(survivingB).toContain("KEEP-STATUS-B");
			expect(survivingB).toContain("B owns this question");
			expect(survivingB).toContain("partial");
			host.terminal.sendInput("-answer");
			host.terminal.sendInput("\r");
			expect(await answer).toBe("partial-answer");
			await completeFromTerminal(host, "keep-b");
			host.terminal.sendInput("!");
			expect(received).toEqual(["a", "b", "b"]);

			host.switchTab("tab-a");
			controller.disposeTabUi("tab-b");
			controller.disposeTabUi("tab-b");
			expect(disposed).toEqual(["RESET-A", "KEEP-B", "KEEP-B-TAIL"]);
			host.switchTab("tab-b");
			host.editor.setText("");
			host.terminal.sendInput("!");
			const reopenedB = await host.capture();
			expect(reopenedB).toContain("!");
			expect(reopenedB).not.toContain("KEEP-B");
			expect(reopenedB).not.toContain("KEEP-STATUS-B");
			expect(reopenedB).not.toContain("B owns this question");
			expect(received).toEqual(["a", "b", "b"]);
			host.editor.setText("");
			host.terminal.sendInput("#");
			host.terminal.sendInput("\t");
			expect(await host.capture()).not.toContain("keep-b second choice");
			expect(requested).toEqual(["keep-b"]);
		} finally {
			pendingInput.abort();
			host.dispose();
		}
	});

	test("a reload reset keeps a tab-scoped completion registration wired on the mounted tab", async () => {
		const host = await createExtensionUiHost();
		const controller = new ExtensionUiController(host);
		host.bindController(controller);
		const requested: string[] = [];
		try {
			const scope = host.createTabScope();
			// A restored tab binds its extensions before it takes focus, so its completion wrapper
			// reaches the provider through the mount that follows.
			const tabContext = ExtensionUiController.createTabScopedExtensionUIContext(scope, "tab-a");
			tabContext.addAutocompleteProvider(completionFactory("before-reload", requested));
			host.switchTab("tab-a");
			await completeFromTerminal(host, "before-reload");

			// The reset drops the tab's extensions, and the reloaded one registers through the same
			// context while the tab stays mounted.
			controller.resetExtensionUI("tab-a");
			host.setupAutocompleteProvider();
			host.editor.setText("");
			host.terminal.sendInput("#");
			host.terminal.sendInput("\t");
			expect(await host.capture()).not.toContain("before-reload first choice");

			tabContext.addAutocompleteProvider(completionFactory("after-reload", requested));
			host.setupAutocompleteProvider();
			await completeFromTerminal(host, "after-reload");

			expect(requested).toEqual(["before-reload", "after-reload"]);
		} finally {
			host.dispose();
		}
	});
});
