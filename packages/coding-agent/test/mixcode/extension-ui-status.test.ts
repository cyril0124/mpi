import { describe, expect, test } from "vitest";
import type { ExtensionUIContext } from "../../src/core/extensions/types.ts";
import { InteractiveMode } from "../../src/modes/interactive/interactive-mode.ts";

/**
 * The UI context a tab's extensions get while their session binds. Binding is deferred, so
 * the tab can lose focus between the queued bind and the call: the context records chrome on
 * the tab, and the mounted surfaces decide per call.
 *
 * A status is kept twice, in the footer's map and in the tab's record that is copied back into
 * that map on mount.
 */
const createTabScopedExtensionUIContext = Reflect.get(
	InteractiveMode.prototype,
	"createTabScopedExtensionUIContext",
) as (this: unknown, tabId: string) => ExtensionUIContext;

const STATUS_KEY = "demo";
const STATUS_TEXT = "demo: on · total 1";

interface StatusHost {
	activeTabIdForUi: string | undefined;
	homeSelection: { active: boolean };
	/** The footer's own copy: what the footer shows while the tab is mounted. */
	footer: Map<string, string>;
	/** The tab's record, applied to the footer when the tab takes focus. */
	recorded: Map<string, string>;
}

function createHost(activeTabIdForUi: string | undefined): StatusHost {
	return {
		activeTabIdForUi,
		homeSelection: { active: false },
		footer: new Map(),
		recorded: new Map(),
	};
}

function buildContext(host: StatusHost, tabId: string): ExtensionUIContext {
	const scope = {
		...host,
		createExtensionUIContext: () =>
			({
				setStatus: (key: string, text: string | undefined) => {
					if (text === undefined) host.footer.delete(key);
					else host.footer.set(key, text);
				},
			}) as unknown as ExtensionUIContext,
		tabExtensionUi: () => ({ statuses: host.recorded }),
	};
	return createTabScopedExtensionUIContext.call(scope, tabId);
}

describe("tab-scoped extension status", () => {
	test("updates the footer of the tab that owns the mounted chrome", () => {
		const host = createHost("tab-2");
		buildContext(host, "tab-2").setStatus(STATUS_KEY, STATUS_TEXT);
		expect(host.footer.get(STATUS_KEY)).toBe(STATUS_TEXT);
		expect(host.recorded.get(STATUS_KEY)).toBe(STATUS_TEXT);
	});

	test("clears the footer status when the mounted tab clears its own", () => {
		const host = createHost("tab-2");
		host.footer.set(STATUS_KEY, STATUS_TEXT);
		host.recorded.set(STATUS_KEY, STATUS_TEXT);
		buildContext(host, "tab-2").setStatus(STATUS_KEY, undefined);
		expect(host.footer.has(STATUS_KEY)).toBe(false);
		expect(host.recorded.has(STATUS_KEY)).toBe(false);
	});

	test("records the status without touching the footer of another tab", () => {
		const host = createHost("tab-1");
		buildContext(host, "tab-2").setStatus(STATUS_KEY, STATUS_TEXT);
		expect(host.footer.size).toBe(0);
		expect(host.recorded.get(STATUS_KEY)).toBe(STATUS_TEXT);
	});
});
