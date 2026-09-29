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
import { join } from "node:path";
import { stripJsonComments } from "../../utils/json.ts";
import { stripBom } from "../../utils/text.ts";
import { mixcodeRootStateDir } from "./multi-tab/mixcode-state.ts";

export const MIXCODE_SETTINGS_FILENAME = "mixcode_settings.json";

/** Global default for new tabs: extension widgets render in the chat tail. */
export const DEFAULT_INLINE_WIDGETS = true;

/** Settings with every default applied. */
export interface MixCodeSettings {
	ui: {
		inlineWidgets: boolean;
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
	const next: Record<string, unknown> = { ...readSettingsSource(settingsFile) };
	const ui = objectRecord(next.ui);
	next.ui = { ...ui, inlineWidgets: enabled };
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
	const ui = objectRecord(source.ui);
	return { ui: { inlineWidgets: parseInlineWidgets(ui.inlineWidgets, settingsFile) } };
}

function defaultMixCodeSettings(): MixCodeSettings {
	return { ui: { inlineWidgets: DEFAULT_INLINE_WIDGETS } };
}

function parseInlineWidgets(value: unknown, settingsFile: string): boolean {
	if (value === undefined) return DEFAULT_INLINE_WIDGETS;
	if (typeof value === "boolean") return value;
	throw new Error(`${settingsFile}: ui.inlineWidgets must be a boolean`);
}

function readSettingsSource(settingsFile: string): Record<string, unknown> | undefined {
	if (!existsSync(settingsFile)) return undefined;
	const text = stripBom(readFileSync(settingsFile, "utf-8"));
	try {
		return objectRecord(JSON.parse(stripJsonComments(text)));
	} catch (error) {
		throw new Error(`${settingsFile}: ${error instanceof Error ? error.message : String(error)}`);
	}
}

function writeSettingsFile(settingsFile: string, contents: Record<string, unknown>): void {
	mkdirSync(join(settingsFile, ".."), { recursive: true });
	const temp = `${settingsFile}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
	writeFileSync(temp, `${JSON.stringify(contents, null, 2)}\n`, "utf-8");
	try {
		renameSync(temp, settingsFile);
	} catch (error) {
		rmSync(temp, { force: true });
		throw error;
	}
}

function objectRecord(value: unknown): Record<string, unknown> {
	return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}
