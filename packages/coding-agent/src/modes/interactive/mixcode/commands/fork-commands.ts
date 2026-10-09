import type { EditorComponent } from "@earendil-works/pi-tui";
import type { AgentSession } from "../../../../core/agent-session.ts";
import { emitMarkDone } from "../../../../core/mixcode/extension-event-bus.ts";
import { HOME_TAB_ID, type HomeSelectionState, selectHomeTabById } from "../../../../core/mixcode/home/home-state.ts";
import type { AgentTab, TabManager } from "../../../../core/mixcode/multi-tab/tab-manager.ts";
import { isTabColorName, TAB_COLOR_NAMES } from "../../../../core/mixcode/multi-tab/types.ts";
import type { SessionManager } from "../../../../core/session-manager.ts";

/** Live collaborators used by command parsing, draft ownership and tab actions. */
export interface ForkCommandHost {
	composer: {
		readonly editor: Pick<EditorComponent, "getText" | "getExpandedText" | "setText">;
		setText(text: string): void;
		submit(text: string): void | Promise<void>;
	};
	routing: {
		readonly manager:
			| Pick<TabManager, "getActive" | "list" | "setDraft" | "rename" | "setColor" | "markDone" | "groupByColor">
			| undefined;
		readonly activeId: string | undefined;
		readonly mountedId: string | undefined;
		readonly homeSelection: HomeSelectionState;
		readonly session: Pick<AgentSession, "setSessionName"> & {
			sessionManager: Pick<SessionManager, "getSessionName">;
		};
		activateTab(tab: AgentTab): Promise<void>;
		newTab(title?: string, focus?: boolean): Promise<void>;
		closeSession(args: string): Promise<void>;
		closeAllSessions(): Promise<void>;
		deleteSession(args: string): Promise<void>;
		deleteAllSessions(): Promise<void>;
	};
	actions: {
		batch(args: string): Promise<void>;
		followUp(args: string): Promise<void>;
		scopedModels(): void;
		thinking(searchTerm?: string): void;
		contextLimit(args: string): void;
		consoleHistory(): Promise<void>;
		systemPrompt(): Promise<void>;
		systemTools(args: string): Promise<void>;
		palette(): void;
		jump(): void;
		externalEditor(draft: string): Promise<boolean>;
		clone(): Promise<void>;
		workdir(target: string): Promise<void>;
		vim(): void;
		toggleZen(): void;
		toggleInlineWidgets(): void;
		widgets(args: string): void;
		clear(): Promise<void>;
		reset(): Promise<void>;
		resumeTrash(): void;
		error(message: string): void;
		warning(message: string): void;
		status(message: string): void;
	};
}

/** Draft displaced by the palette; a successful /editor write owns even an empty result. */
interface PaletteCommandDraft {
	expandedText: string;
	ownsEditor: boolean;
}

/** Delay before /mark-done reaches extensions, so the user can leave the pane first. */
const MARK_DONE_SIGNAL_DELAY_MS = 5_000;

/** Report a matched command, so dispatch can await its action and still answer "handled". */
function handled(action: Promise<void>): Promise<boolean> {
	return action.then(() => true);
}

/**
 * Parse `/new-session [--focus|--no-focus] [title]`.
 * Defaults to focusing the new tab.
 */
function parseNewSessionArgs(args: string): { title?: string; focus: boolean; error?: string } {
	let rest = args.trim();
	let focus = true;
	const match = rest.match(/^(--focus|--no-focus)\b\s*/);
	if (match) {
		focus = match[1] === "--focus";
		rest = rest.slice(match[0].length).trim();
	} else if (rest.startsWith("--")) {
		return { focus: true, error: "Usage: /new-session [--focus|--no-focus] [title]" };
	}
	return { title: rest || undefined, focus };
}

/** Owns fork dispatch and the distinct composer handovers used by Home, palette and queues. */
export class ForkCommands {
	private readonly host: ForkCommandHost;
	private paletteCommandDraft: PaletteCommandDraft | undefined;
	homeCommandDepth = 0;

	constructor(host: ForkCommandHost) {
		this.host = host;
	}

	/** Preserve command matching and clear timing; decline input synchronously so routing cannot yield. */
	dispatch(text: string): boolean | Promise<boolean> {
		if (text === "/batch" || text.startsWith("/batch ")) {
			const args = text.slice("/batch".length).trim();
			this.consumeCommandText();
			return handled(this.host.actions.batch(args));
		}
		if (text === "/follow-up" || text.startsWith("/follow-up ")) {
			const args = text.slice("/follow-up".length);
			this.consumeCommandText();
			return handled(this.host.actions.followUp(args));
		}
		if (text === "/scoped-models") {
			this.consumeCommandText();
			return handled(Promise.resolve(this.host.actions.scopedModels()));
		}
		if (text === "/thinking" || text.startsWith("/thinking ")) {
			const searchTerm = text.startsWith("/thinking ") ? text.slice(10).trim() : undefined;
			this.consumeCommandText();
			this.host.actions.thinking(searchTerm);
			return true;
		}
		if (text === "/context-limit" || text.startsWith("/context-limit ")) {
			const args = text.startsWith("/context-limit ") ? text.slice("/context-limit ".length).trim() : "";
			this.consumeCommandText();
			this.host.actions.contextLimit(args);
			return true;
		}
		if (text === "/console-history") {
			this.consumeCommandText();
			return handled(this.host.actions.consoleHistory());
		}
		if (text.startsWith("/console-history ")) {
			this.host.actions.error("Usage: /console-history");
			return true;
		}
		if (text === "/system-prompt") {
			this.consumeCommandText();
			return handled(this.host.actions.systemPrompt());
		}
		if (text.startsWith("/system-prompt ")) {
			this.host.actions.error("Usage: /system-prompt");
			return true;
		}
		if (text === "/system-tools" || text.startsWith("/system-tools ")) {
			const args = text.startsWith("/system-tools ") ? text.slice("/system-tools ".length) : "";
			this.consumeCommandText();
			return handled(this.host.actions.systemTools(args));
		}
		if (text === "/palette") {
			this.consumeCommandText();
			this.host.actions.palette();
			return true;
		}
		if (text.startsWith("/palette ")) {
			this.host.actions.error("Usage: /palette");
			return true;
		}
		if (text === "/jump") {
			this.consumeCommandText();
			this.host.actions.jump();
			return true;
		}
		if (text.startsWith("/jump ")) {
			this.host.actions.error("Usage: /jump");
			return true;
		}
		if (text === "/editor") {
			const pending = this.paletteCommandDraft;
			// An agent tab reaches this with the composer already emptied by its submit. Home re-fills
			// the composer with the command text, and a queued command leaves it as it was, so a
			// composer that still holds exactly this command carries no draft.
			const composer = this.host.composer.editor.getExpandedText?.() ?? this.host.composer.editor.getText();
			const holdsCommand = composer.trim() === text;
			const draft = pending?.expandedText ?? (holdsCommand ? "" : composer);
			return this.host.actions.externalEditor(draft).then((wrote) => {
				// Once the external editor wrote, what it wrote stays: an emptied draft is a result too.
				if (pending && wrote) pending.ownsEditor = true;
				return true;
			});
		}
		if (text.startsWith("/editor ")) {
			this.host.actions.error("Usage: /editor");
			return true;
		}
		if (text === "/clone") {
			this.consumeCommandText();
			return handled(this.host.actions.clone());
		}
		if (text === "/workdir" || text.startsWith("/workdir ")) {
			const target = text.slice("/workdir".length).trim();
			this.consumeCommandText();
			return handled(this.host.actions.workdir(target));
		}
		if (text === "/new-session" || text.startsWith("/new-session ")) {
			const parsed = parseNewSessionArgs(text.startsWith("/new-session ") ? text.slice("/new-session ".length) : "");
			this.consumeCommandText();
			if (parsed.error) {
				this.host.actions.error(parsed.error);
				return true;
			}
			return handled(this.host.routing.newTab(parsed.title, parsed.focus));
		}
		if (text === "/close-session" || text.startsWith("/close-session ")) {
			const args = text.slice("/close-session".length).trim();
			this.consumeCommandText();
			return handled(this.host.routing.closeSession(args));
		}
		if (text === "/close-all-sessions") {
			this.consumeCommandText();
			return handled(this.host.routing.closeAllSessions());
		}
		if (text === "/delete-session" || text.startsWith("/delete-session ")) {
			const args = text.slice("/delete-session".length).trim();
			this.consumeCommandText();
			return handled(this.host.routing.deleteSession(args));
		}
		if (text === "/delete-all-sessions") {
			this.consumeCommandText();
			return handled(this.host.routing.deleteAllSessions());
		}
		if (text === "/rename" || text.startsWith("/rename ")) {
			const title = text.startsWith("/rename ") ? text.slice("/rename ".length).trim() : "";
			this.consumeCommandText();
			if (title) this.renameActiveTab(title);
			else this.host.actions.error("Tab title cannot be empty");
			return true;
		}
		if (text === "/tabs") {
			this.consumeCommandText();
			this.showTabList();
			return true;
		}
		if (text === "/tab" || text.startsWith("/tab ")) {
			const arg = text.startsWith("/tab ") ? text.slice("/tab ".length).trim() : "";
			this.consumeCommandText();
			return handled(this.handleTabCommand(arg));
		}
		if (text === "/color" || text.startsWith("/color ")) {
			const arg = text.startsWith("/color ") ? text.slice("/color ".length).trim() : "";
			this.consumeCommandText();
			this.colorActiveTab(arg);
			return true;
		}
		if (text === "/group-colored-tabs") {
			this.consumeCommandText();
			this.groupTabsByColor();
			return true;
		}
		if (text === "/mark-done") {
			this.consumeCommandText();
			this.markActiveTabDone();
			return true;
		}
		if (text === "/vim") {
			this.consumeCommandText();
			this.host.actions.vim();
			return true;
		}
		if (text === "/toggle-zen-mode") {
			this.consumeCommandText();
			this.host.actions.toggleZen();
			return true;
		}
		if (text === "/toggle-inline-widgets") {
			this.consumeCommandText();
			this.host.actions.toggleInlineWidgets();
			return true;
		}
		if (text === "/widgets" || text.startsWith("/widgets ")) {
			const args = text.startsWith("/widgets ") ? text.slice("/widgets ".length) : "";
			this.consumeCommandText();
			this.host.actions.widgets(args);
			return true;
		}
		// Explicit upstream /clear override: replace only the active tab session.
		if (text === "/clear") {
			this.consumeCommandText();
			return handled(this.host.actions.clear());
		}
		if (text === "/reset") {
			this.consumeCommandText();
			return handled(this.host.actions.reset());
		}
		if (text === "/resume-trash") {
			this.host.actions.resumeTrash();
			this.consumeCommandText();
			return true;
		}
		return false;
	}

	/** Suspend tab draft parking while Home dispatches, restoring only on the original tab. */
	async runHome(text: string): Promise<void> {
		const ownerTabId = this.host.routing.activeId;
		const draft = this.host.composer.editor.getText();
		this.homeCommandDepth += 1;
		try {
			this.host.composer.setText(text);
			await this.host.composer.submit(text);
		} finally {
			this.homeCommandDepth -= 1;
		}
		if (!draft.trim()) return;
		// A command that moved focus left the draft with the tab it came from, and one that wrote
		// text of its own into the composer keeps it; otherwise the draft goes back.
		if (ownerTabId !== undefined && this.host.routing.activeId !== ownerTabId) return;
		const remaining = this.host.composer.editor.getText();
		if (!remaining.trim() || remaining === text) this.host.composer.setText(draft);
	}

	/** Preserve the queued round's existing draft restoration after a successful dispatch. */
	async runQueued(text: string): Promise<void> {
		const draft = this.host.composer.editor.getText();
		await this.host.composer.submit(text);
		if (!draft.trim()) return;
		const remaining = this.host.composer.editor.getText();
		if (!remaining.trim() || remaining === text) this.host.composer.setText(draft);
	}

	/** Restore the displaced draft to its mounted surface, unless /editor wrote a result. */
	runPalette(name: string): Promise<void> {
		const text = `/${name}`;
		const draft = this.host.composer.editor.getText();
		// Every tab shares one composer, so a draft belongs to the surface that mounts it. A command
		// that switches tabs must hand the draft back there instead of typing it into the tab it
		// switched to; Home's composer is ephemeral, so it owns no draft.
		const ownerOfMountedComposer = () =>
			this.host.routing.homeSelection.active ? HOME_TAB_ID : this.host.routing.mountedId;
		const draftOwner = ownerOfMountedComposer();
		// `/editor` edits the draft this replaces and keeps what the external editor wrote.
		const pending: PaletteCommandDraft = {
			expandedText: this.host.composer.editor.getExpandedText?.() ?? draft,
			ownsEditor: false,
		};
		this.paletteCommandDraft = pending;
		// A command that cleared the editor, or left the command text in it, is done with it.
		const restoreDraft = () => {
			this.paletteCommandDraft = undefined;
			if (pending.ownsEditor) return;
			if (draftOwner && draftOwner !== ownerOfMountedComposer()) {
				// Park it on the tab that owned the composer; a tab the command closed is ignored.
				if (draftOwner !== HOME_TAB_ID) this.host.routing.manager?.setDraft(draftOwner, draft);
				return;
			}
			const remaining = this.host.composer.editor.getText();
			if (!remaining.trim() || remaining === text) this.host.composer.editor.setText(draft);
		};
		this.host.composer.editor.setText(text);
		return Promise.resolve(this.host.composer.submit(text)).then(restoreDraft, (error: unknown) => {
			restoreDraft();
			this.host.actions.error(error instanceof Error ? error.message : String(error));
		});
	}

	/** A matched command owns the composer, so its text goes before the action runs. */
	private consumeCommandText(): void {
		this.host.composer.editor.setText("");
	}

	private renameActiveTab(title: string): void {
		const manager = this.host.routing.manager;
		if (!manager) return;
		try {
			manager.rename(manager.getActive().id, title);
			// Keep the session name in step so the title survives restore and is
			// what `/name`, auto-rename, and the terminal title report.
			if (this.host.routing.session.sessionManager.getSessionName() !== title)
				this.host.routing.session.setSessionName(title);
		} catch (error) {
			this.host.actions.error(error instanceof Error ? error.message : String(error));
		}
	}

	private showTabList(): void {
		const manager = this.host.routing.manager;
		if (!manager) {
			this.host.actions.status("Multi-tab is unavailable in this session.");
			return;
		}
		const activeId = manager.getActive().id;
		const lines = manager.list().map((tab, index) => {
			const marker = tab.id === activeId ? "*" : " ";
			return `${marker} ${index + 1}. ${tab.title} [${tab.status}${tab.unread ? ", unread" : ""}]`;
		});
		this.host.actions.status(`Tabs:\n${lines.join("\n")}`);
	}

	private async handleTabCommand(arg: string): Promise<void> {
		const manager = this.host.routing.manager;
		if (!manager) return;
		if (!arg) {
			this.showTabList();
			return;
		}
		const index = Number.parseInt(arg, 10);
		if (!Number.isNaN(index) && String(index) === arg) {
			const tab = manager.list()[index - 1];
			if (!tab) {
				this.host.actions.error(`No tab at index ${index}`);
				return;
			}
			await this.host.routing.activateTab(tab);
			return;
		}
		const tab = manager.list().find((item) => item.title === arg);
		if (!tab) {
			this.host.actions.error(`Unknown tab: ${arg}`);
			return;
		}
		await this.host.routing.activateTab(tab);
	}

	private colorActiveTab(arg: string): void {
		const manager = this.host.routing.manager;
		if (!manager) {
			this.host.actions.warning("Multi-tab is unavailable in this session.");
			return;
		}
		const value = arg.trim().toLowerCase();
		try {
			if (value === "" || value === "clear") {
				manager.setColor(manager.getActive().id, undefined);
				this.host.actions.status("Cleared tab color.");
				return;
			}
			if (!isTabColorName(value)) {
				this.host.actions.error(`Unknown color: ${arg} (valid: ${TAB_COLOR_NAMES.join(", ")}, clear)`);
				return;
			}
			manager.setColor(manager.getActive().id, value);
			this.host.actions.status(`Tab color: ${value}`);
		} catch (error) {
			this.host.actions.error(error instanceof Error ? error.message : String(error));
		}
	}

	private markActiveTabDone(): void {
		const manager = this.host.routing.manager;
		if (!manager) {
			this.host.actions.warning("Multi-tab is unavailable in this session.");
			return;
		}
		try {
			manager.markDone(manager.getActive().id);
			this.host.actions.status("Tab marked done.");
			setTimeout(() => emitMarkDone(), MARK_DONE_SIGNAL_DELAY_MS).unref?.();
		} catch (error) {
			this.host.actions.error(error instanceof Error ? error.message : String(error));
		}
	}

	private groupTabsByColor(): void {
		const manager = this.host.routing.manager;
		if (!manager) return;
		const selectedId = manager.list()[this.host.routing.homeSelection.selectedIndex]?.id;
		manager.groupByColor();
		// The reorder re-clamps the selection against the new order, so follow the id
		// captured before it rather than an index that may already have moved.
		selectHomeTabById(this.host.routing.homeSelection, manager.list(), selectedId);
	}
}
