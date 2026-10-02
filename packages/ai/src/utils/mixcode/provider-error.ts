import type { Api, Model, StreamOptions } from "../../types.ts";

/**
 * Call an optional provider-error observer without letting it replace the provider's own failure.
 *
 * The observer is diagnostics only: a synchronous throw and a returned rejected promise are both
 * swallowed, and its return value is never awaited, so the adapter still emits its terminal error
 * carrying the original exception.
 */
export function notifyProviderError(
	observer: StreamOptions["onProviderError"],
	error: unknown,
	model: Model<Api>,
): void {
	if (!observer) return;
	try {
		const result: unknown = observer(error, model);
		// A `void` callback may still be implemented by an async function.
		const then = (result as { then?: unknown } | null)?.then;
		if (typeof then === "function") {
			void Promise.resolve(result).catch(() => {});
		}
	} catch {
		// Observer failure is non-fatal: the provider keeps its terminal result.
	}
}
