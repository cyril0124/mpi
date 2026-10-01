import { describe, expect, test } from "vitest";
import type { ExtensionUIContext } from "../../src/core/extensions/types.ts";
import { InteractiveMode } from "../../src/modes/interactive/interactive-mode.ts";

/**
 * The UI context a tab's extensions get while their session binds. Binding is deferred, so
 * the tab can lose focus between the queued bind and the call: the context records chrome on
 * the tab, and the mounted surfaces decide per call.
 *
 * A notice is routed by the transcript it belongs to. Sending every notice into the tab's
 * record left it invisible until the tab was focused again, so a TPS line at the end of a
 * turn never appeared on a tab opened after startup.
 */
const createTabScopedExtensionUIContext = Reflect.get(
	InteractiveMode.prototype,
	"createTabScopedExtensionUIContext",
) as (this: unknown, tabId: string) => ExtensionUIContext;

interface NotifyHost {
	activeTabIdForUi: string | undefined;
	homeSelection: { active: boolean };
	shown: Array<{ message: string; type?: string }>;
	notices: Array<{ message: string; type?: string }>;
}

/** The fields the context reads, plus the two surfaces it can write a notice to. */
function createHost(activeTabIdForUi: string | undefined, homeActive: boolean): NotifyHost {
	return {
		activeTabIdForUi,
		homeSelection: { active: homeActive },
		shown: [],
		notices: [],
	};
}

function buildContext(host: NotifyHost, tabId: string): ExtensionUIContext {
	const scope = {
		...host,
		createExtensionUIContext: () => ({}) as ExtensionUIContext,
		tabExtensionUi: () => ({ notices: host.notices }),
		showExtensionNotify: (message: string, type?: string) => {
			host.shown.push({ message, type });
		},
	};
	return createTabScopedExtensionUIContext.call(scope, tabId);
}

describe("tab-scoped extension UI context", () => {
	test("shows a notice at once for the tab that owns the mounted transcript", () => {
		const host = createHost("tab-2", false);
		buildContext(host, "tab-2").notify("TPS 100.0 tok/s", "info");
		expect(host.shown).toEqual([{ message: "TPS 100.0 tok/s", type: "info" }]);
		expect(host.notices).toEqual([]);
	});

	test("records a notice for a tab that is not on screen", () => {
		const host = createHost("tab-1", false);
		buildContext(host, "tab-2").notify("TPS 100.0 tok/s", "info");
		expect(host.shown).toEqual([]);
		expect(host.notices).toEqual([{ message: "TPS 100.0 tok/s", type: "info" }]);
	});

	test("records a notice while Home covers the tab", () => {
		const host = createHost("tab-2", true);
		buildContext(host, "tab-2").notify("TPS 100.0 tok/s", "info");
		expect(host.shown).toEqual([]);
		expect(host.notices).toEqual([{ message: "TPS 100.0 tok/s", type: "info" }]);
	});
});
