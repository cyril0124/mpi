import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setKeybindings } from "@earendil-works/pi-tui";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { KeybindingsManager } from "../../src/core/keybindings.ts";
import type { MixCodeSettings } from "../../src/core/mixcode/mixcode-settings.ts";
import {
	loadMixCodeSettings,
	mixcodeSettingsFilePath,
	writeIconModeSetting,
	writeInlineWidgetsSetting,
} from "../../src/core/mixcode/mixcode-settings.ts";
import {
	createInlineWidgetTabState,
	type InlineWidgetTabState,
} from "../../src/modes/interactive/components/mixcode/inline-widgets/inline-widgets.ts";
import {
	type SettingsCallbacks,
	type SettingsConfig,
	SettingsSelectorComponent,
} from "../../src/modes/interactive/components/settings-selector.ts";
import { InteractiveMode } from "../../src/modes/interactive/interactive-mode.ts";
import { initTheme } from "../../src/modes/interactive/theme/theme.ts";
import { stripAnsi } from "../../src/utils/ansi.ts";

const tempDirs: string[] = [];

function tempDir(): string {
	const dir = mkdtempSync(join(tmpdir(), "mixcode-settings-"));
	tempDirs.push(dir);
	return dir;
}

afterEach(() => {
	while (tempDirs.length > 0) rmSync(tempDirs.pop() as string, { recursive: true, force: true });
});

describe("mixcode_settings.json", () => {
	it("defaults inline widgets to on when the file is missing", () => {
		const file = join(tempDir(), "mixcode_settings.json");
		expect(loadMixCodeSettings(file).ui.inlineWidgets).toBe(true);
	});

	it("reads an explicit off value", () => {
		const file = join(tempDir(), "mixcode_settings.json");
		writeFileSync(file, '{\n  "ui": { "inlineWidgets": false }\n}\n');
		expect(loadMixCodeSettings(file).ui.inlineWidgets).toBe(false);
	});

	it("accepts comments and trailing commas, like the state files", () => {
		const file = join(tempDir(), "mixcode_settings.json");
		writeFileSync(file, '{\n  // mixcode ui\n  "ui": { "inlineWidgets": false, },\n}\n');
		expect(loadMixCodeSettings(file).ui.inlineWidgets).toBe(false);
	});

	it("names the file and field when the value is not a boolean", () => {
		const file = join(tempDir(), "mixcode_settings.json");
		writeFileSync(file, '{\n  "ui": { "inlineWidgets": "yes" }\n}\n');
		expect(() => loadMixCodeSettings(file)).toThrow(/ui\.inlineWidgets must be a boolean/);
		expect(() => loadMixCodeSettings(file)).toThrow(file);
	});

	it("reports unreadable JSON against the file", () => {
		const file = join(tempDir(), "mixcode_settings.json");
		writeFileSync(file, "{ not json");
		expect(() => loadMixCodeSettings(file)).toThrow(file);
	});

	it("defaults inline widgets to on when the file has no ui section", () => {
		const file = join(tempDir(), "mixcode_settings.json");
		writeFileSync(file, "{\n}\n");
		expect(loadMixCodeSettings(file).ui.inlineWidgets).toBe(true);
	});

	it("writes the field and preserves the keys it does not own", () => {
		const file = join(tempDir(), "mixcode_settings.json");
		writeFileSync(file, '{\n  "theme": "dark",\n  "history": { "maxBytes": 10 }\n}\n');
		writeInlineWidgetsSetting(file, true);

		expect(JSON.parse(readFileSync(file, "utf-8"))).toEqual({
			theme: "dark",
			history: { maxBytes: 10 },
			ui: { inlineWidgets: true },
		});
		expect(readFileSync(file, "utf-8").endsWith("\n")).toBe(true);
	});

	it("keeps the neighbouring ui keys another agent wrote there", () => {
		const file = join(tempDir(), "mixcode_settings.json");
		writeFileSync(file, '{\n  "ui": { "icons": { "mode": "ascii" }, "inlineWidgets": true }\n}\n');
		writeInlineWidgetsSetting(file, false);

		expect(JSON.parse(readFileSync(file, "utf-8"))).toEqual({
			ui: { icons: { mode: "ascii" }, inlineWidgets: false },
		});
	});

	it("creates the file and its directory when neither exists", () => {
		const file = join(tempDir(), "mixcode-pi", "mixcode_settings.json");
		writeInlineWidgetsSetting(file, false);

		expect(JSON.parse(readFileSync(file, "utf-8"))).toEqual({ ui: { inlineWidgets: false } });
	});

	it("defaults the meta row to Nerd Font glyphs", () => {
		const file = join(tempDir(), "mixcode_settings.json");
		expect(loadMixCodeSettings(file).ui.icons.mode).toBe("nerd");
	});

	it("reads an explicit icon mode", () => {
		const file = join(tempDir(), "mixcode_settings.json");
		writeFileSync(file, '{\n  "ui": { "icons": { "mode": "ascii" } }\n}\n');
		expect(loadMixCodeSettings(file).ui.icons.mode).toBe("ascii");
	});

	it("names the file and field when the icon mode is unknown", () => {
		const file = join(tempDir(), "mixcode_settings.json");
		writeFileSync(file, '{\n  "ui": { "icons": { "mode": "nerdfont" } }\n}\n');
		expect(() => loadMixCodeSettings(file)).toThrow(/ui\.icons\.mode must be one of auto, nerd, ascii/);
		expect(() => loadMixCodeSettings(file)).toThrow(file);
	});

	it("writes the icon mode without dropping the icon keys mixcode-pi owns", () => {
		const file = join(tempDir(), "mixcode_settings.json");
		writeFileSync(file, '{\n  "ui": { "icons": { "mode": "ascii", "glyphSet": "custom" } }\n}\n');
		writeIconModeSetting(file, "auto");

		expect(JSON.parse(readFileSync(file, "utf-8"))).toEqual({
			ui: { icons: { mode: "auto", glyphSet: "custom" } },
		});
	});

	it("stores the file in the state directory shared with mixcode-pi", () => {
		const dir = tempDir();
		vi.stubEnv("PI_CODING_AGENT_DIR", dir);
		try {
			expect(mixcodeSettingsFilePath()).toBe(join(dir, "mixcode-pi", "mixcode_settings.json"));
		} finally {
			vi.unstubAllEnvs();
		}
	});
});

describe("/settings inline widgets row", () => {
	beforeAll(() => {
		initTheme("dark");
		setKeybindings(new KeybindingsManager());
	});

	it("sits in its own Mixcode section and cycles the value", () => {
		const onInlineWidgetsChange = vi.fn();
		const config = {
			autoCompact: true,
			cacheWarmingMode: "off",
			collapseChangelog: false,
			defaultModel: "not set",
			availableDefaultModels: [],
			modelThinkingLevels: {},
			currentTheme: "dark",
			terminalTheme: "dark",
			availableThemes: [],
			defaultProjectTrust: "ask",
			doubleEscapeAction: "tree",
			enableInstallTelemetry: false,
			followUpMode: "all",
			fullscreenCopyOnSelect: true,
			fullscreenExitOutput: "transcript",
			fullscreenScrollbar: "auto",
			hideThinkingBlock: true,
			httpIdleTimeoutMs: 300_000,
			mermaidRenderingMode: "off",
			quietStartup: false,
			showCacheMissNotices: true,
			steeringMode: "all",
			thinkingLevel: "medium",
			transport: "auto",
			treeFilterMode: "default",
			tuiMode: "regular",
			warnings: {},
			inlineWidgets: true,
			iconMode: "nerd",
		} as unknown as SettingsConfig;
		const callbacks = { onInlineWidgetsChange } as unknown as SettingsCallbacks;
		const list = new SettingsSelectorComponent(config, callbacks).getSettingsList();

		list.selectItem("inline-widgets");
		const rendered = stripAnsi(list.render(120).join("\n"));
		expect(rendered).toContain("MixCode");
		expect(rendered).toContain("Inline widgets");
		// The section heading sits above the row it groups.
		expect(rendered.indexOf("MixCode")).toBeLessThan(rendered.indexOf("Inline widgets"));

		list.handleInput("\r");
		expect(onInlineWidgetsChange.mock.calls.flat()).toEqual([false]);
		list.handleInput("\r");
		expect(onInlineWidgetsChange.mock.calls.flat()).toEqual([false, true]);
	});

	it("flips every open tab and writes the global default to disk", () => {
		const dir = tempDir();
		vi.stubEnv("PI_CODING_AGENT_DIR", dir);
		try {
			const openTab = createInlineWidgetTabState(true);
			const otherTab = createInlineWidgetTabState(true);
			const warnings: string[] = [];
			const context = {
				mixcodeSettings: { ui: { inlineWidgets: true } } as MixCodeSettings,
				inlineWidgetTabStates: new Map<string, InlineWidgetTabState>([
					["a", openTab],
					["b", otherTab],
				]),
				refreshInlineWidgets: () => {},
				showWarning: (message: string) => warnings.push(message),
			};
			const setInlineWidgetsGlobal = (
				InteractiveMode.prototype as unknown as {
					setInlineWidgetsGlobal(this: typeof context, enabled: boolean): void;
				}
			).setInlineWidgetsGlobal;

			setInlineWidgetsGlobal.call(context, false);

			expect(openTab.enabled).toBe(false);
			expect(otherTab.enabled).toBe(false);
			expect(warnings).toEqual([]);
			const file = join(dir, "mixcode-pi", "mixcode_settings.json");
			expect(existsSync(file)).toBe(true);
			expect(JSON.parse(readFileSync(file, "utf-8"))).toEqual({ ui: { inlineWidgets: false } });
			expect(loadMixCodeSettings(file).ui.inlineWidgets).toBe(false);
		} finally {
			vi.unstubAllEnvs();
		}
	});
});
