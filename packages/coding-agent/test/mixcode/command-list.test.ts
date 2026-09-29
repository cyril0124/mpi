import { CombinedAutocompleteProvider } from "@earendil-works/pi-tui";
import { describe, expect, it } from "vitest";
import {
	type CommandSource,
	collectSlashCommands,
	type TabArgumentOption,
} from "../../src/modes/interactive/mixcode/command-list.ts";

/**
 * Argument completions, driven through the real autocomplete provider: the
 * editor text goes in, the items the user would see come out. This is the only
 * place that checks the command names in `command-list.ts` still match the
 * builtins, since a renamed command silently drops its completions.
 */

const TABS: TabArgumentOption[] = [
	{ index: 1, title: "Agent-01", description: "idle · active" },
	{ index: 2, title: "Fix tab", description: "running" },
];

const WORKSPACES = ["dev", "review"];

function makeSource(
	tabs: TabArgumentOption[] = TABS,
	workspaces: string[] = WORKSPACES,
	widgets: string[] = [],
): CommandSource {
	const session = {
		promptTemplates: [],
		extensionRunner: { getRegisteredCommands: () => [] },
		resourceLoader: { getSkills: () => ({ skills: [] }) },
	} as unknown as CommandSource["session"];
	const settingsManager = {
		getEnableSkillCommands: () => false,
	} as unknown as CommandSource["settingsManager"];
	return {
		session,
		settingsManager,
		skillCommands: new Map(),
		describe: (description) => description,
		loginProviders: () => [],
		tabArguments: () => tabs,
		workspaceNames: () => workspaces,
		widgetKeys: () => widgets,
	};
}

function complete(text: string, source: CommandSource = makeSource()): Promise<{ items: { value: string }[] } | null> {
	const provider = new CombinedAutocompleteProvider(collectSlashCommands(source), process.cwd(), null);
	return provider.getSuggestions([text], 0, text.length, { signal: new AbortController().signal });
}

async function values(text: string, source?: CommandSource): Promise<string[] | null> {
	const suggestions = await complete(text, source);
	return suggestions?.items.map((item) => item.value) ?? null;
}

/** Rank within the candidates is the fuzzy scorer's business; membership is not. */
async function valueSet(text: string, source?: CommandSource): Promise<string[] | null> {
	return (await values(text, source))?.sort() ?? null;
}

describe("builtin argument completions", () => {
	it("completes /color with the named tab colors and clear", async () => {
		expect(await valueSet("/color r")).toEqual(["clear", "gray", "green", "red"]);
		expect(await valueSet("/color cl")).toEqual(["clear"]);
	});

	it("returns nothing for an unknown /color argument", async () => {
		expect(await values("/color zzz")).toBeNull();
	});

	it("completes /tab with open tab titles", async () => {
		expect(await values("/tab ")).toEqual(["Agent-01", "Fix tab"]);
		expect(await values("/tab fix")).toEqual(["Fix tab"]);
	});

	it("completes the workspace commands with saved names", async () => {
		expect(await values("/restore-workspace ")).toEqual(["dev", "review"]);
		expect(await values("/delete-workspace rev")).toEqual(["review"]);
	});

	it("completes the confirmation argument of the session commands", async () => {
		expect(await valueSet("/close-session ")).toEqual(["y", "yes"]);
		expect(await valueSet("/delete-session y")).toEqual(["y", "yes"]);
	});

	it("leaves commands without candidates alone", async () => {
		expect(await values("/bug ")).toBeNull();
		expect(await values("/rename ")).toBeNull();
	});

	it("drops tab completions when multi-tab is unavailable", async () => {
		expect(await values("/tab ", makeSource([], []))).toBeNull();
	});
});
