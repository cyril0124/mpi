/**
 * Console to TUI bridge.
 *
 * The interactive TUI owns the screen and paints frames onto stdout. Something
 * that calls `console.log/warn/error` while it runs would write raw text to the
 * same tty, corrupt the frame, and duplicate the tab bar. Pi skips its stdout
 * takeover in interactive mode (`core/output-guard.ts`), so the interactive
 * surface has to relocate console output itself.
 *
 * This module overrides the five console methods so their output is rendered
 * through the TUI instead of leaking to the raw tty. Nothing is swallowed: each
 * call is formatted the way console formats it (`node:util.format`) with a
 * `[console.<method>]:` prefix and handed to a late-bound sink. Before the TUI
 * exists the calls queue, and `wireConsoleSink` flushes the backlog in order.
 *
 * Two paths deliberately keep native console behavior: a process that ends before
 * the sink is wired (`--help`, a startup error) replays its queued calls through the
 * native methods, and `unwireConsoleSink` hands console back to them when the TUI is
 * torn down. Both keep output that never reaches the transcript byte-identical to
 * what the terminal saw before this module existed.
 *
 * All tabs share one process and one history, so each record also stores the tab
 * title reported by `console-scope.ts` at emit time; `/console-history` prints it
 * between the timestamp and the line.
 */
import { format } from "node:util";
import { currentConsoleTab } from "../console-scope.ts";

/** Console methods relocated to the TUI. These five are overridden directly. `console.group`,
 * `table`, `count`, `time*`, `assert` and `trace` still reach the bridge, because Node implements
 * them on top of `log`/`error`/`warn`; `console.dir` and the silent helpers stay native. */
const BRIDGED_METHODS = ["log", "info", "debug", "warn", "error"] as const;
const CONSOLE_HISTORY_LIMIT = 1_000;
type BridgedMethod = (typeof BRIDGED_METHODS)[number];

/** Receives a fully formatted, prefixed line ready to display. */
type ConsoleSink = (text: string) => void;

/** A call made before any sink existed, kept whole so it can be replayed natively. */
interface PendingCall {
	/** Formatted when the call was made, so the transcript and the history cannot diverge. */
	line: string;
	method: BridgedMethod;
	args: unknown[];
}

let sink: ConsoleSink | undefined;
/** Methods as they were before the bridge, for the two paths that must stay native. */
const nativeMethods = new Map<BridgedMethod, (...args: unknown[]) => void>();
/** True once the TUI is gone: console calls go straight back to the terminal. */
let passthrough = false;
/** Calls produced before the TUI sink is wired (e.g. during extension loading). */
const pending: PendingCall[] = [];

interface ConsoleRecord {
	time: number;
	/** Tab whose work emitted the line; undefined for work outside any tab. */
	tab?: string;
	line: string;
}
const history: ConsoleRecord[] = [];

/**
 * Return a stable snapshot of console output captured during this process.
 * Each entry reads `<YYYY-MM-DD HH:MM:SS> [<tab>] <line>`; the tab segment is
 * absent for lines emitted outside tab-owned work (startup, extension timers).
 */
export function getConsoleHistory(): string[] {
	return history.map(({ time, tab, line }) => `${formatConsoleTime(time)} ${tab ? `[${tab}] ` : ""}${line}`);
}

/** Local-time YYYY-MM-DD HH:MM:SS stamp so history rows line up in a viewer. */
function formatConsoleTime(time: number): string {
	const date = new Date(time);
	const pad = (value: number) => String(value).padStart(2, "0");
	return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

/** Format console args the way console does, then tag the line with its method. */
function formatConsoleLine(method: BridgedMethod, args: unknown[]): string {
	return `[console.${method}]: ${format(...args)}`;
}

function emit(method: BridgedMethod, args: unknown[]): void {
	const line = formatConsoleLine(method, args);
	const tab = currentConsoleTab();
	history.push({ time: Date.now(), line, ...(tab ? { tab } : {}) });
	if (history.length > CONSOLE_HISTORY_LIMIT) history.shift();
	if (sink) sink(line);
	else pending.push({ line, method, args });
}

/**
 * Override `console.{log,info,debug,warn,error}` to route through the TUI sink.
 * Call once, early in startup and only on the interactive path, so nothing leaks
 * to the raw tty before the TUI can render it. Not meant to be called twice.
 */
export function installConsoleTuiBridge(): void {
	for (const method of BRIDGED_METHODS) {
		const native = console[method].bind(console);
		nativeMethods.set(method, native);
		console[method] = (...args: unknown[]) => {
			if (passthrough) native(...args);
			else emit(method, args);
		};
	}
	// The bridge is installed before the TUI exists and before startup is past its
	// argument and diagnostics handling. If the process ends on one of those paths
	// (`--help`, a startup error), no sink is ever wired and the queued calls would
	// vanish with the process; replay them through the native methods, so the
	// terminal sees exactly what it saw before this module existed.
	process.once("exit", () => {
		if (sink) return;
		for (const { method, args } of pending.splice(0)) nativeMethods.get(method)?.(...args);
	});
}

/**
 * Register the display sink (the interactive transcript) and flush the calls queued
 * before the TUI existed, using the line each one formatted to when it was made.
 * Later console calls go straight to the sink.
 */
export function wireConsoleSink(fn: ConsoleSink): void {
	sink = fn;
	passthrough = false;
	for (const { line } of pending.splice(0)) fn(line);
}

/**
 * Hand console output back to the native methods. Call it when the TUI is torn
 * down: a sink that still points at a stopped UI paints into a dead frame, so
 * anything logged afterwards (a benchmark timings report, shutdown hooks) would
 * be lost. Input read before this call is unaffected.
 */
export function unwireConsoleSink(): void {
	sink = undefined;
	passthrough = true;
}
