/**
 * MixCode's own settings, kept beside the state directory pi shares with
 * mixcode-pi so both agents read the same file:
 *
 *   <agentDir>/mixcode-pi/mixcode_settings.json
 *
 * A write rewrites the JSON (comments are dropped, as mixcode-pi does) but keeps
 * the keys this module does not own, so a newer mixcode-pi can keep its own.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { stripJsonComments } from "../../utils/json.ts";
import { stripBom } from "../../utils/text.ts";
import { asRecord, mixcodeRootStateDir } from "./multi-tab/mixcode-state.ts";

export const MIXCODE_SETTINGS_FILENAME = "mixcode_settings.json";

/** Global default for new tabs: extension widgets render in the chat tail. */
export const DEFAULT_INLINE_WIDGETS = true;

/** Hidden thinking blocks render as a 3-row tail instead of the placeholder. */
export const DEFAULT_BOXED_HIDDEN_THINKING = true;

/** The response model mismatch notice shows under a reply unless the user turns it off. */
export const DEFAULT_SHOW_RESPONSE_MODEL_NOTICES = true;

/** How the meta row picks its glyphs: probe the terminal, or force one alphabet. */
export const ICON_MODES = ["auto", "nerd", "ascii"] as const;
export type IconMode = (typeof ICON_MODES)[number];

/** Nerd Font glyphs unless the user asks the row to probe the terminal. */
export const DEFAULT_ICON_MODE: IconMode = "nerd";

/** Settings with every default applied. */
export interface MixCodeSettings {
	ui: {
		inlineWidgets: boolean;
		boxedHiddenThinking: boolean;
		icons: { mode: IconMode };
		showResponseModelNotices: boolean;
	};
}

/** Path of `mixcode_settings.json`, the fork's own settings file. */
export function mixcodeSettingsFilePath(): string {
	return join(mixcodeRootStateDir(), MIXCODE_SETTINGS_FILENAME);
}

/**
 * Write the inline-widgets default. Every other key in the file survives, at the
 * top level and inside `ui`: the file is shared with mixcode-pi, which keeps its
 * own settings there.
 */
export function writeInlineWidgetsSetting(settingsFile: string, enabled: boolean): void {
	writeUiSettings(settingsFile, (ui) => ({ ...ui, inlineWidgets: enabled }));
}

/** Write the hidden-thinking tail default; other keys survive, as above. */
export function writeBoxedHiddenThinkingSetting(settingsFile: string, enabled: boolean): void {
	writeUiSettings(settingsFile, (ui) => ({ ...ui, boxedHiddenThinking: enabled }));
}

/** Write the response model mismatch notice default; other keys survive, as above. */
export function writeShowResponseModelNoticesSetting(settingsFile: string, enabled: boolean): void {
	writeUiSettings(settingsFile, (ui) => ({ ...ui, showResponseModelNotices: enabled }));
}

/**
 * Write the meta row's icon mode. `ui.icons` is an object mixcode-pi also owns,
 * so the write merges into it and leaves its other keys alone.
 */
export function writeIconModeSetting(settingsFile: string, mode: IconMode): void {
	writeUiSettings(settingsFile, (ui) => ({ ...ui, icons: { ...asRecord(ui.icons), mode } }));
}

/** Rewrite `ui` with one setting changed, leaving the rest of the file as it was. */
function writeUiSettings(settingsFile: string, update: (ui: Record<string, unknown>) => Record<string, unknown>): void {
	const next: Record<string, unknown> = { ...readSettingsSource(settingsFile) };
	next.ui = update(asRecord(next.ui));
	writeSettingsFile(settingsFile, next);
}

/**
 * Settings with defaults applied.
 *
 * A field present but not boolean is an error naming the file and the field,
 * rather than a silent fallback: a typo should not look like it worked.
 */
export function loadMixCodeSettings(settingsFile: string): MixCodeSettings {
	const source = readSettingsSource(settingsFile);
	if (!source) return defaultMixCodeSettings();
	const ui = asRecord(source.ui);
	return {
		ui: {
			inlineWidgets: parseBoolean(ui.inlineWidgets, "inlineWidgets", DEFAULT_INLINE_WIDGETS, settingsFile),
			boxedHiddenThinking: parseBoolean(
				ui.boxedHiddenThinking,
				"boxedHiddenThinking",
				DEFAULT_BOXED_HIDDEN_THINKING,
				settingsFile,
			),
			icons: { mode: parseIconMode(asRecord(ui.icons).mode, settingsFile) },
			showResponseModelNotices: parseBoolean(
				ui.showResponseModelNotices,
				"showResponseModelNotices",
				DEFAULT_SHOW_RESPONSE_MODEL_NOTICES,
				settingsFile,
			),
		},
	};
}

function defaultMixCodeSettings(): MixCodeSettings {
	return {
		ui: {
			inlineWidgets: DEFAULT_INLINE_WIDGETS,
			boxedHiddenThinking: DEFAULT_BOXED_HIDDEN_THINKING,
			icons: { mode: DEFAULT_ICON_MODE },
			showResponseModelNotices: DEFAULT_SHOW_RESPONSE_MODEL_NOTICES,
		},
	};
}

/** A mode other than the three known ones is an error naming the file and the field. */ function parseIconMode(
	value: unknown,
	settingsFile: string,
): IconMode {
	if (value === undefined) return DEFAULT_ICON_MODE;
	if ((ICON_MODES as readonly unknown[]).includes(value)) return value as IconMode;
	throw new Error(`${settingsFile}: ui.icons.mode must be one of ${ICON_MODES.join(", ")}`);
}

/** A field present but not boolean is an error naming the file and the field. */
function parseBoolean(value: unknown, key: string, fallback: boolean, settingsFile: string): boolean {
	if (value === undefined) return fallback;
	if (typeof value === "boolean") return value;
	throw new Error(`${settingsFile}: ui.${key} must be a boolean`);
}

function readSettingsSource(settingsFile: string): Record<string, unknown> | undefined {
	if (!existsSync(settingsFile)) return undefined;
	const text = stripBom(readFileSync(settingsFile, "utf-8"));
	try {
		return asRecord(JSON.parse(stripJsonComments(text)));
	} catch (error) {
		throw new Error(`${settingsFile}: ${error instanceof Error ? error.message : String(error)}`);
	}
}

function writeSettingsFile(settingsFile: string, contents: Record<string, unknown>): void {
	mkdirSync(dirname(settingsFile), { recursive: true });
	const temp = `${settingsFile}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
	writeFileSync(temp, `${JSON.stringify(contents, null, 2)}\n`, "utf-8");
	try {
		renameSync(temp, settingsFile);
	} catch (error) {
		rmSync(temp, { force: true });
		throw error;
	}
}
