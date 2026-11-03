import {
	type AutocompleteProvider,
	type Component,
	Container,
	type EditorComponent,
	type OverlayHandle,
	type OverlayOptions,
	Text,
	type TUI,
} from "@earendil-works/pi-tui";
import type {
	AutocompleteProviderFactory,
	EditorFactory,
	ExtensionUIContext,
	ExtensionUIDialogOptions,
	ExtensionWidgetOptions,
	WorkingIndicatorOptions,
} from "../../../../core/extensions/index.ts";
import type { FooterDataProvider, ReadonlyFooterDataProvider } from "../../../../core/footer-data-provider.ts";
import type { KeybindingsManager } from "../../../../core/keybindings.ts";
import { setWaitingForInputCount } from "../../../../core/mixcode/extension-event-bus.ts";
import type { TabLoadingPhase } from "../../../../core/mixcode/multi-tab/types.ts";
import type { SettingsManager } from "../../../../core/settings-manager.ts";
import { ExtensionEditorComponent } from "../../components/extension-editor.ts";
import { ExtensionInputComponent } from "../../components/extension-input.ts";
import { ExtensionSelectorComponent, type ExtensionSelectorOptions } from "../../components/extension-selector.ts";
import type { FooterComponent } from "../../components/footer.ts";
import type { MixcodePromptEditor } from "../../components/mixcode/input-dock/prompt-editor.ts";
import { getAvailableThemesWithPaths, getEditorTheme, getThemeByName, Theme, theme } from "../../theme/theme.ts";
import type { InteractiveThemeController } from "../../theme/theme-controller.ts";

export type ExtensionFooterFactory = (
	tui: TUI,
	thm: Theme,
	footerData: ReadonlyFooterDataProvider,
) => Component & { dispose?(): void };

export type ExtensionHeaderFactory = (tui: TUI, thm: Theme) => Component & { dispose?(): void };

/** Extension-owned UI belonging to one tab, swapped when the tab becomes active. */
export interface TabExtensionUi {
	widgetsAbove: Map<string, Component & { dispose?(): void }>;
	widgetsBelow: Map<string, Component & { dispose?(): void }>;
	footerFactory: ExtensionFooterFactory | undefined;
	headerFactory: ExtensionHeaderFactory | undefined;
	statuses: Map<string, string>;
	autocompleteWrappers: AutocompleteProviderFactory[];
	editorFactory: EditorFactory | undefined;
	workingMessage: string | undefined;
	workingVisible: boolean;
	workingIndicatorOptions: WorkingIndicatorOptions | undefined;
	hiddenThinkingLabel: string | undefined;
	toolsExpanded: boolean;
	/** Notices an extension raised for this tab while it was not the focused one. */
	notices: Array<{ message: string; type?: "info" | "warning" | "error" }>;
}

/**
 * An extension interaction that belongs to one tab.
 *
 * An extension of one session opens it, and a session belongs to one tab, so the
 * surface it takes (the editor slot, or an overlay) is that tab's.
 */
export interface TabInteraction {
	/** Status reported while this interaction waits for an answer. */
	blocked?: { kind: "question" | "permission" | "auth"; message: string };
	/** Which surface the interaction took, which decides how it is parked. */
	kind: "selector" | "input" | "editor" | "custom" | "overlay";
	/** The tab that owns it, so a close can hand the slot back to what it parked. */
	tabId?: string;
	/** Draft a custom component displaced, read when it takes the slot. */
	savedDraft?: string;
	/** Component shown on the editor slot; undefined for an overlay interaction. */
	component?: Component & { dispose?(): void };
	/** True while `component` occupies the editor slot. */
	mounted: boolean;
	/** Overlay handle and whether it takes the keyboard; undefined for a slotted one. */
	overlay?: { handle: OverlayHandle; capturing: boolean };
	/** Drops the interaction from its tab's pending list. Set by `trackTabInteraction`. */
	untrack?: () => void;
}

/**
 * A terminal-input listener an extension asked for through `ctx.ui.onTerminalInput`, kept for
 * the tab that registered it across tab switches.
 */
export interface ExtensionTerminalInputSubscription {
	/** Tab that owns the listener; undefined in single-session mode, where it always answers. */
	tabId: string | undefined;
	handler: (data: string) => { consume?: boolean; data?: string } | undefined;
	/** Present only while the listener is registered with the renderer. */
	unsubscribe?: () => void;
}

/** Live host surfaces and actions. Getters must follow renderer, editor and session replacements. */
export interface ExtensionUiHost {
	readonly ui: TUI;
	editor: EditorComponent;
	readonly defaultEditor: MixcodePromptEditor;
	readonly editorContainer: Container;
	readonly footer: FooterComponent;
	readonly footerContainer: Container;
	readonly footerDataProvider: FooterDataProvider;
	readonly headerContainer: Container;
	readonly builtInHeader: Component | undefined;
	readonly keybindings: KeybindingsManager;
	readonly autocompleteProvider: AutocompleteProvider | undefined;
	readonly activeSelectorToken: object | undefined;
	workingMessage: string | undefined;
	workingVisible: boolean;
	workingIndicatorOptions: WorkingIndicatorOptions | undefined;
	hiddenThinkingLabel: string | undefined;
	toolOutputExpanded: boolean;
	readonly settingsManager: Pick<SettingsManager, "getExternalEditorCommand" | "getTheme" | "setTheme">;
	readonly themeController: Pick<InteractiveThemeController, "setThemeInstance" | "setThemeName">;
	setDialogBlocked?(blocked: TabInteraction["blocked"]): void;
	shownTabId(): string | undefined;
	isHomeActive(): boolean;
	getLoadingTab(tabId: string): { loading: boolean; loadingPhase?: TabLoadingPhase } | undefined;
	disposeActiveSelector(): void;
	setupAutocompleteProvider(): void;
	parkFooterForHome(replace?: boolean): void;
	applyTabWorkingState(state: TabExtensionUi | undefined): void;
	setWorkingMessage(message?: string): void;
	resetWorkingMessage(): void;
	setWorkingVisible(visible: boolean): void;
	setWorkingIndicator(options?: WorkingIndicatorOptions): void;
	setHiddenThinkingLabel(label?: string): void;
	setToolsExpanded(expanded: boolean): void;
	toggleToolOutputExpansion(): void;
	refreshEditorStatus(): void;
	/** Seed the mounted editor from the session and raw inputs belonging to this tab. */
	syncEditorHistory(): void;
	updateTerminalTitle(): void;
	requestWidgetRender(): void;
	showError(message: string): void;
	showWarning(message: string): void;
	showStatus(message: string): void;
	handleTabCycle(delta: number): boolean;
	/** True while the focused surface hides the tab bar, so a tab cycle answers nothing. */
	tabBarHidden(): boolean;
	handleTabJumpShortcut(): void;
	handleNewTab(): Promise<void>;
	handleCloseTab(): Promise<void>;
	handlePaletteShortcut(): void;
	showQuitConfirm(): void;
}

/** Collaborators for a context whose owner may be off screen while extensions bind. */
export interface TabScopedExtensionUiHost
	extends Pick<
		ExtensionUiController,
		| "createExtensionUIContext"
		| "tabExtensionUi"
		| "showExtensionNotify"
		| "buildExtensionWidget"
		| "withLoadingPhase"
		| "showExtensionSelector"
		| "showExtensionConfirm"
		| "showExtensionInput"
		| "showExtensionCustom"
		| "showExtensionEditor"
	> {
	readonly ui: TUI;
	readonly homeActive: boolean;
	readonly activeTabIdForUi: string | undefined;
}

interface Expandable {
	setExpanded(expanded: boolean): void;
}
function isExpandable(obj: unknown): obj is Expandable {
	return typeof obj === "object" && obj !== null && "setExpanded" in obj && typeof obj.setExpanded === "function";
}

/** Maximum string-array widget rows before its truncation notice. */
const MAX_WIDGET_LINES = 10;

/** Owns extension chrome, pending dialogs and raw input subscriptions across tab switches. */
export class ExtensionUiController {
	private readonly host: ExtensionUiHost;

	editorComponentFactory: EditorFactory | undefined;

	autocompleteProviderWrappers: AutocompleteProviderFactory[] = [];

	/** Pending extension interactions per tab: only the tab on screen mounts one. */
	tabInteractions = new Map<string, TabInteraction[]>();

	extensionTerminalInputSubscriptions = new Set<ExtensionTerminalInputSubscription>();

	/** Listener that answers the app's chrome shortcuts above a focused extension dialog. */
	private extensionDialogShortcutUnsubscribe?: () => void;

	extensionWidgetsAbove = new Map<string, Component & { dispose?(): void }>();

	extensionWidgetsBelow = new Map<string, Component & { dispose?(): void }>();

	private customFooter: (Component & { dispose?(): void }) | undefined = undefined;

	private customFooterFactory: ExtensionFooterFactory | undefined = undefined;

	private customHeaderFactory: ExtensionHeaderFactory | undefined = undefined;

	/** Per-tab extension UI (widgets, footer/header, statuses), swapped on tab switch. */
	tabUi = new Map<string, TabExtensionUi>();

	/** Tab whose extension UI is currently mounted; used to capture state on switch. */
	activeTabIdForUi: string | undefined = undefined;

	customHeader: (Component & { dispose?(): void }) | undefined = undefined;

	constructor(host: ExtensionUiHost) {
		this.host = host;
	}

	/**
	 * Extension UI context for a tab whose chrome is not mounted yet. The chrome an
	 * extension installs (widgets, footer and header, statuses, autocomplete
	 * wrappers, editor component, working message, thinking label) is recorded on the
	 * tab and mounted when the tab takes focus. A surface the tab already owns on
	 * screen is written live instead, so a background bind does not defer it: a notice
	 * follows the transcript, a status replaces the one the footer shows, and the
	 * working surface is applied to the renderer already showing the tab. Any other
	 * tab records it for its next mount. A dialog or an editor takeover is that tab's
	 * own surface too: it parks on the tab and shows when the tab takes focus.
	 */
	static createTabScopedExtensionUIContext(scope: TabScopedExtensionUiHost, tabId: string): ExtensionUIContext {
		const live = scope.createExtensionUIContext(tabId);
		/** True while this tab's chrome is the one mounted, so a record write must reach it too. */
		const tabOnScreen = (): boolean => !scope.homeActive && scope.activeTabIdForUi === tabId;
		return {
			...live,
			get theme() {
				return theme;
			},
			notify: (message, type) => {
				// A tab that owns the mounted transcript paints the notice at once, like the
				// startup session. Any other tab has nowhere to put it until its next focus.
				if (tabOnScreen()) {
					scope.showExtensionNotify(message, type);
					return;
				}
				scope.tabExtensionUi(tabId).notices.push({ message, type });
			},
			// A mounted tab takes its working surface live. The record alone only lands on the next
			// mount, which the tab in front never gets, and leaving the tab overwrites the record with
			// the live fields, so the value would be gone for good.
			setWorkingMessage: (message) => {
				scope.tabExtensionUi(tabId).workingMessage = message;
				if (tabOnScreen()) live.setWorkingMessage(message);
			},
			setWorkingVisible: (visible) => {
				scope.tabExtensionUi(tabId).workingVisible = visible;
				if (tabOnScreen()) live.setWorkingVisible(visible);
			},
			setWorkingIndicator: (options) => {
				scope.tabExtensionUi(tabId).workingIndicatorOptions = options;
				if (tabOnScreen()) live.setWorkingIndicator(options);
			},
			setHiddenThinkingLabel: (label) => {
				scope.tabExtensionUi(tabId).hiddenThinkingLabel = label;
				if (tabOnScreen()) live.setHiddenThinkingLabel(label);
			},
			setToolsExpanded: (expanded) => {
				scope.tabExtensionUi(tabId).toolsExpanded = expanded;
				if (tabOnScreen()) live.setToolsExpanded(expanded);
			},
			setStatus: (key: string, text: string | undefined) => {
				const ui = scope.tabExtensionUi(tabId);
				if (text === undefined) ui.statuses.delete(key);
				else ui.statuses.set(key, text);
				// The footer keeps its own copy of the statuses and re-reads the tab's record
				// only on mount, so write the mounted tab's footer as well.
				if (tabOnScreen()) live.setStatus(key, text);
			},
			setWidget: (
				key: string,
				content: string[] | ((tui: TUI, thm: Theme) => Component & { dispose?(): void }) | undefined,
				widgetOptions?: ExtensionWidgetOptions,
			) => {
				const ui = scope.tabExtensionUi(tabId);
				for (const map of [ui.widgetsAbove, ui.widgetsBelow]) {
					const existing = map.get(key);
					existing?.dispose?.();
					map.delete(key);
				}
				if (content === undefined) return;
				const component = Array.isArray(content) ? scope.buildExtensionWidget(content) : content(scope.ui, theme);
				const target = widgetOptions?.placement === "belowEditor" ? ui.widgetsBelow : ui.widgetsAbove;
				target.set(key, component);
			},
			setFooter: (factory) => {
				scope.tabExtensionUi(tabId).footerFactory = factory;
			},
			setHeader: (factory) => {
				scope.tabExtensionUi(tabId).headerFactory = factory;
			},
			setTitle: () => {
				// Background contexts cannot change the focused tab's terminal title.
			},
			addAutocompleteProvider: (factory) => {
				scope.tabExtensionUi(tabId).autocompleteWrappers.push(factory);
			},
			getEditorComponent: () => scope.tabExtensionUi(tabId).editorFactory,
			setEditorComponent: (factory) => {
				scope.tabExtensionUi(tabId).editorFactory = factory;
			},
			getToolsExpanded: () => scope.tabExtensionUi(tabId).toolsExpanded,
			// A dialog parks the bind, so the chip names this phase while it is open.
			select: (title, options, opts) =>
				scope.withLoadingPhase(tabId, () => scope.showExtensionSelector(title, options, opts, tabId)),
			confirm: (title, message, opts) =>
				scope.withLoadingPhase(tabId, () => scope.showExtensionConfirm(title, message, opts, tabId)),
			input: (title, placeholder, opts) =>
				scope.withLoadingPhase(tabId, () => scope.showExtensionInput(title, placeholder, opts, tabId)),
			custom: (factory, options) =>
				scope.withLoadingPhase(tabId, () => scope.showExtensionCustom(factory, options, tabId)),
			editor: (title, prefill) =>
				scope.withLoadingPhase(tabId, () => scope.showExtensionEditor(title, prefill, tabId)),
		};
	}

	/**
	 * Mark a loading tab as parked on an extension dialog while `run` is pending,
	 * then hand it back to `resources`. A dialog opened outside a loading tab is
	 * left alone, so the phase never leaks onto a ready tab.
	 */
	withLoadingPhase<T>(tabId: string, run: () => Promise<T>): Promise<T> {
		const tab = this.host.getLoadingTab(tabId);
		if (!tab?.loading) return run();
		const restore = () => {
			if (tab.loading) tab.loadingPhase = "resources";
			this.host.ui.requestRender();
		};
		tab.loadingPhase = "waiting for input";
		this.host.ui.requestRender();
		try {
			return run().finally(restore);
		} catch (error) {
			restore();
			throw error;
		}
	}

	/** The extension-UI record of a tab, created on first use. */
	tabExtensionUi(tabId: string): TabExtensionUi {
		let ui = this.tabUi.get(tabId);
		if (!ui) {
			ui = {
				widgetsAbove: new Map(),
				widgetsBelow: new Map(),
				footerFactory: undefined,
				headerFactory: undefined,
				statuses: new Map(),
				autocompleteWrappers: [],
				editorFactory: undefined,
				workingMessage: undefined,
				workingVisible: true,
				workingIndicatorOptions: undefined,
				hiddenThinkingLabel: undefined,
				toolsExpanded: false,
				notices: [],
			};
			this.tabUi.set(tabId, ui);
		}
		return ui;
	}

	/**
	 * Answer the app's chrome shortcuts while an extension dialog owns the keyboard. A dialog
	 * an extension opens takes the keyboard from the composer, either as a capturing overlay or
	 * in the editor slot (`select`, `confirm`, `input`, `editor`, `custom`), so every action
	 * bound with `defaultEditor.onAction` goes dead until it closes. Tab is answered here even
	 * though a dialog may want it: Tab switches agent tabs on every surface in this fork, and a
	 * dialog keeps its arrow keys for its own navigation.
	 *
	 * Zen is the exception: the bar is hidden there, so the cycle would consume tab and answer
	 * nothing on its way to the dialog. The dialog keeps tab and shift+tab instead.
	 */
	handleExtensionDialogShortcut(data: string): { consume: boolean } | undefined {
		if (!this.hasFocusedExtensionDialog()) return undefined;
		const isTabNext = this.host.keybindings.matches(data, "app.tab.next");
		const isTabPrevious = this.host.keybindings.matches(data, "app.tab.previous");
		if ((isTabNext || isTabPrevious) && this.host.tabBarHidden()) return undefined;
		if (isTabNext) this.host.handleTabCycle(1);
		else if (isTabPrevious) this.host.handleTabCycle(-1);
		else if (this.host.keybindings.matches(data, "app.tab.jump")) this.host.handleTabJumpShortcut();
		else if (this.host.keybindings.matches(data, "app.tab.new")) void this.host.handleNewTab();
		else if (this.host.keybindings.matches(data, "app.tab.close")) void this.host.handleCloseTab();
		else if (this.host.keybindings.matches(data, "app.palette")) this.host.handlePaletteShortcut();
		else if (this.host.keybindings.matches(data, "app.quit")) this.host.showQuitConfirm();
		else return undefined;
		return { consume: true };
	}

	/**
	 * Whether an extension dialog currently owns the keyboard: an overlay that holds focus, or a
	 * dialog in the editor slot of the tab on screen.
	 *
	 * A slotted dialog takes focus like an overlay does but is not in the overlay stack, so checking
	 * the overlays alone leaves its keys unanswered and the chrome shortcuts dead. The fork's own
	 * slotted selectors (tree, model, resume) are not extension interactions and stay out of this
	 * test; their components own their keys on purpose. A capturing overlay stacked above a slotted
	 * dialog keeps the keyboard for itself.
	 */
	hasFocusedExtensionDialog(): boolean {
		const anotherOverlayHoldsKeyboard = this.host.ui.hasCapturingOverlay();
		for (const [tabId, interactions] of this.tabInteractions) {
			for (const interaction of interactions) {
				if (interaction.overlay !== undefined) {
					if (interaction.overlay.handle.isFocused()) return true;
					continue;
				}
				const slottedDialogOnScreen = interaction.mounted && this.tabShowsOnScreen(tabId);
				if (slottedDialogOnScreen && !anotherOverlayHoldsKeyboard) return true;
			}
		}
		return false;
	}

	/**
	 * The live extension chrome as a tab record: the mounted tab holds its chrome in these fields, and
	 * the record is how that chrome survives a switch.
	 */
	private liveTabUiRecord(tabId: string): TabExtensionUi {
		return {
			widgetsAbove: this.extensionWidgetsAbove,
			widgetsBelow: this.extensionWidgetsBelow,
			footerFactory: this.customFooterFactory,
			headerFactory: this.customHeaderFactory,
			statuses: new Map(this.host.footerDataProvider.getExtensionStatuses()),
			autocompleteWrappers: this.autocompleteProviderWrappers,
			editorFactory: this.editorComponentFactory,
			workingMessage: this.host.workingMessage,
			workingVisible: this.host.workingVisible,
			workingIndicatorOptions: this.host.workingIndicatorOptions,
			hiddenThinkingLabel: this.host.hiddenThinkingLabel,
			toolsExpanded: this.host.toolOutputExpanded,
			notices: this.tabUi.get(tabId)?.notices ?? [],
		};
	}

	/** Move the active tab's extension UI aside (widgets are kept alive, not disposed). */
	detachTabUi(tabId: string): void {
		const leavingHeader = this.customHeader;
		this.tabUi.set(tabId, this.liveTabUiRecord(tabId));
		// Footer/header are rebuilt from their factories on re-attach, so dispose
		// the outgoing instances instead of orphaning them.
		this.customFooter?.dispose?.();
		this.customHeader?.dispose?.();
		this.extensionWidgetsAbove = new Map();
		this.extensionWidgetsBelow = new Map();
		this.customFooter = undefined;
		this.customFooterFactory = undefined;
		this.customHeader = undefined;
		this.customHeaderFactory = undefined;
		this.autocompleteProviderWrappers = [];
		this.editorComponentFactory = undefined;
		this.host.workingMessage = undefined;
		this.host.workingVisible = true;
		this.host.workingIndicatorOptions = undefined;
		this.host.hiddenThinkingLabel = undefined;
		this.host.toolOutputExpanded = false;
		this.host.footerDataProvider.clearExtensionStatuses();
		// The tab's pending dialogs park with it: the extension still waits for its answer, the
		// dialog comes back with the tab, and the chip reports the wait meanwhile. An overlay of
		// this tab stays in the stack, where its focus gate keeps it off the screen.
		this.parkTabInteractions(tabId);
		this.detachExtensionTerminalInputListeners(tabId);
		this.host.defaultEditor.onExtensionShortcut = undefined;
		this.restoreBuiltInChrome(leavingHeader);
	}

	/** Mount a tab's extension UI into the live fields. */
	attachTabUi(tabId: string): void {
		const parkedUi = this.tabUi.get(tabId);
		// A session replacement drops the mounted tab's record, and the tab's extensions install again
		// through the focus it keeps, so the live fields are its chrome then. Mounting an empty record
		// instead would drop the footer, statuses, widgets and editor they installed.
		const ui = parkedUi === undefined && this.activeTabIdForUi === tabId ? this.liveTabUiRecord(tabId) : parkedUi;
		this.extensionWidgetsAbove = ui?.widgetsAbove ?? new Map();
		this.extensionWidgetsBelow = ui?.widgetsBelow ?? new Map();
		this.customFooter = undefined;
		this.customFooterFactory = undefined;
		this.customHeader = undefined;
		this.customHeaderFactory = undefined;
		this.autocompleteProviderWrappers = ui?.autocompleteWrappers ?? [];
		this.host.applyTabWorkingState(ui);
		this.host.footerDataProvider.clearExtensionStatuses();
		for (const [key, value] of ui?.statuses ?? []) this.host.footerDataProvider.setExtensionStatus(key, value);
		this.setExtensionFooter(ui?.footerFactory);
		this.setExtensionHeader(ui?.headerFactory);
		this.setCustomEditorComponent(ui?.editorFactory);
		this.host.setupAutocompleteProvider();
		this.host.requestWidgetRender();
		this.host.footer.invalidate();
		// Notices an extension raised while this tab was not the focused one belong to
		// its transcript, which is mounted by now.
		if (ui && ui.notices.length > 0) {
			const notices = ui.notices;
			ui.notices = [];
			for (const notice of notices) this.showExtensionNotify(notice.message, notice.type);
		}
		this.attachExtensionTerminalInputListeners(tabId);
	}

	/** Remove any custom footer/header and show the built-ins (without disposing the tab's copies). */
	private restoreBuiltInChrome(leavingHeader: (Component & { dispose?(): void }) | undefined): void {
		this.host.footerContainer.clear();
		this.host.footerContainer.addChild(this.host.footer);
		if (this.host.builtInHeader && leavingHeader) {
			const index = this.host.headerContainer.children.indexOf(leavingHeader);
			if (index >= 0) {
				if (isExpandable(this.host.builtInHeader))
					this.host.builtInHeader.setExpanded(this.host.toolOutputExpanded);
				this.host.headerContainer.children[index] = this.host.builtInHeader;
			}
		}
		this.host.requestWidgetRender();
	}

	/** Dispose and forget a closed tab's extension UI and its pending dialogs. */
	disposeTabUi(tabId: string): void {
		this.forgetTabInteractions(tabId);
		// A close no longer runs this tab's own scoped reset, so its terminal-input listeners
		// go with the rest of its UI here.
		this.clearExtensionTerminalInputListeners(tabId);
		const ui = this.tabUi.get(tabId);
		if (!ui) return;
		this.tabUi.delete(tabId);
		for (const widget of ui.widgetsAbove.values()) widget.dispose?.();
		for (const widget of ui.widgetsBelow.values()) widget.dispose?.();
	}

	setExtensionStatus(key: string, text: string | undefined): void {
		this.host.footerDataProvider.setExtensionStatus(key, text);
		this.host.ui.requestRender();
	}

	/**
	 * Wrap a string-array widget in the container the dock paints. Shared by the
	 * focused tab's setter and the record kept for a background tab.
	 */
	buildExtensionWidget(lines: string[]): Component & { dispose?(): void } {
		const container = new Container();
		for (const line of lines.slice(0, MAX_WIDGET_LINES)) {
			container.addChild(new Text(line, 1, 0));
		}
		if (lines.length > MAX_WIDGET_LINES) {
			container.addChild(new Text(theme.fg("muted", "... (widget truncated)"), 1, 0));
		}
		return container;
	}

	setExtensionWidget(
		key: string,
		content: string[] | ((tui: TUI, thm: Theme) => Component & { dispose?(): void }) | undefined,
		options?: ExtensionWidgetOptions,
	): void {
		const placement = options?.placement ?? "aboveEditor";
		const removeExisting = (map: Map<string, Component & { dispose?(): void }>) => {
			const existing = map.get(key);
			if (existing?.dispose) existing.dispose();
			map.delete(key);
		};

		removeExisting(this.extensionWidgetsAbove);
		removeExisting(this.extensionWidgetsBelow);

		if (content === undefined) {
			this.host.requestWidgetRender();
			return;
		}

		let component: Component & { dispose?(): void };

		if (Array.isArray(content)) {
			component = this.buildExtensionWidget(content);
		} else {
			component = content(this.host.ui, theme);
		}

		const targetMap = placement === "belowEditor" ? this.extensionWidgetsBelow : this.extensionWidgetsAbove;
		targetMap.set(key, component);
		this.host.requestWidgetRender();
	}

	clearExtensionWidgets(): void {
		for (const widget of this.extensionWidgetsAbove.values()) {
			widget.dispose?.();
		}
		for (const widget of this.extensionWidgetsBelow.values()) {
			widget.dispose?.();
		}
		this.extensionWidgetsAbove.clear();
		this.extensionWidgetsBelow.clear();
		this.host.requestWidgetRender();
	}

	resetExtensionUI(tabId?: string): void {
		// Extensions are going away, so the dialogs they wait on go with them: only an answered
		// dialog resolves, and none of these will be. A session replacement invalidates one tab's
		// extensions, so only that tab's dialogs are dropped; no tab given means every one.
		const doomed =
			tabId === undefined ? [...this.tabInteractions.values()].flat() : [...this.tabInteractionsFor(tabId)];
		for (const interaction of doomed) {
			interaction.overlay?.handle.hide();
			this.unmountTabInteraction(interaction);
			interaction.untrack?.();
			try {
				interaction.component?.dispose?.();
			} catch {
				/* A dialog that fails to dispose is already gone with its extension. */
			}
		}
		if (tabId === undefined) this.tabInteractions.clear();
		this.clearExtensionTerminalInputListeners(tabId);
		this.setExtensionFooter(undefined);
		this.setExtensionHeader(undefined);
		this.clearExtensionWidgets();
		this.host.footerDataProvider.clearExtensionStatuses();
		this.host.footer.invalidate();
		// The provider is rebuilt from the live wrapper array, while a tab-scoped extension context
		// pushes into its tab record, so the mounted tab needs both to be one array: a reloaded tab
		// never remounts, and a separate live array would miss every registration it makes.
		const resetCoversMountedTab = tabId === undefined || tabId === this.activeTabIdForUi;
		if (resetCoversMountedTab && this.activeTabIdForUi !== undefined) {
			const mountedRecord = this.tabExtensionUi(this.activeTabIdForUi);
			mountedRecord.autocompleteWrappers.length = 0;
			this.autocompleteProviderWrappers = mountedRecord.autocompleteWrappers;
		} else if (tabId === undefined) {
			this.autocompleteProviderWrappers.length = 0;
		} else {
			const resetRecord = this.tabUi.get(tabId);
			if (resetRecord) resetRecord.autocompleteWrappers.length = 0;
		}
		this.setCustomEditorComponent(undefined);
		this.host.setupAutocompleteProvider();
		this.host.defaultEditor.onExtensionShortcut = undefined;
		this.host.updateTerminalTitle();
		this.host.workingMessage = undefined;
		this.host.workingVisible = true;
		this.host.setWorkingIndicator();
		this.host.resetWorkingMessage();
		this.host.setHiddenThinkingLabel();
	}

	/**
	 * Whether an extension interaction owns the composer on the tab on screen. Keys already
	 * route to a mounted dialog through focus; this feeds the side panel, which must leave the
	 * wheel to the chat while a pending interaction is up, matching the input the chat would get.
	 * An overlay is not one of them: it takes the screen, which the overlay guards already cover.
	 */
	extensionUiPending(): boolean {
		if (this.host.activeSelectorToken !== undefined) return true;
		return this.tabInteractionsFor(this.host.shownTabId()).some((interaction) => interaction.mounted);
	}

	setExtensionFooter(
		factory:
			| ((tui: TUI, thm: Theme, footerData: ReadonlyFooterDataProvider) => Component & { dispose?(): void })
			| undefined,
	): void {
		this.customFooterFactory = factory;
		if (this.customFooter?.dispose) {
			this.customFooter.dispose();
		}

		this.host.footerContainer.clear();
		if (factory) {
			// The dock row is gone, so its pointer state goes with it: a cue kept
			// across the swap would light up cells the extension footer now paints.
			this.host.footer.invalidate();
			this.customFooter = factory(this.host.ui, theme, this.host.footerDataProvider);
			this.host.footerContainer.addChild(this.customFooter);
		} else {
			this.customFooter = undefined;
			this.host.footerContainer.addChild(this.host.footer);
		}

		// Home shows no footer: park whatever was just installed.
		if (this.host.isHomeActive()) this.host.parkFooterForHome(true);

		this.host.ui.requestRender();
	}

	setExtensionHeader(factory: ((tui: TUI, thm: Theme) => Component & { dispose?(): void }) | undefined): void {
		// Header may not be initialized yet if called during early initialization
		if (!this.host.builtInHeader) {
			return;
		}

		this.customHeaderFactory = factory;
		if (this.customHeader?.dispose) {
			this.customHeader.dispose();
		}

		const currentHeader = this.customHeader || this.host.builtInHeader;
		const index = this.host.headerContainer.children.indexOf(currentHeader);

		if (factory) {
			this.customHeader = factory(this.host.ui, theme);
			if (isExpandable(this.customHeader)) {
				this.customHeader.setExpanded(this.host.toolOutputExpanded);
			}
			if (index !== -1) {
				this.host.headerContainer.children[index] = this.customHeader;
			} else {
				this.host.headerContainer.children.unshift(this.customHeader);
			}
		} else {
			this.customHeader = undefined;
			if (isExpandable(this.host.builtInHeader)) {
				this.host.builtInHeader.setExpanded(this.host.toolOutputExpanded);
			}
			if (index !== -1) {
				this.host.headerContainer.children[index] = this.host.builtInHeader;
			}
		}

		this.host.ui.requestRender();
	}

	/**
	 * Register a listener an extension asked for through `ctx.ui.onTerminalInput`. One
	 * registered while its tab is off screen waits for `attachTabUi`, so it never answers
	 * keys meant for the tab in front.
	 */
	addExtensionTerminalInputListener(
		tabId: string | undefined,
		handler: (data: string) => { consume?: boolean; data?: string } | undefined,
	): () => void {
		const subscription: ExtensionTerminalInputSubscription = { tabId, handler };
		this.extensionTerminalInputSubscriptions.add(subscription);
		if (tabId === undefined || this.tabShowsOnScreen(tabId)) {
			subscription.unsubscribe = this.host.ui.addInputListener(handler);
		}
		return () => {
			subscription.unsubscribe?.();
			this.extensionTerminalInputSubscriptions.delete(subscription);
		};
	}

	/** Register the terminal listeners a tab's extensions asked for while it was off screen. */
	attachExtensionTerminalInputListeners(tabId: string): void {
		for (const subscription of this.extensionTerminalInputSubscriptions) {
			if (subscription.tabId !== tabId) continue;
			subscription.unsubscribe ??= this.host.ui.addInputListener(subscription.handler);
		}
	}

	/** Park a tab's terminal listeners; `attachTabUi` puts them back when the tab returns. */
	detachExtensionTerminalInputListeners(tabId: string): void {
		for (const subscription of this.extensionTerminalInputSubscriptions) {
			if (subscription.tabId !== tabId) continue;
			subscription.unsubscribe?.();
			subscription.unsubscribe = undefined;
		}
	}

	rebindExtensionTerminalInputListeners(): void {
		for (const subscription of this.extensionTerminalInputSubscriptions) {
			if (!subscription.unsubscribe) continue;
			subscription.unsubscribe();
			subscription.unsubscribe = this.host.ui.addInputListener(subscription.handler);
		}
	}

	/**
	 * Route the app's chrome shortcuts to the renderer now in use. The reference `host.ui`
	 * forwards every call to the current renderer, so a TUI-mode switch leaves the listener on
	 * the stopped renderer and the new one needs its own; dropping the previous one keeps a
	 * second registration from answering every key twice.
	 */
	registerExtensionDialogShortcutListener(): void {
		this.extensionDialogShortcutUnsubscribe?.();
		this.extensionDialogShortcutUnsubscribe = this.host.ui.addInputListener((data) =>
			this.handleExtensionDialogShortcut(data),
		);
	}

	/** Detach input hooks before the host stops its renderer. */
	stop(): void {
		this.clearExtensionTerminalInputListeners();
		this.extensionDialogShortcutUnsubscribe?.();
		this.extensionDialogShortcutUnsubscribe = undefined;
	}

	/** Drop the terminal listeners of a replaced tab, or every one when no tab is given. */
	clearExtensionTerminalInputListeners(tabId?: string): void {
		for (const subscription of [...this.extensionTerminalInputSubscriptions]) {
			if (tabId !== undefined && subscription.tabId !== tabId) continue;
			subscription.unsubscribe?.();
			this.extensionTerminalInputSubscriptions.delete(subscription);
		}
	}

	/**
	 * Extension UI context of the live surfaces.
	 *
	 * `ownerTabId` pins the dialogs it opens to one tab. Without it the context
	 * belongs to whatever tab the user is looking at when a dialog is requested,
	 * which is right for a context made on the spot (a shortcut handler) and wrong
	 * for one a session keeps, so a session bind passes its own tab, as a getter:
	 * a bind runs before its tab is registered, and the tab a later dialog belongs
	 * to is only known when the dialog is requested.
	 */
	createExtensionUIContext(ownerTabId?: string | (() => string | undefined)): ExtensionUIContext {
		const ownerTab = () => (typeof ownerTabId === "function" ? ownerTabId() : ownerTabId);
		const dialogTabId = () => ownerTab() ?? this.host.shownTabId();
		return {
			select: (title, options, opts) => this.showExtensionSelector(title, options, opts, dialogTabId()),
			confirm: (title, message, opts) => this.showExtensionConfirm(title, message, opts, dialogTabId()),
			input: (title, placeholder, opts) => this.showExtensionInput(title, placeholder, opts, dialogTabId()),
			notify: (message, type) => this.showExtensionNotify(message, type),
			onTerminalInput: (handler) => this.addExtensionTerminalInputListener(dialogTabId(), handler),
			setStatus: (key, text) => this.setExtensionStatus(key, text),
			setWorkingMessage: (message) => this.host.setWorkingMessage(message),
			setWorkingVisible: (visible) => this.host.setWorkingVisible(visible),
			setWorkingIndicator: (options) => this.host.setWorkingIndicator(options),
			setHiddenThinkingLabel: (label) => this.host.setHiddenThinkingLabel(label),
			setWidget: (key, content, options) => this.setExtensionWidget(key, content, options),
			setFooter: (factory) => this.setExtensionFooter(factory),
			setHeader: (factory) => this.setExtensionHeader(factory),
			setTitle: (title) => this.host.ui.terminal.setTitle(title),
			custom: (factory, options) => this.showExtensionCustom(factory, options, dialogTabId()),
			pasteToEditor: (text) => this.host.editor.handleInput(`\x1b[200~${text}\x1b[201~`),
			setEditorText: (text) => this.host.editor.setText(text),
			getEditorText: () => this.host.editor.getExpandedText?.() ?? this.host.editor.getText(),
			editor: (title, prefill) => this.showExtensionEditor(title, prefill, dialogTabId()),
			addAutocompleteProvider: (factory) => {
				this.autocompleteProviderWrappers.push(factory);
				this.host.setupAutocompleteProvider();
			},
			setEditorComponent: (factory) => this.setCustomEditorComponent(factory),
			getEditorComponent: () => this.editorComponentFactory,
			get theme() {
				return theme;
			},
			getAllThemes: () => getAvailableThemesWithPaths(),
			getTheme: (name) => getThemeByName(name),
			setTheme: (themeOrName) => {
				if (themeOrName instanceof Theme) {
					return this.host.themeController.setThemeInstance(themeOrName);
				}
				const result = this.host.themeController.setThemeName(themeOrName);
				if (result.success) {
					if (this.host.settingsManager.getTheme() !== themeOrName) {
						this.host.settingsManager.setTheme(themeOrName);
					}
				}
				return result;
			},
			getToolsExpanded: () => this.host.toolOutputExpanded,
			setToolsExpanded: (expanded) => this.host.setToolsExpanded(expanded),
		};
	}

	/** True while `tabId` is the tab the UI is showing, rather than Home or another tab. */
	private tabShowsOnScreen(tabId: string): boolean {
		return !this.host.isHomeActive() && this.host.shownTabId() === tabId;
	}

	/** True while an extension interaction on the tab waits on a human. */
	tabWaitingForInput(tabId: string): boolean {
		return (this.tabInteractions.get(tabId)?.length ?? 0) > 0;
	}

	/** The interactions pending on a tab, empty when it has none. */
	private tabInteractionsFor(tabId: string | undefined): readonly TabInteraction[] {
		return tabId === undefined ? [] : (this.tabInteractions.get(tabId) ?? []);
	}

	/**
	 * Register an interaction on its tab. A context without a tab (a host that
	 * supplies none) leaves it unscoped, which mounts it wherever the UI is.
	 */
	private trackTabInteraction(tabId: string | undefined, interaction: TabInteraction): void {
		if (tabId === undefined) return;
		interaction.tabId = tabId;
		const pending = this.tabInteractions.get(tabId);
		if (pending) pending.push(interaction);
		else this.tabInteractions.set(tabId, [interaction]);
		interaction.untrack = () => {
			const list = this.tabInteractions.get(tabId);
			if (!list) return;
			const index = list.indexOf(interaction);
			if (index >= 0) list.splice(index, 1);
			if (list.length === 0) this.tabInteractions.delete(tabId);
			this.syncWaitingInputCount();
			this.syncDialogBlocked();
			this.host.ui.requestRender();
		};
		this.syncWaitingInputCount();
		this.syncDialogBlocked();
	}

	/** Report the newest pending dialog without duplicating the per-tab interaction stacks. */
	private syncDialogBlocked(): void {
		const visible = this.host.isHomeActive() ? undefined : this.tabInteractionsFor(this.host.shownTabId()).at(-1);
		const pending = visible ?? [...this.tabInteractions.values()].flat().at(-1);
		this.host.setDialogBlocked?.(pending?.blocked);
	}

	/** Broadcast the process-wide count of extension dialogs waiting on a human. */
	private syncWaitingInputCount(): void {
		let count = 0;
		for (const pending of this.tabInteractions.values()) count += pending.length;
		setWaitingForInputCount(count);
	}

	/**
	 * Register an interaction and mount it when its tab is the one on screen. Any
	 * other tab parks it: the tab bar reports the wait, and the dialog appears the
	 * moment the user switches to it.
	 */
	private openTabInteraction(tabId: string | undefined, interaction: TabInteraction): void {
		this.trackTabInteraction(tabId, interaction);
		if (tabId === undefined || this.tabShowsOnScreen(tabId)) this.mountTabInteraction(tabId, interaction);
		this.host.ui.requestRender();
	}

	/** Drop an answered interaction: park it, dispose it, stop reporting the wait. */
	private closeTabInteraction(interaction: TabInteraction): void {
		interaction.overlay?.handle.hide();
		this.unmountTabInteraction(interaction);
		interaction.untrack?.();
		try {
			interaction.component?.dispose?.();
		} catch {
			/* A dialog that fails to dispose has already answered. */
		}
		this.remountParkedTabInteraction(interaction.tabId);
		this.host.ui.requestRender();
	}

	/**
	 * Put the dialog a closing one displaced back on the slot. A tab holds one dialog at a
	 * time, and the one it parked still waits for its own answer.
	 */
	private remountParkedTabInteraction(tabId: string | undefined): void {
		// A parked dialog returns only while its own tab is the one on screen: an extension
		// that closes its dialog from the background must not paint over the tab in front.
		if (tabId === undefined || !this.tabShowsOnScreen(tabId)) return;
		const pending = this.tabInteractionsFor(tabId);
		if (pending.some((interaction) => interaction.mounted)) return;
		const previous = pending.filter((interaction) => interaction.kind !== "overlay" && interaction.component).at(-1);
		if (previous) this.mountTabInteraction(tabId, previous);
	}

	/**
	 * Show a slotted interaction on the editor slot. A dialog of the same tab that is
	 * already on the slot is parked rather than disposed, and `remountParkedTabInteraction`
	 * hands the slot back to it when this one closes.
	 */
	private mountTabInteraction(tabId: string | undefined, interaction: TabInteraction): void {
		if (interaction.kind === "overlay" || interaction.mounted || !interaction.component) return;
		for (const other of this.tabInteractionsFor(tabId)) {
			if (other !== interaction) this.unmountTabInteraction(other);
		}
		// A custom component owns the composer from the moment it takes the slot, so the draft
		// it displaces is read here. Read at request time instead, it would hold the draft of
		// whichever tab was in front when a background tab asked for its dialog.
		if (interaction.kind === "custom") interaction.savedDraft ??= this.host.editor.getText();
		this.host.disposeActiveSelector();
		this.host.editorContainer.clear();
		this.host.editorContainer.addChild(interaction.component);
		this.host.ui.setFocus(interaction.component);
		interaction.mounted = true;
		this.host.ui.requestRender();
	}

	/** Take a dialog off the editor slot, keeping its component and its promise alive. */
	private unmountTabInteraction(interaction: TabInteraction): void {
		if (!interaction.mounted) return;
		interaction.mounted = false;
		this.host.editorContainer.clear();
		this.host.editorContainer.addChild(this.host.editor);
		this.host.ui.setFocus(this.host.editor);
		this.host.ui.requestRender();
	}

	/**
	 * Give a tab the dialogs that waited for it: mount its parked ones, then hand the
	 * keyboard to its newest overlay, which the tab switch took focus from.
	 */
	focusTabInteractions(tabId: string): void {
		// Home covers every tab, so a dialog waits for its tab to be shown again.
		if (!this.tabShowsOnScreen(tabId)) return;
		const pending = this.tabInteractionsFor(tabId);
		for (const interaction of pending) this.mountTabInteraction(tabId, interaction);
		const overlay = pending.filter((interaction) => interaction.overlay).at(-1);
		if (overlay?.overlay?.capturing) overlay.overlay.handle.focus();
		this.syncDialogBlocked();
	}

	/** Park a tab's dialogs when it loses focus. Overlays gate on focus instead of unmounting. */
	parkTabInteractions(tabId: string): void {
		for (const interaction of this.tabInteractionsFor(tabId)) this.unmountTabInteraction(interaction);
	}

	/** Forget a closed tab's interactions, leaving their components to the extension that owns them. */
	forgetTabInteractions(tabId: string): void {
		for (const interaction of this.tabInteractionsFor(tabId)) {
			// An overlay has no slot to unmount, and only its handle drops the stack entry.
			interaction.overlay?.handle.hide();
			this.unmountTabInteraction(interaction);
		}
		this.tabInteractions.delete(tabId);
		this.syncWaitingInputCount();
		this.syncDialogBlocked();
	}

	/**
	 * Gate an extension overlay on its tab being the one on screen.
	 *
	 * The overlay keeps its place in the TUI's overlay stack, so the extension stays
	 * in control of it: the handle it was given still hides and shows it, and a
	 * collapse it applied survives the gate. Nothing pops the stack for a tab switch:
	 * a pop takes whatever sits on top, which may belong to another surface.
	 */
	private scopeOverlayToTab(options: OverlayOptions, tabId: string | undefined): OverlayOptions {
		if (tabId === undefined) return options;
		const visible = options.visible;
		return {
			...options,
			visible: (termWidth, termHeight) =>
				this.tabShowsOnScreen(tabId) && (visible ? visible(termWidth, termHeight) : true),
		};
	}

	showExtensionSelector(
		title: string,
		options: string[],
		opts?: ExtensionUIDialogOptions & ExtensionSelectorOptions,
		tabId?: string,
		blocked: TabInteraction["blocked"] = { kind: "question", message: title },
	): Promise<string | undefined> {
		tabId ??= this.host.shownTabId();
		const interaction: TabInteraction = { kind: "selector", mounted: false, blocked };
		return new Promise((resolve) => {
			if (opts?.signal?.aborted) {
				resolve(undefined);
				return;
			}

			const finish = (option: string | undefined) => {
				opts?.signal?.removeEventListener("abort", onAbort);
				this.closeTabInteraction(interaction);
				resolve(option);
			};
			const onAbort = () => finish(undefined);
			opts?.signal?.addEventListener("abort", onAbort, { once: true });

			interaction.component = new ExtensionSelectorComponent(
				title,
				options,
				(option) => finish(option),
				() => finish(undefined),
				{
					tui: this.host.ui,
					timeout: opts?.timeout,
					keyShortcuts: opts?.keyShortcuts,
					onToggleToolsExpanded: () => this.host.toggleToolOutputExpansion(),
				},
			);

			this.openTabInteraction(tabId, interaction);
		});
	}

	async showExtensionConfirm(
		title: string,
		message: string,
		opts?: ExtensionUIDialogOptions,
		tabId?: string,
	): Promise<boolean> {
		const result = await this.showExtensionSelector(
			`${title}\n${message}`,
			["Yes", "No"],
			{
				...opts,
				keyShortcuts: { y: "Yes", n: "No" },
			},
			tabId,
			{ kind: "permission", message: title },
		);
		return result === "Yes";
	}

	showExtensionInput(
		title: string,
		placeholder?: string,
		opts?: ExtensionUIDialogOptions,
		tabId?: string,
	): Promise<string | undefined> {
		tabId ??= this.host.shownTabId();
		const interaction: TabInteraction = {
			kind: "input",
			mounted: false,
			blocked: { kind: "question", message: title },
		};
		return new Promise((resolve) => {
			if (opts?.signal?.aborted) {
				resolve(undefined);
				return;
			}

			const finish = (value: string | undefined) => {
				opts?.signal?.removeEventListener("abort", onAbort);
				this.closeTabInteraction(interaction);
				resolve(value);
			};
			const onAbort = () => finish(undefined);
			opts?.signal?.addEventListener("abort", onAbort, { once: true });

			interaction.component = new ExtensionInputComponent(
				title,
				placeholder,
				(value) => finish(value),
				() => finish(undefined),
				{ tui: this.host.ui, timeout: opts?.timeout },
			);

			this.openTabInteraction(tabId, interaction);
		});
	}

	showExtensionEditor(title: string, prefill?: string, tabId?: string): Promise<string | undefined> {
		tabId ??= this.host.shownTabId();
		const interaction: TabInteraction = {
			kind: "editor",
			mounted: false,
			blocked: { kind: "question", message: title },
		};
		return new Promise((resolve) => {
			interaction.component = new ExtensionEditorComponent(
				this.host.ui,
				this.host.keybindings,
				title,
				prefill,
				(value) => {
					this.closeTabInteraction(interaction);
					resolve(value);
				},
				() => {
					this.closeTabInteraction(interaction);
					resolve(undefined);
				},
				undefined,
				this.host.settingsManager.getExternalEditorCommand(),
			);

			this.openTabInteraction(tabId, interaction);
		});
	}

	/** Restore the default editor when the factory is undefined, preserving the draft. */
	setCustomEditorComponent(factory: EditorFactory | undefined): void {
		this.editorComponentFactory = factory;

		const currentText = this.host.editor.getText();

		// A mounted dialog keeps its slot and focus until it closes onto the replacement editor.
		const dialogOpen = this.tabInteractionsFor(this.host.shownTabId()).some((interaction) => interaction.mounted);
		if (!dialogOpen) {
			this.host.disposeActiveSelector();
			this.host.editorContainer.clear();
		}

		if (factory) {
			const newEditor = factory(this.host.ui, getEditorTheme(), this.host.keybindings);

			newEditor.onSubmit = this.host.defaultEditor.onSubmit;
			newEditor.onChange = this.host.defaultEditor.onChange;

			newEditor.setText(currentText);

			if (newEditor.borderColor !== undefined) {
				newEditor.borderColor = this.host.defaultEditor.borderColor;
			}
			if (newEditor.setPaddingX !== undefined) {
				newEditor.setPaddingX(this.host.defaultEditor.getPaddingX());
			}
			if (newEditor.setAutocompleteMaxVisible !== undefined) {
				newEditor.setAutocompleteMaxVisible(this.host.defaultEditor.getAutocompleteMaxVisible());
			}

			if (newEditor.setAutocompleteProvider && this.host.autocompleteProvider) {
				newEditor.setAutocompleteProvider(this.host.autocompleteProvider);
			}

			// Use duck typing since instanceof fails across jiti module boundaries
			const customEditor = newEditor as unknown as Record<string, unknown>;
			if ("actionHandlers" in customEditor && customEditor.actionHandlers instanceof Map) {
				if (!customEditor.onEscape) {
					customEditor.onEscape = () => this.host.defaultEditor.onEscape?.();
				}
				if (!customEditor.onCtrlD) {
					customEditor.onCtrlD = () => this.host.defaultEditor.onCtrlD?.();
				}
				if (!customEditor.onPasteImage) {
					customEditor.onPasteImage = () => this.host.defaultEditor.onPasteImage?.();
				}
				if (!customEditor.onExtensionShortcut) {
					customEditor.onExtensionShortcut = (data: string) => this.host.defaultEditor.onExtensionShortcut?.(data);
				}
				if (!customEditor.getPlaceholder) {
					customEditor.getPlaceholder = () => this.host.defaultEditor.getPlaceholder?.();
				}
				if (!customEditor.onVimKey) {
					customEditor.onVimKey = (data: string) => this.host.defaultEditor.onVimKey?.(data) ?? false;
				}
				if (!customEditor.onVimEnterArmKey) {
					customEditor.onVimEnterArmKey = (data: string) =>
						this.host.defaultEditor.onVimEnterArmKey?.(data) ?? false;
				}
				if (!customEditor.onWidgetPanelKey) {
					customEditor.onWidgetPanelKey = (data: string) =>
						this.host.defaultEditor.onWidgetPanelKey?.(data) ?? false;
				}
				if (!customEditor.onQueueEditArmKey) {
					customEditor.onQueueEditArmKey = (data: string) =>
						this.host.defaultEditor.onQueueEditArmKey?.(data) ?? false;
				}
				for (const [action, handler] of this.host.defaultEditor.actionHandlers) {
					customEditor.actionHandlers.set(action, handler);
				}
			}

			this.host.editor = newEditor;
		} else {
			this.host.defaultEditor.setText(currentText);
			this.host.editor = this.host.defaultEditor;
		}

		if (!dialogOpen) this.host.editorContainer.addChild(this.host.editor as Component);
		this.host.syncEditorHistory();
		this.host.refreshEditorStatus();
		if (!dialogOpen) this.host.ui.setFocus(this.host.editor as Component);
		this.host.ui.requestRender();
	}

	showExtensionNotify(message: string, type?: "info" | "warning" | "error"): void {
		if (type === "error") {
			this.host.showError(message);
		} else if (type === "warning") {
			this.host.showWarning(message);
		} else {
			this.host.showStatus(message);
		}
	}

	/**
	 * Show a custom component with keyboard focus. Overlay mode renders on top of
	 * existing content; either form belongs to `tabId`, so it follows that tab.
	 */
	async showExtensionCustom<T>(
		factory: (
			tui: TUI,
			theme: Theme,
			keybindings: KeybindingsManager,
			done: (result: T) => void,
		) => (Component & { dispose?(): void }) | Promise<Component & { dispose?(): void }>,
		options?: {
			overlay?: boolean;
			overlayOptions?: OverlayOptions | (() => OverlayOptions);
			onHandle?: (handle: OverlayHandle) => void;
			blocked?: TabInteraction["blocked"];
		},
		tabId?: string,
	): Promise<T> {
		tabId ??= this.host.shownTabId();
		const isOverlay = options?.overlay ?? false;
		const interaction: TabInteraction = {
			kind: isOverlay ? "overlay" : "custom",
			mounted: false,
			blocked: isOverlay ? undefined : options?.blocked,
		};
		this.trackTabInteraction(tabId, interaction);

		// A custom component owns the composer while it is on the slot, so the draft it displaced
		// goes back when it closes. `mountTabInteraction` reads that draft, so a dialog that waits
		// for a background tab never records another tab's.
		const restoreDraft = () => {
			if (isOverlay || !interaction.mounted || interaction.savedDraft === undefined) return;
			this.host.editor.setText(interaction.savedDraft);
		};

		return new Promise((resolve, reject) => {
			let component: Component & { dispose?(): void };
			let closed = false;

			const close = (result: T) => {
				if (closed) return;
				closed = true;
				// The draft goes back before the slot: `unmountTabInteraction` is what hands focus
				// back to an overlay this component displaced.
				restoreDraft();
				interaction.overlay?.handle.hide();
				this.unmountTabInteraction(interaction);
				interaction.untrack?.();
				this.remountParkedTabInteraction(interaction.tabId);
				this.host.ui.requestRender();
				// Disposal must not prevent the caller from receiving its result.
				resolve(result);
				try {
					component?.dispose?.();
				} catch {
					/* ignore dispose errors */
				}
			};

			Promise.resolve(factory(this.host.ui, theme, this.host.keybindings, close))
				.then((c) => {
					// A factory can call close before its asynchronous result arrives.
					if (closed) return;
					component = c;
					interaction.component = component;
					if (isOverlay) {
						const resolveOptions = (): OverlayOptions | undefined => {
							if (options?.overlayOptions) {
								const opts =
									typeof options.overlayOptions === "function"
										? options.overlayOptions()
										: options.overlayOptions;
								return opts;
							}
							const w = (component as { width?: number }).width;
							return w ? { width: w } : undefined;
						};
						const overlayOptions = this.scopeOverlayToTab(resolveOptions() ?? {}, tabId);
						const handle = this.host.ui.showOverlay(component, overlayOptions);
						interaction.overlay = { handle, capturing: overlayOptions.nonCapturing !== true };
						options?.onHandle?.(handle);
						this.host.ui.requestRender();
					} else {
						if (tabId === undefined || this.tabShowsOnScreen(tabId)) this.mountTabInteraction(tabId, interaction);
						this.host.ui.requestRender();
					}
				})
				.catch((err) => {
					if (closed) return;
					closed = true;
					restoreDraft();
					this.unmountTabInteraction(interaction);
					interaction.untrack?.();
					this.remountParkedTabInteraction(interaction.tabId);
					reject(err);
				});
		});
	}
}
