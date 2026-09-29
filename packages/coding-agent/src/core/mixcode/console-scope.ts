/**
 * Tab label for the async work currently running.
 *
 * The console bridge (`console/console-tui-bridge.ts`) reads it when a line is emitted and
 * stores it with that line, which `/console-history` then prints as the emitting
 * tab. Several tabs share one process and one console history, so the label is
 * the only way to tell a line's origin apart.
 *
 * A label exists only inside `runWithConsoleTab`; work started outside a tab
 * (startup, extension timers, non-tab actions) carries none.
 */
import { AsyncLocalStorage } from "node:async_hooks";

const storage = new AsyncLocalStorage<string>();

/** Run `fn` with `tabTitle` as the console label for every async task it starts. */
export function runWithConsoleTab<T>(tabTitle: string, fn: () => T): T {
	return storage.run(tabTitle, fn);
}

/** Title of the tab whose work runs here, or undefined for work outside any tab. */
export function currentConsoleTab(): string | undefined {
	return storage.getStore();
}
