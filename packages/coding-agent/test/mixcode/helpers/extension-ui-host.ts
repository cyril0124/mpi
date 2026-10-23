import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Agent } from "@earendil-works/pi-agent-core";
import {
	type AutocompleteProvider,
	CombinedAutocompleteProvider,
	type Component,
	Container,
	type EditorComponent,
	Text,
	TuiMainScreen,
} from "@earendil-works/pi-tui";
import { VirtualTerminal } from "../../../../tui/test/virtual-terminal.ts";
import { AgentSession } from "../../../src/core/agent-session.ts";
import { AuthStorage } from "../../../src/core/auth-storage.ts";
import type { WorkingIndicatorOptions } from "../../../src/core/extensions/index.ts";
import { FooterDataProvider } from "../../../src/core/footer-data-provider.ts";
import { KeybindingsManager } from "../../../src/core/keybindings.ts";
import { ModelRuntime } from "../../../src/core/model-runtime.ts";
import { DefaultResourceLoader } from "../../../src/core/resource-loader.ts";
import { SessionManager, sessionEntryToContextMessages } from "../../../src/core/session-manager.ts";
import { SettingsManager } from "../../../src/core/settings-manager.ts";
import { FooterComponent } from "../../../src/modes/interactive/components/footer.ts";
import { MixcodePromptEditor } from "../../../src/modes/interactive/components/mixcode/input-dock/prompt-editor.ts";
import type {
	ExtensionUiController,
	ExtensionUiHost,
	TabExtensionUi,
	TabScopedExtensionUiHost,
} from "../../../src/modes/interactive/mixcode/extensions/extension-ui-controller.ts";
import { getEditorTheme, initTheme } from "../../../src/modes/interactive/theme/theme.ts";
import { InteractiveThemeController } from "../../../src/modes/interactive/theme/theme-controller.ts";
import { stripAnsi } from "../../../src/utils/ansi.ts";

/** Complete controller host with real render, input, editor and footer collaborators. */
export class ExtensionUiTestHost implements ExtensionUiHost {
	readonly terminal = new VirtualTerminal(100, 36);
	readonly ui = new TuiMainScreen(this.terminal);
	readonly keybindings = new KeybindingsManager();
	readonly defaultEditor = new MixcodePromptEditor(this.ui, getEditorTheme(), this.keybindings);
	editor: EditorComponent = this.defaultEditor;
	readonly editorContainer = new Container();
	readonly footerContainer = new Container();
	readonly headerContainer = new Container();
	readonly builtInHeader: Component = new Text("Extension UI workflow", 0, 0);
	readonly transcriptContainer = new Container();
	readonly home = new Text("HOME", 0, 0);
	readonly footerDataProvider: FooterDataProvider;
	readonly footer: FooterComponent;
	readonly themeController: InteractiveThemeController;
	autocompleteProvider: AutocompleteProvider | undefined;
	activeSelectorToken: object | undefined;
	workingMessage: string | undefined;
	workingVisible = true;
	workingIndicatorOptions: WorkingIndicatorOptions | undefined;
	hiddenThinkingLabel: string | undefined;
	toolOutputExpanded = false;
	activeTabIdForUi: string | undefined;
	homeActive = false;
	readonly shown: Array<{ tabId: string | undefined; message: string; type: "info" | "warning" | "error" }> = [];
	readonly actions: string[] = [];
	readonly loadingTabs = new Map<string, NonNullable<ReturnType<ExtensionUiHost["getLoadingTab"]>>>();
	private readonly transcripts = new Map<string, Container>();
	private controller: ExtensionUiController | undefined;
	readonly session: AgentSession;
	readonly settingsManager: SettingsManager;
	readonly cwd: string;

	constructor(session: AgentSession, cwd: string) {
		this.session = session;
		this.settingsManager = session.settingsManager;
		this.cwd = cwd;
		this.footerDataProvider = new FooterDataProvider(cwd);
		this.footer = new FooterComponent(session, this.footerDataProvider);
		this.themeController = new InteractiveThemeController(this.ui, {
			getSettingsManager: () => this.settingsManager,
			showError: (message) => this.showError(message),
			onChanged: () => this.ui.requestRender(),
			initialThemeSetting: "dark",
		});
		this.headerContainer.addChild(this.builtInHeader);
		this.editorContainer.addChild(this.editor);
		this.footerContainer.addChild(this.footer);
	}

	/** Wire a directly constructed controller into the live render and autocomplete surfaces. */
	bindController(controller: ExtensionUiController): void {
		this.controller = controller;
		const widgets = (placement: "above" | "below"): Component => ({
			render: (width) => {
				if (this.homeActive) return [];
				const map = placement === "above" ? controller.extensionWidgetsAbove : controller.extensionWidgetsBelow;
				return [...map.values()].flatMap((widget) => widget.render(width));
			},
			invalidate: () => {},
		});
		const tabSurface = (component: Component): Component => ({
			render: (width) => (this.homeActive ? [] : component.render(width)),
			invalidate: () => component.invalidate(),
		});
		this.ui.addChild(this.headerContainer);
		this.ui.addChild({
			render: (width) => (this.homeActive ? this.home.render(width) : this.transcriptContainer.render(width)),
			invalidate: () => this.transcriptContainer.invalidate(),
		});
		this.ui.addChild(widgets("above"));
		this.ui.addChild(tabSurface(this.editorContainer));
		this.ui.addChild(widgets("below"));
		this.ui.addChild(tabSurface(this.footerContainer));
		this.ui.setFocus(this.editor);
		this.ui.start();
	}

	/** Follow collection replacements and replay notices after the owning transcript mounts. */
	switchTab(tabId: string): void {
		const controller = this.requireController();
		if (this.activeTabIdForUi !== undefined) controller.detachTabUi(this.activeTabIdForUi);
		this.homeActive = false;
		this.activeTabIdForUi = tabId;
		controller.activeTabIdForUi = tabId;
		let transcript = this.transcripts.get(tabId);
		if (!transcript) {
			transcript = new Container();
			this.transcripts.set(tabId, transcript);
		}
		this.transcriptContainer.clear();
		this.transcriptContainer.addChild(transcript);
		controller.attachTabUi(tabId);
		controller.focusTabInteractions(tabId);
	}

	/** Supply every tab-scoped collaborator using the controller's exact method types. */
	createTabScope(): TabScopedExtensionUiHost {
		const host = this;
		const controller = this.requireController();
		return {
			ui: this.ui,
			get homeActive() {
				return host.homeActive;
			},
			get activeTabIdForUi() {
				return host.activeTabIdForUi;
			},
			createExtensionUIContext: controller.createExtensionUIContext.bind(controller),
			tabExtensionUi: controller.tabExtensionUi.bind(controller),
			showExtensionNotify: controller.showExtensionNotify.bind(controller),
			buildExtensionWidget: controller.buildExtensionWidget.bind(controller),
			withLoadingPhase: controller.withLoadingPhase.bind(controller),
			showExtensionSelector: controller.showExtensionSelector.bind(controller),
			showExtensionConfirm: controller.showExtensionConfirm.bind(controller),
			showExtensionInput: controller.showExtensionInput.bind(controller),
			showExtensionCustom: controller.showExtensionCustom.bind(controller),
			showExtensionEditor: controller.showExtensionEditor.bind(controller),
		};
	}

	shownTabId(): string | undefined {
		return this.activeTabIdForUi;
	}
	isHomeActive(): boolean {
		return this.homeActive;
	}
	getLoadingTab(tabId: string): ReturnType<ExtensionUiHost["getLoadingTab"]> {
		return this.loadingTabs.get(tabId);
	}
	disposeActiveSelector(): void {
		this.activeSelectorToken = undefined;
	}
	setupAutocompleteProvider(): void {
		let provider: AutocompleteProvider = new CombinedAutocompleteProvider([], this.cwd);
		for (const factory of this.requireController().autocompleteProviderWrappers) provider = factory(provider);
		this.autocompleteProvider = provider;
		this.editor.setAutocompleteProvider?.(provider);
	}
	parkFooterForHome(): void {
		this.ui.requestRender();
	}
	applyTabWorkingState(state: TabExtensionUi | undefined): void {
		this.workingMessage = state?.workingMessage;
		this.workingVisible = state?.workingVisible ?? true;
		this.workingIndicatorOptions = state?.workingIndicatorOptions;
		this.hiddenThinkingLabel = state?.hiddenThinkingLabel;
		this.toolOutputExpanded = state?.toolsExpanded ?? false;
	}
	setWorkingMessage(message?: string): void {
		this.workingMessage = message;
		this.ui.requestRender();
	}
	resetWorkingMessage(): void {
		this.setWorkingMessage();
	}
	setWorkingVisible(visible: boolean): void {
		this.workingVisible = visible;
		this.ui.requestRender();
	}
	setWorkingIndicator(options?: WorkingIndicatorOptions): void {
		this.workingIndicatorOptions = options;
		this.ui.requestRender();
	}
	setHiddenThinkingLabel(label?: string): void {
		this.hiddenThinkingLabel = label;
		this.ui.requestRender();
	}
	setToolsExpanded(expanded: boolean): void {
		this.toolOutputExpanded = expanded;
		this.ui.requestRender();
	}
	toggleToolOutputExpansion(): void {
		this.setToolsExpanded(!this.toolOutputExpanded);
	}
	refreshEditorStatus(): void {
		this.ui.requestRender();
	}

	/** Seed the mounted editor from the bound session's user messages, as the host does. */
	syncEditorHistory(): void {
		const texts = this.session.sessionManager
			.buildContextEntries()
			.flatMap(sessionEntryToContextMessages)
			.flatMap((message) =>
				message.role === "user" && typeof message.content === "string" ? [message.content] : [],
			);
		this.editor.setHistory?.(texts);
	}
	updateTerminalTitle(): void {
		this.terminal.setTitle(this.activeTabIdForUi ?? "Extension UI workflow");
	}
	requestWidgetRender(): void {
		this.ui.requestRender();
	}
	showError(message: string): void {
		this.showNotice(message, "error");
	}
	showWarning(message: string): void {
		this.showNotice(message, "warning");
	}
	showStatus(message: string): void {
		this.showNotice(message, "info");
	}
	handleTabCycle(delta: number): boolean {
		this.actions.push(`tab-cycle:${delta}`);
		return true;
	}
	/** This host never hides the bar; the zen routing is pinned in `extension-dialog-shortcuts.test.ts`. */
	tabBarHidden(): boolean {
		return false;
	}
	handleTabJumpShortcut(): void {
		this.actions.push("tab-jump");
	}
	async handleNewTab(): Promise<void> {
		this.actions.push("tab-new");
	}
	async handleCloseTab(): Promise<void> {
		this.actions.push("tab-close");
	}
	handlePaletteShortcut(): void {
		this.actions.push("palette");
	}
	showQuitConfirm(): void {
		this.actions.push("quit-confirm");
	}

	/** Capture the rendered terminal after queued writes settle. */
	async capture(): Promise<string> {
		this.ui.requestRender();
		await this.terminal.waitForRender();
		return this.terminal.getViewport().map(stripAnsi).join("\n");
	}

	/** Release listeners, widgets, session collaborators and the fixture's isolated directory. */
	dispose(): void {
		if (this.controller) {
			this.controller.resetExtensionUI();
			for (const tabId of this.controller.tabUi.keys()) this.controller.disposeTabUi(tabId);
			this.controller.stop();
		}
		this.themeController.dispose();
		this.footer.dispose();
		this.footerDataProvider.dispose();
		this.session.dispose();
		this.ui.stop();
		rmSync(this.cwd, { recursive: true, force: true });
	}

	private requireController(): ExtensionUiController {
		if (!this.controller) throw new Error("Bind the ExtensionUiController before using the host");
		return this.controller;
	}

	private showNotice(message: string, type: "info" | "warning" | "error"): void {
		this.shown.push({ tabId: this.activeTabIdForUi, message, type });
		const transcript = this.activeTabIdForUi ? this.transcripts.get(this.activeTabIdForUi) : undefined;
		if (!transcript) throw new Error("A notice requires a mounted tab transcript");
		transcript.addChild(new Text(`${type}: ${message}`, 0, 0));
		this.ui.requestRender();
	}
}

/** Create a real session for FooterComponent without disk configuration, network or model calls. */
export async function createExtensionUiHost(): Promise<ExtensionUiTestHost> {
	initTheme("dark");
	const cwd = mkdtempSync(join(tmpdir(), "pi-extension-ui-host-"));
	try {
		const settingsManager = SettingsManager.inMemory({ theme: "dark" });
		const modelRuntime = await ModelRuntime.create({
			credentials: AuthStorage.inMemory(),
			modelsPath: null,
			allowModelNetwork: false,
			refreshOnCreate: false,
		});
		const session = new AgentSession({
			agent: new Agent({
				streamFn: () => {
					throw new Error("Extension UI workflows must not call a model");
				},
			}),
			sessionManager: SessionManager.inMemory(cwd),
			settingsManager,
			cwd,
			modelRuntime,
			initialActiveToolNames: [],
			resourceLoader: new DefaultResourceLoader({
				cwd,
				agentDir: cwd,
				settingsManager,
				noExtensions: true,
				noSkills: true,
				noPromptTemplates: true,
				noThemes: true,
				noContextFiles: true,
			}),
		});
		return new ExtensionUiTestHost(session, cwd);
	} catch (error) {
		rmSync(cwd, { recursive: true, force: true });
		throw error;
	}
}
