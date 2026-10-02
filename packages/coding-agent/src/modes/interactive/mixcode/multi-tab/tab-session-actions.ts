/**
 * Session commands: `/close-session`, `/delete-session`, `/close-all-sessions`,
 * `/delete-all-sessions`.
 *
 * Each one checks its preconditions, asks for confirmation, then delegates to the
 * tab lifecycle module, which owns the shared-layout transaction.
 */

import type { AgentSession } from "../../../../core/agent-session.ts";
import type { SharedTabLayout } from "../../../../core/mixcode/multi-tab/shared-tab-layout.ts";
import type { AgentTab } from "../../../../core/mixcode/multi-tab/tab-manager.ts";
import { type TabManager, tabBusyReason } from "../../../../core/mixcode/multi-tab/tab-manager.ts";
import { isInTrash } from "../../../../core/mixcode/session-trash.ts";
import { handleCloseTab, handleDeleteTabs } from "./tab-lifecycle.ts";

export interface SessionActionHost {
	readonly tabManager: TabManager | undefined;
	readonly sharedTabLayout: SharedTabLayout | undefined;
	readonly session: AgentSession;
	editorText(): string;
	enqueueTabSwitch(run: () => Promise<void>): Promise<void>;
	switchActiveTab(tab: AgentTab): Promise<void>;
	disposeTabUi(tabId: string): void;
	subscribeToAgent(): void;
	runtimeHost: { newSession(options?: unknown): Promise<{ cancelled: boolean }> };
	showExtensionConfirm(title: string, message: string): Promise<boolean>;
	showError(message: string): void;
	showWarning(message: string): void;
	showStatus(message: string): void;
}

/**
 * Parse a session-action argument: empty opens a confirmation overlay,
 * `yes`/`y` skips it, and anything else is a usage error.
 */
export function parseSessionActionArgs(
	args: string,
	command: string,
	showError: (msg: string) => void,
): "confirm" | "skip" | "none" {
	const token = args.trim().toLowerCase();
	if (token === "") return "confirm";
	if (token === "yes" || token === "y") return "skip";
	showError(`Usage: /${command} [yes]`);
	return "none";
}

/** `/close-session [yes]` closes the active tab (session file is kept). */
export async function handleCloseSession(host: SessionActionHost, args: string): Promise<void> {
	const mode = parseSessionActionArgs(args, "close-session", (msg) => host.showError(msg));
	if (mode === "none") return;
	if (mode === "confirm") {
		const title = host.tabManager?.getActive().title ?? "this tab";
		const confirmed = await host.showExtensionConfirm(
			"Close session",
			`Close tab "${title}"? The session file is kept and can be resumed later.`,
		);
		if (!confirmed) return;
	}
	await handleCloseTab(host);
}

/** `/delete-session [yes]` closes the active tab and deletes its session file. */
export async function handleDeleteSession(host: SessionActionHost, args: string): Promise<void> {
	const mode = parseSessionActionArgs(args, "delete-session", (msg) => host.showError(msg));
	if (mode === "none") return;
	const filePath = host.session.sessionFile;
	if (!filePath) {
		host.showError("This session has not been saved yet; nothing to delete.");
		return;
	}
	if (mode === "confirm") {
		// A session file can already sit in the trash (an unindexed file opens in
		// place), and deleting that one is permanent rather than recoverable.
		const message = isInTrash(filePath)
			? `Remove this session from the trash for good?\n${filePath}\nThis cannot be undone.`
			: `Delete the session file?\n${filePath}\nIt moves to the trash and can be restored with /resume-trash; if that move fails it is deleted for good.`;
		const confirmed = await host.showExtensionConfirm("Delete session", message);
		if (!confirmed) return;
	}
	try {
		await handleDeleteTabs(host, { all: false });
	} catch (error) {
		host.showError(error instanceof Error ? error.message : String(error));
	}
}

/** `/close-all-sessions` closes every tab except the active one, after confirmation. */
export async function handleCloseAllSessions(host: SessionActionHost): Promise<void> {
	const { tabManager } = host;
	if (!tabManager) {
		host.showWarning("Multi-tab is unavailable in this session.");
		return;
	}
	const confirmed = await host.showExtensionConfirm(
		"Close all sessions",
		`Close ${tabManager.size - 1} other tab(s)? Session files are kept.`,
	);
	if (!confirmed) return;
	const keep = tabManager.getActive();
	const blocked: string[] = [];

	const runCloseAll = async () => {
		for (const tab of [...tabManager.list()]) {
			if (tab.id === keep.id) continue;
			try {
				await tabManager.closeTab(tab.id);
			} catch (error) {
				blocked.push(error instanceof Error ? error.message : String(error));
				continue;
			}
			host.disposeTabUi(tab.id);
		}
	};

	await (host.sharedTabLayout?.transaction(runCloseAll) ?? runCloseAll());
	await host.enqueueTabSwitch(() => host.switchActiveTab(tabManager.getActive()));
	if (blocked.length > 0) {
		host.showError(blocked.join("; "));
		return;
	}
	host.showStatus("Closed all other tabs.");
}

/** `/delete-all-sessions` deletes every tab's session file, after confirmation. */
export async function handleDeleteAllSessions(host: SessionActionHost): Promise<void> {
	const { tabManager } = host;
	if (!tabManager) {
		host.showWarning("Multi-tab is unavailable in this session.");
		return;
	}
	const blocked = tabManager
		.list()
		.map((tab) => tabBusyReason(tab))
		.filter((reason): reason is string => reason !== undefined);
	if (blocked.length > 0) {
		host.showError(`Cannot delete all sessions while ${blocked.join(", ")}`);
		return;
	}
	const total = tabManager.size;
	const confirmed = await host.showExtensionConfirm(
		"Delete all sessions",
		`Delete the session files of all ${total} tab(s) and start fresh? They move to the trash and can be restored with /resume-trash; a file already in the trash, or one whose move fails, is deleted for good.`,
	);
	if (!confirmed) return;
	try {
		await handleDeleteTabs(host, { all: true });
	} catch (error) {
		host.showError(error instanceof Error ? error.message : String(error));
	}
}
