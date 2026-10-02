/**
 * New-tab, close-tab, and delete-tab commands, plus the rebind and invalidate
 * callbacks the host attaches to each runtime.
 *
 * A membership change runs inside SharedTabLayout.transaction() so the shared
 * layout publishes one reconciled snapshot per command.
 */

import type { AgentSessionRuntime } from "../../../../core/agent-session-runtime.ts";
import type { SharedTabLayout } from "../../../../core/mixcode/multi-tab/shared-tab-layout.ts";
import {
	type AgentTab,
	type TabManager,
	tabBusyPhrase,
	tabBusyReason,
} from "../../../../core/mixcode/multi-tab/tab-manager.ts";
import { deleteSessionFile } from "../../../../core/mixcode/session-delete.ts";

/** Roll up a deleteSessionFile result as a tally entry. */
function deleteOutcome(result: { ok: boolean; removed: boolean; error?: string }): {
	deleted: number;
	error?: string;
} {
	if (result.ok && result.removed) return { deleted: 1 };
	return result.error ? { deleted: 0, error: result.error } : { deleted: 0 };
}

export interface TabLifecycleHost {
	readonly tabManager: TabManager | undefined;
	readonly sharedTabLayout: SharedTabLayout | undefined;
	editorText(): string;
	enqueueTabSwitch(run: () => Promise<void>): Promise<void>;
	switchActiveTab(tab: AgentTab): Promise<void>;
	disposeTabUi(tabId: string): void;
	subscribeToAgent(): void;
	showError(message: string): void;
	showWarning(message: string): void;
	showStatus(message: string): void;
}

export interface RuntimeCallbackHost {
	readonly tabManager: TabManager | undefined;
	rebindCurrentSession(options?: { renderBeforeBind?: boolean }): Promise<void>;
	applyThemeFromSettings(): Promise<void>;
	persistOpenTabs(): void;
	resetExtensionUI(): void;
}

/**
 * Open a new agent session in its own tab. Publishes the new membership through
 * SharedTabLayout.transaction() so peers learn about the new session id without a
 * separate incremental write.
 *
 * @param title Optional title for the new tab.
 * @param focus When false the tab is created but focus stays on the current tab.
 */
export async function handleNewTab(host: TabLifecycleHost, title: string | undefined, focus: boolean): Promise<void> {
	const { tabManager } = host;
	if (!tabManager) {
		host.showWarning("Multi-tab is unavailable in this session.");
		return;
	}
	const previousId = tabManager.getActive().id;
	tabManager.setDraft(previousId, host.editorText());

	let createdTab: AgentTab | undefined;
	const create = async () => {
		const tab = await tabManager.createTab(title ? { title } : {});
		if (title && tab.runtime.session.sessionManager.getSessionName() !== title) {
			tab.runtime.session.setSessionName(title);
		}
		createdTab = tab;
	};

	try {
		await (host.sharedTabLayout?.transaction(create) ?? create());
	} catch (error) {
		host.showError(`Failed to open tab: ${error instanceof Error ? error.message : String(error)}`);
		return;
	}

	const tab = createdTab;
	if (!tab) return;

	if (!focus) {
		// Keep the current tab rendered; the new tab only joins the bar.
		tabManager.activate(previousId);
		return;
	}
	await host.enqueueTabSwitch(() => host.switchActiveTab(tab));
}

/**
 * Close the active tab, falling back to the nearest remaining tab.
 * Removal is published through SharedTabLayout.transaction() so peers learn the
 * session is gone without an interleaving write.
 *
 * The caller is responsible for unsubscribing from the active session BEFORE
 * calling this function so the event handler does not fire into a detached session.
 */
export async function handleCloseTab(host: TabLifecycleHost): Promise<void> {
	const { tabManager } = host;
	if (!tabManager) return;
	if (tabManager.size <= 1) {
		host.showWarning("Cannot close the last tab.");
		return;
	}
	const closing = tabManager.getActive();
	try {
		await (host.sharedTabLayout?.transaction(async () => {
			await tabManager.closeTab(closing.id);
		}) ?? tabManager.closeTab(closing.id));
	} catch (error) {
		// Refused (a turn in progress): caller must re-subscribe.
		host.subscribeToAgent();
		host.showError(error instanceof Error ? error.message : String(error));
		return;
	}
	await host.enqueueTabSwitch(() => host.switchActiveTab(tabManager.getActive()));
	host.disposeTabUi(closing.id);
}

/** Delete one tab's session file, returning the count and error for the tally. */
export async function deleteOneTab(manager: TabManager, tab: AgentTab): Promise<{ deleted: number; error?: string }> {
	return deleteOutcome(await manager.deleteTab(tab.id));
}

/**
 * Execute a session-file deletion. `all` deletes every tab's file, keeping one
 * tab on a fresh session.
 *
 * The entire multi-step operation is wrapped in one SharedTabLayout transaction so
 * a single reconciled snapshot is published after all files are gone and the manager
 * has settled on its new state.
 */
export async function handleDeleteTabs(
	host: TabLifecycleHost & {
		runtimeHost: { newSession(options?: unknown): Promise<{ cancelled: boolean }> };
	},
	options: { all: boolean },
): Promise<void> {
	const { tabManager } = host;
	if (!tabManager) {
		host.showWarning("Multi-tab is unavailable in this session.");
		return;
	}
	const targets = options.all ? [...tabManager.list()] : [tabManager.getActive()];
	const blocked = targets.map((tab) => tabBusyReason(tab)).filter((reason): reason is string => reason !== undefined);
	if (blocked.length > 0) {
		const phrase = tabBusyPhrase(targets[0]!);
		host.showError(
			options.all
				? `Cannot delete all sessions while ${blocked.join(", ")}`
				: `Cannot delete a session while ${phrase ?? "a turn is in progress"}`,
		);
		return;
	}
	const paths = targets.map((tab) => tab.runtime.session.sessionFile).filter((item): item is string => Boolean(item));
	if (paths.length === 0) {
		host.showError("No saved session files to delete.");
		return;
	}

	const errors: string[] = [];
	let deleted = 0;
	const record = (outcome: { deleted: number; error?: string }): void => {
		deleted += outcome.deleted;
		if (outcome.error) errors.push(outcome.error);
	};

	const runDelete = async () => {
		if (options.all || tabManager.size <= 1) {
			// Keep one tab; delete its file after giving the runtime a fresh session.
			const keep = tabManager.getActive();
			for (const tab of [...tabManager.list()]) {
				if (tab.id === keep.id) continue;
				record(await deleteOneTab(tabManager, tab));
				host.disposeTabUi(tab.id);
			}
			const keepPath = keep.runtime.session.sessionFile;
			await host.runtimeHost.newSession();
			if (keepPath) record(deleteOutcome(await deleteSessionFile(keepPath, { title: keep.title })));
			await host.enqueueTabSwitch(() => host.switchActiveTab(tabManager.getActive()));
		} else {
			const closingId = tabManager.getActive().id;
			record(await deleteOneTab(tabManager, tabManager.getActive()));
			await host.enqueueTabSwitch(() => host.switchActiveTab(tabManager.getActive()));
			host.disposeTabUi(closingId);
		}
	};

	await (host.sharedTabLayout?.transaction(runDelete) ?? runDelete());

	if (errors.length > 0) host.showError(`Delete failed: ${errors.join("; ")}`);
	if (deleted > 0) host.showStatus(`Removed ${deleted} session file(s).`);
	else if (errors.length === 0) host.showStatus("No session file to delete.");
}

/**
 * Attach the host rebind and invalidate callbacks to a runtime, whether it is the
 * initial one or a tab created later. After a rebind the layout is published, so
 * the shared set follows a session that `/clear` or `/resume` replaced.
 */
export function bindRuntimeCallbacks(host: RuntimeCallbackHost, runtime: AgentSessionRuntime): void {
	runtime.setBeforeSessionInvalidate(() => {
		host.resetExtensionUI();
	});

	runtime.setRebindSession(async () => {
		// rebind() changes the tab manager's session reference; publish() afterward
		// detects the session-ID change via the baseline and emits the correct delta.
		host.tabManager?.rebind(runtime);
		await host.rebindCurrentSession({ renderBeforeBind: true });
		await host.applyThemeFromSettings();
		host.persistOpenTabs();
	});
}
