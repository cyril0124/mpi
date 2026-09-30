/**
 * Named workspace commands: `/save-workspace`, `/restore-workspace`,
 * `/delete-workspace`.
 *
 * A restore replaces the shared layout, so it asks for confirmation first and
 * then changes every tab inside one queued transaction, which keeps a peer from
 * observing a half-restored layout.
 */

import * as fs from "node:fs";
import type { AgentSession } from "../../../../core/agent-session.ts";
import {
	deleteWorkspaceRecord,
	type MixcodeWorkspace,
	type MixcodeWorkspaceTab,
	readWorkspaces,
	resolveSessionPath,
	upsertWorkspace,
} from "../../../../core/mixcode/multi-tab/mixcode-state.ts";
import type { SharedTabLayout } from "../../../../core/mixcode/multi-tab/shared-tab-layout.ts";
import { type AgentTab, type TabManager, tabBusyReason } from "../../../../core/mixcode/multi-tab/tab-manager.ts";

/**
 * Open one saved workspace entry as a tab. Tries the recorded session path first
 * (it survives a moved session directory), then the session id, and finally falls
 * back to a fresh session for an entry whose file was never written.
 */
async function openWorkspaceEntry(
	manager: TabManager,
	sessionDir: string,
	entry: MixcodeWorkspaceTab,
): Promise<{ tab: AgentTab; recreated: boolean }> {
	const sessionPath =
		entry.session_path && fs.existsSync(entry.session_path)
			? entry.session_path
			: resolveSessionPath(sessionDir, entry.session_id);
	const tab = sessionPath
		? await manager.openSessionTab(sessionPath, { title: entry.title, workdir: entry.workdir })
		: await manager.createTab({ title: entry.title, workdir: entry.workdir });
	return { tab, recreated: !sessionPath };
}

export interface WorkspaceHost {
	readonly tabManager: TabManager | undefined;
	readonly sharedTabLayout: SharedTabLayout | undefined;
	readonly tabsWorkdir: string;
	readonly session: AgentSession;
	enqueueTabSwitch(run: () => Promise<void>): Promise<void>;
	/** Direct call — must be invoked inside enqueueTabSwitch, not via a nested enqueue. */
	switchActiveTab(tab: AgentTab): Promise<void>;
	disposeTabUi(tabId: string): void;
	/** Bind the restored tabs' extensions once the new layout has settled. */
	queueRestoredTabBinds(): void;
	showExtensionConfirm(title: string, message: string): Promise<boolean>;
	showError(message: string): void;
	showWarning(message: string): void;
	showStatus(message: string): void;
}

/**
 * `/save-workspace <name>` snapshots the open tab layout in the shared schema.
 * Pure write-through to the workspaces file; no tab-manager state changes.
 */
export function saveWorkspaceCommand(host: WorkspaceHost, name: string): void {
	const { tabManager } = host;
	if (!tabManager) {
		host.showWarning("Multi-tab is unavailable in this session.");
		return;
	}
	try {
		const active = tabManager.getActive();
		const existing = readWorkspaces(host.tabsWorkdir).some((ws) => ws.name === name);
		const record: MixcodeWorkspace = {
			name,
			startup_workdir: host.tabsWorkdir.trim().replace(/\/+$/, ""),
			updated_at: new Date().toISOString(),
			active_session_id: active.runtime.session.sessionManager.getSessionId(),
			tabs: tabManager.list().map((tab) => {
				const session = tab.runtime.session;
				const model = session.model;
				return {
					session_id: session.sessionManager.getSessionId(),
					session_path: session.sessionFile,
					title: tab.title,
					workdir: tab.runtime.cwd,
					...(model
						? {
								model: {
									provider: model.provider,
									model_id: model.id,
									display_name: model.name,
									context_window: model.contextWindow,
									...(typeof model.reasoning === "boolean" ? { reasoning: model.reasoning } : {}),
									...(model.thinkingLevelMap ? { thinking_level_map: model.thinkingLevelMap } : {}),
								},
							}
						: {}),
					...(session.thinkingLevel ? { thinking_level: session.thinkingLevel } : {}),
				};
			}),
		};
		upsertWorkspace(host.tabsWorkdir, record);
		host.showStatus(`Workspace ${existing ? "updated" : "saved"}: "${name}" (${record.tabs.length} tab(s)).`);
	} catch (error) {
		host.showError(`Failed to save workspace: ${error instanceof Error ? error.message : String(error)}`);
	}
}

/**
 * `/restore-workspace <name>` opens a saved layout, closing the current tabs.
 *
 * Confirmation is obtained before entering the queue.  All mutations run inside
 * one enqueueTabSwitch:
 *   - previousIds and tabBusyReason captured after the queue lock is held
 *   - SharedTabLayout.transaction({ replace: true }) wraps create/close/activate
 *   - manager.activate() called inside the transaction so the active snapshot is
 *     correct when the layout publishes at transaction commit
 *   - disposeTabUi called for every closed previous tab
 *   - switchActiveTab called directly (not via a nested enqueue)
 */
export async function restoreWorkspaceCommand(host: WorkspaceHost, name: string): Promise<void> {
	const { tabManager } = host;
	if (!tabManager) {
		host.showWarning("Multi-tab is unavailable in this session.");
		return;
	}

	let record: MixcodeWorkspace | undefined;
	try {
		record = readWorkspaces(host.tabsWorkdir).find((ws) => ws.name === name);
	} catch (error) {
		host.showError(`Failed to read workspaces: ${error instanceof Error ? error.message : String(error)}`);
		return;
	}
	if (!record) {
		host.showError(`Unknown workspace: ${name}`);
		return;
	}
	if (record.tabs.length === 0) {
		host.showError(`Workspace "${name}" has no tabs.`);
		return;
	}

	// Confirmation before the queue; may show a dialog.
	const closingCount = tabManager.list().length;
	if (closingCount > 0) {
		const confirmed = await host.showExtensionConfirm(
			`Restore Workspace "${name}"?`,
			`This opens ${record.tabs.length} tab(s) and closes ${closingCount} tab(s) that are not in this workspace.\nSessions are not deleted.`,
		);
		if (!confirmed) {
			host.showStatus("Restore cancelled.");
			return;
		}
	}

	const sessionDir = host.session.sessionManager.getSessionDir();
	let opened = 0;
	let recreated = 0;
	let target: AgentTab | undefined;
	let replaced = false;

	try {
		await host.enqueueTabSwitch(async () => {
			// Capture previousIds now — inside the queue, no interleaving with peer.
			const previousIds = new Set(tabManager.list().map((tab) => tab.id));

			// Guard: refuse if any tab became busy while confirmation was shown.
			const blocked = tabManager
				.list()
				.map((tab) => tabBusyReason(tab))
				.filter((reason): reason is string => reason !== undefined);
			if (blocked.length > 0) {
				host.showError(`Cannot restore workspace: ${blocked.join(", ")}`);
				return;
			}

			const openedTabs: Array<{ tab: AgentTab; title?: string }> = [];

			const runRestore = async () => {
				for (const entry of record.tabs) {
					const { tab, recreated: wasRecreated } = await openWorkspaceEntry(tabManager, sessionDir, entry);
					if (wasRecreated) recreated += 1;
					if (entry.session_id === record.active_session_id) target = tab;
					openedTabs.push({ tab, title: entry.title });
					opened += 1;
				}
				for (const tab of [...tabManager.list()]) {
					if (previousIds.has(tab.id) && tabManager.size > 1) {
						await tabManager.closeTab(tab.id);
						host.disposeTabUi(tab.id);
					}
				}
				// Re-apply saved titles after the layout has settled.
				for (const { tab, title } of openedTabs) {
					if (title && tabManager.get(tab.id)) tabManager.restoreTitle(tab.id, title);
				}
				// Activate inside the transaction so the active snapshot is published correctly.
				const resolved = target ?? tabManager.getActive();
				tabManager.activate(resolved.id);
				target = resolved;
			};

			if (host.sharedTabLayout) {
				await host.sharedTabLayout.transaction(runRestore, { replace: true });
			} else {
				await runRestore();
			}

			// switchActiveTab is a direct call here — we are already inside the queue.
			if (target) await host.switchActiveTab(target);
			replaced = true;
		});
	} catch (error) {
		host.showError(`Failed to restore workspace: ${error instanceof Error ? error.message : String(error)}`);
		return;
	}
	// The queued callback declines on a tab that became busy; report only a real restore.
	if (!replaced) return;

	host.queueRestoredTabBinds();
	host.showStatus(
		recreated > 0
			? `Restored workspace "${name}" (${opened} tab(s), ${recreated} without a saved session file).`
			: `Restored workspace "${name}" (${opened} tab(s)).`,
	);
}

/**
 * `/delete-workspace <name>` removes a saved workspace record from the workspaces file.
 * Pure metadata write; no tab-manager state changes.
 */
export function deleteWorkspaceCommand(host: WorkspaceHost, name: string): void {
	if (!host.tabManager) {
		host.showWarning("Multi-tab is unavailable in this session.");
		return;
	}
	try {
		deleteWorkspaceRecord(host.tabsWorkdir, name);
		host.showStatus(`Deleted workspace "${name}".`);
	} catch (error) {
		host.showError(error instanceof Error ? error.message : String(error));
	}
}
