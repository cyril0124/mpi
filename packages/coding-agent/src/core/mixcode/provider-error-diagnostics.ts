import type { Api, Context, Model, ModelsApiStreamOptions, StreamOptions } from "@earendil-works/pi-ai";
import { notifyProviderError } from "@earendil-works/pi-ai/utils/mixcode/provider-error";
import type { ModelRuntime } from "../model-runtime.ts";

interface ProviderErrorFacts {
	name?: string;
	code?: string;
	status?: number;
}

/** Nodes examined per failure. `cause` chains can cycle and `AggregateError` can fan out. */
const MAX_ERROR_NODES = 5;
/** Provider identifiers are short ASCII tokens; anything else is caller data, not a fact. */
const IDENTIFIER_PATTERN = /^[a-zA-Z][a-zA-Z0-9_.-]{0,79}$/;
const HTTP_STATUS_MIN = 100;
const HTTP_STATUS_MAX = 599;

/**
 * Install provider-error diagnostics on a shared `ModelRuntime`.
 *
 * Every request through the runtime gets an `onProviderError` observer that forwards to the
 * caller's own observer and then records the caught exception's bounded facts in the console
 * history as a `[provider-error]` line. Call once per runtime: `complete` and `completeSimple`
 * delegate to the wrapped `stream` and `streamSimple`.
 *
 * Raw exceptions are borrowed only for the duration of the callback; the console receives
 * name/code/status facts, never message, stack, headers or body. A request whose signal is
 * already aborted still reaches the caller's observer but writes no diagnostic line.
 */
export function configureProviderErrorDiagnostics(modelRuntime: ModelRuntime): void {
	const stream = modelRuntime.stream.bind(modelRuntime) as ModelRuntime["stream"];
	const streamSimple = modelRuntime.streamSimple.bind(modelRuntime) as ModelRuntime["streamSimple"];

	modelRuntime.stream = <TApi extends Api>(
		model: Model<TApi>,
		context: Context,
		options?: ModelsApiStreamOptions<TApi>,
	) => stream(model, context, withProviderErrorObserver(options));

	modelRuntime.streamSimple = (model, context, options) =>
		streamSimple(model, context, withProviderErrorObserver(options));
}

/** Copy the request options, adding an observer that logs the failure after the caller's own. */
function withProviderErrorObserver<T extends StreamOptions>(options: T | undefined): T {
	const callerObserver = options?.onProviderError;
	// The caller's observer runs first, and inside its own isolation, so a throwing caller
	// cannot suppress the diagnostic line.
	const observer: NonNullable<StreamOptions["onProviderError"]> = (error, model) => {
		notifyProviderError(callerObserver, error, model);
		if (options?.signal?.aborted) return;
		const errors = collectErrorFacts(error);
		if (errors.length === 0) return;
		console.warn(
			"[provider-error] %s",
			JSON.stringify({ provider: model.provider, model: model.id, api: model.api, errors }),
		);
	};
	// The spread keeps every caller option, so the result is still a `T`; only a generic spread
	// defeats the compiler's proof of that.
	return { ...options, onProviderError: observer } as T;
}

/** Keep the accepted name/code/status of up to `MAX_ERROR_NODES` exception nodes, root first. */
function collectErrorFacts(error: unknown): ProviderErrorFacts[] {
	const pending: unknown[] = [error];
	const seen = new Set<object>();
	const facts: ProviderErrorFacts[] = [];

	for (let index = 0; index < pending.length && index < MAX_ERROR_NODES; index++) {
		const current = asErrorRecord(pending[index]);
		if (!current || seen.has(current)) continue;
		seen.add(current);

		const name = diagnosticIdentifier(current.name);
		const code = diagnosticIdentifier(current.code);
		const status = acceptedHttpStatus(current.status ?? asErrorRecord(current.$metadata)?.httpStatusCode);
		if (name || code || status !== undefined) {
			facts.push({
				...(name ? { name } : {}),
				...(code ? { code } : {}),
				...(status !== undefined ? { status } : {}),
			});
		}

		if (current.cause !== undefined && pending.length < MAX_ERROR_NODES) pending.push(current.cause);
		if (Array.isArray(current.errors)) {
			pending.push(...current.errors.slice(0, MAX_ERROR_NODES - pending.length));
		}
	}
	return facts;
}

function asErrorRecord(value: unknown): Record<string, unknown> | undefined {
	return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : undefined;
}

function diagnosticIdentifier(value: unknown): string | undefined {
	return typeof value === "string" && IDENTIFIER_PATTERN.test(value) ? value : undefined;
}

function acceptedHttpStatus(value: unknown): number | undefined {
	if (typeof value !== "number" || !Number.isInteger(value)) return undefined;
	return value >= HTTP_STATUS_MIN && value <= HTTP_STATUS_MAX ? value : undefined;
}
