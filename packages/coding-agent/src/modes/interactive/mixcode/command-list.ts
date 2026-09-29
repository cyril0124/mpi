/**
 * The one list of commands the interactive UI can run, read by the editor's `/`
 * autocomplete and by the command palette so the two cannot drift apart.
 *
 * `CommandSource` is what the list needs from the interactive mode: the session,
 * settings, the skill-command map it fills in, and two helpers the mode owns.
 */
import { type AutocompleteItem, fuzzyFilter, type SlashCommand } from "@earendil-works/pi-tui";
import type { AgentSession } from "../../../core/agent-session.ts";
import { TAB_COLOR_NAMES } from "../../../core/mixcode/multi-tab/types.ts";
import { BUILTIN_SLASH_COMMANDS } from "../../../core/slash-commands.ts";
import type { SourceInfo } from "../../../core/source-info.ts";
import type { AuthSelectorProvider } from "../components/oauth-selector.ts";
import { formatAuthSelectorProviderType } from "../components/oauth-selector.ts";
import { getModelSearchText } from "../model-search.ts";

export type CommandSource = {
	session: AgentSession;
	settingsManager: AgentSession["settingsManager"];
	skillCommands: Map<string, string>;
	/** Describe a template, extension or skill command, tagging where it came from. */
	describe(description: string | undefined, sourceInfo?: SourceInfo): string | undefined;
	/** Providers offered as `/login` argument completions. */
	loginProviders(): AuthSelectorProvider[];
	/** Open agent tabs offered as `/tab` argument completions; empty without multi-tab. */
	tabArguments(): TabArgumentOption[];
	/** Saved workspace names offered by the `/...-workspace` argument completions. */
	workspaceNames(): string[];
};

/** One open agent tab offered as a `/tab` argument completion. */
export type TabArgumentOption = {
	/** 1-based position matching the `/tab <index>` form. */
	index: number;
	title: string;
	/** Short descriptor shown beside the title, e.g. `running · active`. */
	description?: string;
};

type LoginProviderCompletionOption = {
	id: string;
	name: string;
	authTypes: AuthSelectorProvider["authType"][];
};

const AUTH_TYPE_ORDER = { oauth: 0, api_key: 1 } satisfies Record<AuthSelectorProvider["authType"], number>;

function createFuzzyAutocompleteItems<T>(
	items: T[],
	prefix: string,
	getSearchText: (item: T) => string,
	toAutocompleteItem: (item: T) => AutocompleteItem,
): AutocompleteItem[] | null {
	const filtered = fuzzyFilter(items, prefix, getSearchText);
	if (filtered.length === 0) return null;
	return filtered.map(toAutocompleteItem);
}

/**
 * Attach a plain string-list completion to each named command. `values` is read
 * per keystroke, so tab and workspace commands always see current state.
 */
function attachValueCompletions(commands: SlashCommand[], names: readonly string[], values: () => string[]): void {
	for (const name of names) {
		const command = commands.find((candidate) => candidate.name === name);
		if (!command) continue;
		command.getArgumentCompletions = (prefix: string): AutocompleteItem[] | null =>
			createFuzzyAutocompleteItems(
				values(),
				prefix,
				(value) => value,
				(value) => ({ value, label: value }),
			);
	}
}

function getLoginProviderCompletionOptions(
	providerOptions: readonly AuthSelectorProvider[],
): LoginProviderCompletionOption[] {
	const byId = new Map<string, LoginProviderCompletionOption>();
	for (const provider of providerOptions) {
		const existing = byId.get(provider.id);
		if (existing) {
			if (!existing.authTypes.includes(provider.authType)) {
				existing.authTypes.push(provider.authType);
				existing.authTypes.sort((a, b) => AUTH_TYPE_ORDER[a] - AUTH_TYPE_ORDER[b]);
			}
			continue;
		}
		byId.set(provider.id, {
			id: provider.id,
			name: provider.name,
			authTypes: [provider.authType],
		});
	}
	return Array.from(byId.values()).sort((a, b) => a.name.localeCompare(b.name));
}

function getLoginProviderSearchText(provider: LoginProviderCompletionOption): string {
	const authTypes = provider.authTypes
		.map((authType) => `${authType} ${formatAuthSelectorProviderType(authType)}`)
		.join(" ");
	return `${provider.id} ${provider.name} ${authTypes}`;
}

function formatLoginProviderCompletionDescription(provider: LoginProviderCompletionOption): string {
	const authTypes = provider.authTypes.map(formatAuthSelectorProviderType).join("/");
	return provider.name === provider.id ? authTypes : `${provider.name} · ${authTypes}`;
}

/**
 * Every command the UI can run: builtins, prompt templates, extension commands
 * (never shadowing a builtin) and skill commands.
 */
export function collectSlashCommands(source: CommandSource): SlashCommand[] {
	// Define commands for autocomplete
	const slashCommands: SlashCommand[] = BUILTIN_SLASH_COMMANDS.map((command) => ({
		name: command.name,
		description: command.description,
		...(command.argumentHint && { argumentHint: command.argumentHint }),
	}));

	const modelCommand = slashCommands.find((command) => command.name === "model");
	if (modelCommand) {
		modelCommand.getArgumentCompletions = (prefix: string): AutocompleteItem[] | null => {
			const models =
				source.session.scopedModels.length > 0
					? source.session.scopedModels.map((s) => s.model)
					: source.session.modelRuntime.getAvailableSnapshot();

			if (models.length === 0) return null;

			// Create items with provider/id format
			const items = models.map((m) => ({
				id: m.id,
				provider: m.provider,
				name: m.name,
				label: `${m.provider}/${m.id}`,
			}));

			return createFuzzyAutocompleteItems(items, prefix, getModelSearchText, (item) => ({
				value: item.label,
				label: item.id,
				description: item.provider,
			}));
		};
	}

	const thinkingCommand = slashCommands.find((command) => command.name === "thinking");
	if (thinkingCommand) {
		thinkingCommand.getArgumentCompletions = (prefix: string): AutocompleteItem[] | null => {
			return createFuzzyAutocompleteItems(
				source.session.getAvailableThinkingLevels(),
				prefix,
				(level) => level,
				(level) => ({
					value: level,
					label: level,
				}),
			);
		};
	}

	const loginCommand = slashCommands.find((command) => command.name === "login");
	if (loginCommand) {
		loginCommand.getArgumentCompletions = (prefix: string): AutocompleteItem[] | null => {
			const providers = getLoginProviderCompletionOptions(source.loginProviders());
			return createFuzzyAutocompleteItems(providers, prefix, getLoginProviderSearchText, (provider) => ({
				value: provider.id,
				label: provider.id,
				description: formatLoginProviderCompletionDescription(provider),
			}));
		};
	}

	attachValueCompletions(slashCommands, ["color"], () => [...TAB_COLOR_NAMES, "clear"]);
	attachValueCompletions(slashCommands, ["close-session", "delete-session"], () => ["yes", "y"]);
	attachValueCompletions(slashCommands, ["restore-workspace", "delete-workspace"], () => source.workspaceNames());

	const tabCommand = slashCommands.find((command) => command.name === "tab");
	if (tabCommand) {
		tabCommand.getArgumentCompletions = (prefix: string): AutocompleteItem[] | null =>
			createFuzzyAutocompleteItems(
				source.tabArguments(),
				prefix,
				(tab) => `${tab.index} ${tab.title}`,
				(tab) => ({
					value: tab.title,
					label: `${tab.index}. ${tab.title}`,
					...(tab.description && { description: tab.description }),
				}),
			);
	}

	// Convert prompt templates to SlashCommand format for autocomplete
	const templateCommands: SlashCommand[] = source.session.promptTemplates.map((cmd) => ({
		name: cmd.name,
		description: source.describe(cmd.description, cmd.sourceInfo),
		...(cmd.argumentHint && { argumentHint: cmd.argumentHint }),
	}));

	// Convert extension commands to SlashCommand format
	const builtinCommandNames = new Set(slashCommands.map((c) => c.name));
	const extensionCommands: SlashCommand[] = source.session.extensionRunner
		.getRegisteredCommands()
		.filter((cmd) => !builtinCommandNames.has(cmd.name))
		.map((cmd) => ({
			name: cmd.invocationName,
			description: source.describe(cmd.description, cmd.sourceInfo),
			getArgumentCompletions: cmd.getArgumentCompletions,
		}));

	// Build skill commands from session.skills (if enabled)
	source.skillCommands.clear();
	const skillCommandList: SlashCommand[] = [];
	if (source.settingsManager.getEnableSkillCommands()) {
		for (const skill of source.session.resourceLoader.getSkills().skills) {
			const commandName = `skill:${skill.name}`;
			source.skillCommands.set(commandName, skill.filePath);
			skillCommandList.push({
				name: commandName,
				description: source.describe(skill.description, skill.sourceInfo),
			});
		}
	}

	return [...slashCommands, ...templateCommands, ...extensionCommands, ...skillCommandList];
}
