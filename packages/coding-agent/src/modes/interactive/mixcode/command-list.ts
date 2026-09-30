/**
 * The one list of commands the interactive UI can run, read by the editor's `/`
 * autocomplete and by the command palette so the two cannot drift apart.
 *
 * `CommandSource` is what the list needs from the interactive mode: the session,
 * settings, the skill-command map it fills in, and the helpers the mode owns
 * (command descriptions, login providers, and the tab, workspace and widget
 * argument lists).
 */
import { type AutocompleteItem, fuzzyFilter, type SlashCommand } from "@earendil-works/pi-tui";
import type { AgentSession } from "../../../core/agent-session.ts";
import { FOLLOW_UP_BATCH_FLAG } from "../../../core/mixcode/follow-up/runtime-follow-up-queue.ts";
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
	/** Widget keys of the active tab, offered as `/widgets` argument completions. */
	widgetKeys(): string[];
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
 * per keystroke, so tab and workspace commands always see current state. Throws
 * when a name is not a builtin, so a renamed command fails loudly instead of
 * silently losing its completions.
 */
function attachValueCompletions(commands: SlashCommand[], names: readonly string[], values: () => string[]): void {
	for (const name of names) {
		const command = commands.find((candidate) => candidate.name === name);
		if (!command) throw new Error(`Unknown slash command: ${name}`);
		command.getArgumentCompletions = (prefix: string): AutocompleteItem[] | null =>
			createFuzzyAutocompleteItems(
				values(),
				prefix,
				(value) => value,
				(value) => ({ value, label: value }),
			);
	}
}

/** `/widgets` actions, in the order the bare argument list offers them. */
const WIDGET_ACTIONS = ["expand", "collapse", "toggle"] as const;

/** The action names as a regex alternation, so both matchers stay in sync with the list. */
const WIDGET_ACTION_ALTERNATION = WIDGET_ACTIONS.join("|");

const WIDGET_ACTION_WITH_KEY = new RegExp(`^(${WIDGET_ACTION_ALTERNATION})\\s+(.*)$`, "u");
const WIDGET_ACTION_ALONE = new RegExp(`^(${WIDGET_ACTION_ALTERNATION})\\s*$`, "u");

const WIDGET_ACTION_DESCRIPTIONS: Record<(typeof WIDGET_ACTIONS)[number], string> = {
	expand: "Expand widgets",
	collapse: "Collapse widgets",
	toggle: "Toggle widgets",
};

/**
 * `/widgets` arguments: an action, then an exact widget key. A key is offered for
 * every action once one is typed; with no action typed, the actions come first.
 */
function widgetArgumentCompletions(widgetKeys: readonly string[], prefix: string): AutocompleteItem[] {
	const normalized = prefix.trimStart();
	const actionMatch = WIDGET_ACTION_WITH_KEY.exec(normalized);
	if (actionMatch) {
		const keyPrefix = actionMatch[2]?.toLowerCase() ?? "";
		return widgetKeys
			.filter((key) => key.toLowerCase().startsWith(keyPrefix))
			.map((key) => ({ value: `${actionMatch[1]} ${key}`, label: key }));
	}
	if (WIDGET_ACTION_ALONE.test(normalized)) {
		return widgetKeys.map((key) => ({ value: `${normalized.trim()} ${key}`, label: key }));
	}
	return WIDGET_ACTIONS.map((action) => ({
		value: action,
		label: action,
		description: WIDGET_ACTION_DESCRIPTIONS[action],
	})).filter((item) => item.value.startsWith(normalized.toLowerCase()));
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
	const slashCommands: SlashCommand[] = BUILTIN_SLASH_COMMANDS.map((command) => ({
		name: command.name,
		description: command.description,
		...(command.argumentHint && { argumentHint: command.argumentHint }),
	}));

	for (const name of ["model", "compact"]) {
		const command = slashCommands.find((candidate) => candidate.name === name);
		if (!command) continue;
		command.getArgumentCompletions = (prefix: string): AutocompleteItem[] | null => {
			if (name === "compact" && /\s/.test(prefix.trimStart())) return null;
			const models =
				source.session.scopedModels.length > 0
					? source.session.scopedModels.map((s) => s.model)
					: source.session.modelRuntime.getAvailableSnapshot();

			if (models.length === 0) return null;

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

	// `/follow-up`: offer the batch flag while the argument is still an
	// incomplete flag token; any other text already names its message.
	const followUpCommand = slashCommands.find((command) => command.name === "follow-up");
	if (followUpCommand) {
		followUpCommand.getArgumentCompletions = (prefix: string): AutocompleteItem[] | null => {
			const text = prefix.trim();
			const incompleteFlag =
				text !== FOLLOW_UP_BATCH_FLAG &&
				text.startsWith("-") &&
				!/\s/.test(text) &&
				FOLLOW_UP_BATCH_FLAG.startsWith(text);
			if (text !== "" && !incompleteFlag) return null;
			return [
				{
					value: FOLLOW_UP_BATCH_FLAG,
					label: FOLLOW_UP_BATCH_FLAG,
					description: "Merge with adjacent batch follow-ups into one round",
				},
			];
		};
	}

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

	const widgetsCommand = slashCommands.find((command) => command.name === "widgets");
	if (widgetsCommand) {
		widgetsCommand.getArgumentCompletions = (prefix: string): AutocompleteItem[] | null => {
			const completions = widgetArgumentCompletions(source.widgetKeys(), prefix);
			return completions.length > 0 ? completions : null;
		};
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
