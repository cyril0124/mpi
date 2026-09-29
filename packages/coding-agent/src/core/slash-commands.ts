import { APP_NAME } from "../config.ts";
import type { SourceInfo } from "./source-info.ts";

export type SlashCommandSource = "extension" | "prompt" | "skill";

export interface SlashCommandInfo {
	name: string;
	description?: string;
	source: SlashCommandSource;
	sourceInfo: SourceInfo;
}

export interface BuiltinSlashCommand {
	name: string;
	description: string;
	argumentHint?: string;
}

export const BUILTIN_SLASH_COMMANDS: ReadonlyArray<BuiltinSlashCommand> = [
	{ name: "settings", description: "Open settings menu" },
	{ name: "model", description: "Select model (opens selector UI)", argumentHint: "<provider/model>" },
	{ name: "tree", description: "Navigate session tree (switch branches)" },
	{ name: "thinking", description: "Set thinking level", argumentHint: "<level>" },
	{ name: "scoped-models", description: "Enable/disable models for model cycling" },
	{ name: "export", description: "Export session (HTML default, or specify path: .html/.jsonl)" },
	{ name: "import", description: "Import and resume a session from a JSONL file" },
	{ name: "share", description: "Share session as a secret GitHub gist" },
	{ name: "bug", description: "Report a bug to the Pi developers", argumentHint: "<description>" },
	{ name: "copy", description: "Copy last agent message to clipboard" },
	{ name: "name", description: "Set session display name" },
	{ name: "session", description: "Show session info and stats" },
	{ name: "changelog", description: "Show changelog entries" },
	{ name: "hotkeys", description: "Show all keyboard shortcuts" },
	{ name: "console-history", description: "View console output captured during this process" },
	{ name: "palette", description: "Open command palette" },
	{ name: "fork", description: "Create a new fork from a previous user message" },
	{ name: "clone", description: "Duplicate the current session at the current position" },
	{ name: "trust", description: "Save project trust decision for future sessions" },
	{ name: "login", description: "Configure provider authentication", argumentHint: "<provider>" },
	{ name: "logout", description: "Remove provider authentication" },
	{ name: "new", description: "Start a new session" },
	{ name: "new-session", description: "Open a new agent tab", argumentHint: "[title]" },
	{ name: "workdir", description: "Change the active tab's working directory", argumentHint: "[path]" },
	{ name: "close-session", description: "Close the current agent tab", argumentHint: "[yes]" },
	{ name: "close-all-sessions", description: "Close every agent tab except the current one" },
	{ name: "delete-session", description: "Delete the current tab's session file", argumentHint: "[yes]" },
	{ name: "delete-all-sessions", description: "Delete every tab's session file" },
	{ name: "rename", description: "Rename the current agent tab", argumentHint: "<title>" },
	{ name: "tabs", description: "List open agent tabs" },
	{ name: "tab", description: "Focus an agent tab", argumentHint: "<index|title>" },
	{ name: "color", description: "Set the active tab color", argumentHint: "<name|clear>" },
	{ name: "group-colored-tabs", description: "Sort agent tabs by color" },
	{ name: "mark-done", description: "Flag the active tab as finished" },
	{ name: "vim", description: "Enter Vim mode for transcript navigation" },
	{ name: "toggle-inline-widgets", description: "Show extension widgets in the chat tail or in the dock" },
	{ name: "widgets", description: "Expand or collapse widgets", argumentHint: "[expand|collapse|toggle] [key]" },
	{ name: "save-workspace", description: "Save the open tab layout", argumentHint: "[name]" },
	{ name: "restore-workspace", description: "Restore a saved tab layout", argumentHint: "[name]" },
	{ name: "delete-workspace", description: "Delete a saved tab layout", argumentHint: "[name]" },
	{ name: "compact", description: "Manually compact the session context" },
	{
		name: "follow-up",
		description: "Queue a follow-up round, or resume queued follow-ups",
		argumentHint: "[--batch] [message]",
	},
	{ name: "resume", description: "Resume a different session" },
	{ name: "reload", description: "Reload keybindings, extensions, skills, prompts, themes, and context files" },
	{ name: "quit", description: `Quit ${APP_NAME}` },
];
