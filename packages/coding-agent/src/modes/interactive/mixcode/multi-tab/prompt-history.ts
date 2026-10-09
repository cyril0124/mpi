const MAX_TAB_PROMPTS = 100;

/** Keep the newest occurrence of raw input on its tab, including inputs no session entry records. */
export function rememberTabPrompt(prompts: Map<string, string[]>, tabId: string, text: string): void {
	const trimmed = text.trim();
	if (!trimmed) return;
	const previous = prompts.get(tabId) ?? [];
	prompts.set(tabId, [trimmed, ...previous.filter((prompt) => prompt !== trimmed)].slice(0, MAX_TAB_PROMPTS));
}
