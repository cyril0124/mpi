/**
 * New-tab, resume-into-tab, close-tab, and delete-tab commands, plus the rebind
 * and invalidate callbacks the host attaches to each runtime.
 *
 * A membership change runs inside SharedTabLayout.transaction() so the shared
 * layout publishes one reconciled snapshot per command.
 */

import type { AgentSessionRuntime } from "../../../../core/agent-session-runtime.ts";
import type { ProjectTrustContext } from "../../../../core/extensions/index.ts";
import type { SharedTabLayout } from "../../../../core/mixcode/multi-tab/shared-tab-layout.ts";
import {
	type AgentTab,
	type TabManager,
	tabDeletionPhrase,
	tabDeletionReason,
} from "../../../../core/mixcode/multi-tab/tab-manager.ts";
import { deleteSessionFile } from "../../../../core/mixcode/session-delete.ts";
import { MissingSessionCwdError } from "../../../../core/session-cwd.ts";

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
	/**
	 * Park the composer's text as the draft of the tab that mounts it. A no-op while Home owns
	 * the composer: Home's text is ephemeral and belongs to no tab, so a command run from there
	 * must not overwrite the draft that tab parked.
	 */
	saveComposerDraft(): void;
	enqueueTabSwitch(run: () => Promise<void>): Promise<void>;
	switchActiveTab(tab: AgentTab): Promise<void>;
	disposeTabUi(tabId: string): void;
	/** Drop the active session subscription; a close re-subscribes or hands it to the next tab. */
	unsubscribeFromAgent(): void;
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
 * @returns The created tab, or undefined when no tab was created.
 */
export async function handleNewTab(
	host: TabLifecycleHost,
	title: string | undefined,
	focus: boolean,
): Promise<AgentTab | undefined> {
	const { tabManager } = host;
	if (!tabManager) {
		host.showWarning("Multi-tab is unavailable in this session.");
		return undefined;
	}
	const previousId = tabManager.getActive().id;
	host.saveComposerDraft();

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
		return undefined;
	}

	const tab = createdTab;
	if (!tab) return undefined;

	if (!focus) {
		// Keep the current tab rendered; the new tab only joins the bar. Focus comes
		// back the way it was, so the tab that never left the screen keeps its badge.
		tabManager.restoreFocus(previousId);
		return tab;
	}
	await host.enqueueTabSwitch(() => host.switchActiveTab(tab));
	return tab;
}

/** Host surface the resume-into-tab command needs on top of the tab lifecycle one. */
export interface ResumeTabHost extends TabLifecycleHost {
	/** Ask before opening a session whose recorded cwd is gone; undefined cancels. */
	promptMissingSessionCwd(error: MissingSessionCwdError): Promise<string | undefined>;
	/** Trust decision context for a cwd the opened session brings with it. */
	projectTrustContext(cwd: string): ProjectTrustContext;
	/**
	 * Focus an existing tab through the activation guard, which leaves a tab already on screen
	 * untouched; a full switch would rebuild its extension chrome from the empty parked record a
	 * foreground tab never has.
	 */
	activateTab(tab: AgentTab): Promise<void>;
}

/**
 * Open `sessionPath` in a tab of its own. Publishes the new session id through
 * SharedTabLayout.transaction() so peers learn about it without a separate
 * incremental write, the way handleNewTab does.
 *
 * A session whose recorded directory is gone is opened only after the host has
 * offered a cwd to open it in. Reports its own failure and returns undefined when
 * the open failed or the offer was declined.
 */
async function openResumedSessionTab(
	host: ResumeTabHost,
	tabManager: TabManager,
	sessionPath: string,
): Promise<{ tab: AgentTab; usedCurrentCwd: boolean } | undefined> {
	let openedTab: AgentTab | undefined;
	const open = async (workdir?: string): Promise<void> => {
		openedTab = await tabManager.openSessionTab(sessionPath, {
			workdir,
			projectTrustContextFactory: (cwd) => host.projectTrustContext(cwd),
		});
	};
	const openAndPublish = async (workdir?: string): Promise<void> => {
		await (host.sharedTabLayout?.transaction(() => open(workdir)) ?? open(workdir));
	};
	const failureMessage = (error: unknown): string =>
		`Failed to resume session: ${error instanceof Error ? error.message : String(error)}`;

	try {
		await openAndPublish();
	} catch (error) {
		if (!(error instanceof MissingSessionCwdError)) {
			host.showError(failureMessage(error));
			return undefined;
		}
		// The session's own directory is gone: ask for the cwd to open it in instead.
		const selectedCwd = await host.promptMissingSessionCwd(error);
		if (!selectedCwd) {
			host.showStatus("Resume cancelled");
			return undefined;
		}
		try {
			await openAndPublish(selectedCwd);
		} catch (retryError) {
			host.showError(failureMessage(retryError));
			return undefined;
		}
		return openedTab ? { tab: openedTab, usedCurrentCwd: true } : undefined;
	}
	return openedTab ? { tab: openedTab, usedCurrentCwd: false } : undefined;
}

/**
 * Open an existing session file in a tab of its own, leaving the focused tab on
 * its session; the `/resume` and `/resume-trash` selectors go through it.
 *
 * A session that is already open is focused instead of opened twice: two runtimes
 * on one session file would append to it concurrently.
 */
export async function handleResumeIntoTab(host: ResumeTabHost, sessionPath: string): Promise<void> {
	const { tabManager } = host;
	if (!tabManager) return;

	// The composer text belongs to the tab it was typed in, and both branches below
	// move focus to another tab, the same handover handleNewTab does. Home owns no
	// draft, so the host skips the handover there.
	host.saveComposerDraft();

	const open = tabManager.list().find((tab) => tab.runtime.session.sessionFile === sessionPath);
	if (open) {
		// Focus moves in the manager first, the way activateTab does it, so the tab bar
		// and every command that follows the manager's focus agree with the activation.
		tabManager.activate(open.id);
		await host.activateTab(open);
		host.showStatus(`Session is already open in tab "${open.title}".`);
		return;
	}

	const opened = await openResumedSessionTab(host, tabManager, sessionPath);
	if (!opened) return;
	await host.enqueueTabSwitch(() => host.switchActiveTab(opened.tab));
	host.showStatus(opened.usedCurrentCwd ? "Resumed session in current cwd" : "Resumed session");
}

/**
 * Close the active tab, falling back to the nearest remaining tab.
 * Removal is published through SharedTabLayout.transaction() so peers learn the
 * session is gone without an interleaving write.
 *
 * The subscription move belongs to this function: it drops the active session's listener before
 * the close, so the handler does not fire into a detached session, and re-subscribes when the
 * close is refused.
 */
export async function handleCloseTab(host: TabLifecycleHost): Promise<void> {
	const { tabManager } = host;
	if (!tabManager) return;
	if (tabManager.size <= 1) {
		host.showWarning("Cannot close the last tab.");
		return;
	}
	const closing = tabManager.getActive();
	host.unsubscribeFromAgent();
	try {
		await (host.sharedTabLayout?.transaction(async () => {
			await tabManager.closeTab(closing.id);
		}) ?? tabManager.closeTab(closing.id));
	} catch (error) {
		// Refused (a turn in progress): the tab stays, so it keeps its listener.
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
	const blocked = targets
		.map((tab) => tabDeletionReason(tab))
		.filter((reason): reason is string => reason !== undefined);
	if (blocked.length > 0) {
		const phrase = tabDeletionPhrase(targets[0]!);
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

	// The sessions this command removes from the shared layout. Read before the tabs close,
	// and forgotten explicitly afterwards: the delta publish derives its removals from the
	// last local snapshot, which misses ids a failed or interrupted publish never recorded.
	const deletedSessionIds = targets.map((tab) => tab.runtime.session.sessionManager.getSessionId());
	const errors: string[] = [];
	let deleted = 0;
	let replacementVetoed = false;
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
			// An extension can veto the replacement through `session_before_switch`. The tab then keeps
			// its conversation, so its file has to stay where that session writes: moving it to the
			// trash leaves the live session appending to a path that is no longer there.
			const replacement = await host.runtimeHost.newSession();
			if (replacement.cancelled) {
				replacementVetoed = true;
				return;
			}
			if (keepPath) record(deleteOutcome(await deleteSessionFile(keepPath, { title: keep.title })));
			await host.enqueueTabSwitch(() => host.switchActiveTab(tabManager.getActive()));
		} else {
			const closingId = tabManager.getActive().id;
			record(await deleteOneTab(tabManager, tabManager.getActive()));
			await host.enqueueTabSwitch(() => host.switchActiveTab(tabManager.getActive()));
			host.disposeTabUi(closingId);
		}
	};

	// A tab that kept its session stays in the shared set: its file outlives the command, so a
	// vetoed replacement must not drop the id a peer would then close. A throw above leaves the
	// tabs it already closed out of any delta the local snapshot covers, so this runs either way.
	try {
		await (host.sharedTabLayout?.transaction(runDelete) ?? runDelete());
	} finally {
		const liveSessionIds = new Set(tabManager.list().map((tab) => tab.runtime.session.sessionManager.getSessionId()));
		host.sharedTabLayout?.forgetSessions(deletedSessionIds.filter((id) => !liveSessionIds.has(id)));
	}

	if (errors.length > 0) host.showError(`Delete failed: ${errors.join("; ")}`);
	if (replacementVetoed) {
		// The kept tab holds its conversation; other tabs' files were already removed above.
		host.showStatus(
			deleted > 0 ? `Session delete cancelled after removing ${deleted} file(s).` : "Session delete cancelled.",
		);
		return;
	}
	if (deleted > 0) host.showStatus(`Removed ${deleted} session file(s).`);
	else if (errors.length === 0) host.showStatus("No session file to delete.");
}

/**
 * Attach the host rebind and invalidate callbacks to a runtime, whether it is the
 * initial one or a tab created later. After a rebind the layout is published, so
 * the shared set follows a session that `/clear` or `/workdir` replaced.
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
