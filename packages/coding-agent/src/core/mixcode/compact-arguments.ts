/**
 * Split a `/compact` argument string into its optional summary-model reference and the
 * instructions.
 *
 * A leading `provider/modelId` may name the model that writes the summary, so the first word has
 * to be classified before anything runs. Its shape alone is not enough: a path such as
 * `src/auth.ts` or `docs/plans` has the same `word/word` form, and refusing it as an unknown model
 * blocks `/compact` instructions that name the file to keep. The word is a model reference when
 * the catalog resolves it, and a misspelled one when its provider is known. Every other first
 * word, a path included, stays instruction text.
 */

/** The `provider/modelId` form, including catalog IDs that contain a slash. */
const MODEL_REFERENCE_SHAPE = /^[^/\s]+\/[^/\s]+(?:\/[^/\s]+)*$/;

export interface CompactArgumentCatalog {
	/** True when the reference names a model the catalog resolves. */
	hasModel: (reference: string) => boolean;
	/** True when the name is a provider the catalog knows. */
	hasProvider: (provider: string) => boolean;
}

export interface CompactArguments {
	/** Leading token naming the summary model, when it names one. */
	modelRef?: string;
	/** Leading token shaped like a model reference whose provider is known but whose model does not resolve. */
	unknownModelRef?: string;
	/** Instruction text for the summarizer, with the model reference removed. */
	instructions: string;
}

/**
 * `args` is the raw `/compact` argument string. An empty argument yields empty instructions and
 * no model reference, which is the plain manual compaction.
 */
export function splitCompactArguments(args: string, catalog: CompactArgumentCatalog): CompactArguments {
	const trimmed = args.trimStart();
	const firstToken = trimmed.split(/\s/)[0] ?? "";
	if (!MODEL_REFERENCE_SHAPE.test(firstToken)) return { instructions: args };
	if (catalog.hasModel(firstToken)) {
		return { modelRef: firstToken, instructions: trimmed.slice(firstToken.length).trimStart() };
	}
	const provider = firstToken.slice(0, firstToken.indexOf("/"));
	if (catalog.hasProvider(provider)) return { unknownModelRef: firstToken, instructions: "" };
	return { instructions: args };
}
