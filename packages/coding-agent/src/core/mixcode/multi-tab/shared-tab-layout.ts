import { existsSync, writeFileSync } from "node:fs";
import { getDefaultSessionDir } from "../../session-manager.ts";
import {
	forgetOpenTabs,
	mutateOpenTabs,
	readTabMeta,
	replaceOpenTabSessionIds,
	resolveSessionPath,
	saveTabMeta,
	type TabLayoutEntry,
	writeOpenTabs,
} from "./mixcode-state.ts";
import { type PeerTabSync, startPeerTabSync } from "./peer-tab-sync.ts";
import { type AgentTab, type TabManager, tabBusyPhrase } from "./tab-manager.ts";

interface TabSnapshot {
	id: string;
	tab: AgentTab;
	meta: TabLayoutEntry;
}

export interface SharedTabLayoutOptions {
	manager: TabManager;
	workdir: string;
	sessionDir: string;
	enqueue: (operation: () => Promise<void>) => Promise<void>;
	refreshActiveTab: () => Promise<void>;
	disposeTabUi: (id: string) => void;
	/** Bind a tab opened for a peer in the background, so its chip leaves the loading state. */
	onTabOpened: (tab: AgentTab) => void;
	onError: (error: unknown) => void;
}

/** Publish local layout changes and reconcile remote changes through the same tab queue. */
export class SharedTabLayout {
	private readonly options: SharedTabLayoutOptions;
	private baseline: TabSnapshot[] = [];
	private activeSessionId: string | undefined;
	private suspensionDepth = 0;
	private sync: PeerTabSync | undefined;
	private started = false;
	private disposed = false;

	constructor(options: SharedTabLayoutOptions) {
		this.options = options;
	}

	/** Seed local sessions without replacing peer entries, then begin polling. */
	start(): void {
		if (this.started || this.disposed) return;
		if (!this.options.manager.getActive().runtime.session.sessionManager.isPersisted()) return;
		// Must precede the first publish; publishing before adopting overwrites the record.
		this.adoptStoredTabMeta();
		this.started = true;
		this.publish();
		this.sync = startPeerTabSync({
			workdir: this.options.workdir,
			getLocalSessionIds: () => this.snapshot().map((tab) => tab.meta.sessionId),
			execute: (operation) =>
				this.options.enqueue(async () => {
					if (this.disposed) return;
					this.suspensionDepth++;
					try {
						await operation();
					} finally {
						this.suspensionDepth--;
						this.remember();
					}
				}),
			openTab: async ({ sessionId }) => {
				const manager = this.options.manager;
				const meta = readTabMeta(this.options.workdir).get(sessionId);
				const sessionDir = meta?.workdir ? getDefaultSessionDir(meta.workdir) : this.options.sessionDir;
				const path =
					resolveSessionPath(this.options.sessionDir, sessionId) ?? resolveSessionPath(sessionDir, sessionId);
				if (!path) throw new Error(`Shared session is not on disk yet: ${sessionId}`);
				const previous = manager.getActive().id;
				const tab = await manager.openSessionTab(path, { title: meta?.title, workdir: meta?.workdir });
				// This pass asked for the id the file name carries; the session's own id is
				// in its header. Point the shared set at the real id, or the next pass asks
				// for the stale one again and opens another tab.
				const actualId = tab.runtime.session.sessionManager.getSessionId();
				if (actualId !== sessionId) {
					try {
						replaceOpenTabSessionIds(this.options.workdir, [{ from: sessionId, to: actualId }]);
					} catch (error) {
						this.options.onError(error);
					}
				}
				if (meta?.title) manager.restoreTitle(tab.id, meta.title, { titleLocked: meta.titleLocked });
				manager.setColor(tab.id, meta?.color);
				manager.setUnread(tab.id, meta?.unread ?? false);
				// A background open binds the tab's extensions, so its chip leaves the loading
				// state instead of spinning until a first focus.
				this.options.onTabOpened(tab);
				// The background open must not steal the user's editor focus.
				if (manager.get(previous)) manager.activate(previous);
			},
			closeTab: async (sessionId) => {
				const manager = this.options.manager;
				const tab = manager
					.list()
					.find((entry) => entry.runtime.session.sessionManager.getSessionId() === sessionId);
				if (!tab || tabBusyPhrase(tab) || manager.size <= 1) return;
				const wasActive = manager.getActive() === tab;
				await manager.closeTab(tab.id);
				this.options.disposeTabUi(tab.id);
				if (wasActive) await this.options.refreshActiveTab();
			},
			reorderTabs: (sessionIds) => {
				const manager = this.options.manager;
				const tabIds = sessionIds.flatMap((sessionId) => {
					const tab = manager
						.list()
						.find((entry) => entry.runtime.session.sessionManager.getSessionId() === sessionId);
					return tab ? [tab.id] : [];
				});
				manager.reorder(tabIds);
				this.adoptStoredTabMeta();
			},
			onError: this.options.onError,
		});
	}

	/**
	 * Adopt the stored title, color and badge for every local tab. A start that does not
	 * run the layout restore leaves the tabs at their defaults, so the first publish would
	 * write those defaults over the recorded state and drop a badge the previous run saved.
	 */
	private adoptStoredTabMeta(): void {
		const manager = this.options.manager;
		const meta = readTabMeta(this.options.workdir);
		for (const tab of manager.list()) {
			const stored = meta.get(tab.runtime.session.sessionManager.getSessionId());
			if (!stored) continue;
			if (stored.title) manager.restoreTitle(tab.id, stored.title, { titleLocked: stored.titleLocked });
			manager.setColor(tab.id, stored.color);
			manager.setUnread(tab.id, stored.unread);
		}
	}

	/** Persist only the deltas since the previous local mutation; report failures for retry. */
	publish(): void {
		if (!this.started || this.disposed || this.suspensionDepth > 0) return;
		try {
			this.publishChanges(false);
		} catch (error) {
			this.options.onError(error);
		}
	}

	/**
	 * Drop sessions from the shared membership. Called for sessions that were deleted,
	 * whose removal must not depend on the local delta snapshot.
	 *
	 * Call it after the transaction that closed the tabs, never inside one: that
	 * transaction's own publish re-adds every id a local tab still holds. There is no
	 * `started` guard because the startup restore runs before `start()`, and the write is
	 * a read-modify-write, so it keeps the entries a peer published.
	 */
	forgetSessions(sessionIds: readonly string[]): void {
		if (this.disposed) return;
		try {
			forgetOpenTabs(this.options.workdir, sessionIds);
		} catch (error) {
			this.options.onError(error);
		}
	}

	/** Batch a local workflow into one publication. */
	async transaction(operation: () => Promise<void>, options: { replace?: boolean } = {}): Promise<void> {
		this.suspensionDepth++;
		try {
			await operation();
		} finally {
			this.suspensionDepth--;
			if (this.suspensionDepth === 0 && this.started && !this.disposed) {
				try {
					this.publishChanges(options.replace ?? false);
				} catch (error) {
					this.options.onError(error);
				}
			}
		}
	}

	/** Reconcile immediately, using the same queue and callbacks as the periodic poll. */
	async reconcileNow(): Promise<void> {
		await this.sync?.reconcileNow();
	}

	/** Stop polling before the host tears down runtimes. */
	dispose(): void {
		this.disposed = true;
		this.sync?.dispose();
		this.sync = undefined;
	}

	private snapshot(): TabSnapshot[] {
		return this.options.manager.list().map((tab) => ({
			id: tab.id,
			tab,
			meta: {
				sessionId: tab.runtime.session.sessionManager.getSessionId(),
				title: tab.title,
				autoTitle: tab.autoTitle,
				titleLocked: tab.titleLocked,
				workdir: tab.runtime.cwd,
				color: tab.color,
				unread: tab.unread,
			},
		}));
	}

	private remember(): void {
		this.baseline = this.snapshot();
		this.activeSessionId = this.options.manager.activeTab()?.runtime.session.sessionManager.getSessionId();
	}

	/** Write the membership and metadata that changed since the last publish. */
	private publishChanges(replace: boolean): void {
		const next = this.snapshot();
		const previousById = new Map(this.baseline.map((tab) => [tab.id, tab]));
		const nextById = new Map(next.map((tab) => [tab.id, tab]));
		const added = next.filter((tab) => !previousById.has(tab.id));
		const removed = this.baseline.filter((tab) => !nextById.has(tab.id));
		const rebound = next.flatMap((tab) => {
			const previous = previousById.get(tab.id);
			return previous && previous.meta.sessionId !== tab.meta.sessionId ? [{ previous, tab }] : [];
		});
		const reordered =
			next.length === this.baseline.length && next.some((tab, index) => tab.id !== this.baseline[index]?.id);
		const active = this.options.manager.activeTab()?.runtime.session.sessionManager.getSessionId();
		const activeChanged = active !== this.activeSessionId;
		const changedMeta = next.filter(
			(tab) => JSON.stringify(previousById.get(tab.id)?.meta) !== JSON.stringify(tab.meta),
		);

		for (const tab of next) {
			if (added.includes(tab) || replace || rebound.some((entry) => entry.tab === tab)) {
				this.persistEmptySession(tab.tab);
			}
		}
		if (replace) {
			writeOpenTabs(
				this.options.workdir,
				next.map((tab) => tab.meta.sessionId),
				active,
			);
		} else if (added.length || removed.length || rebound.length || reordered || activeChanged) {
			mutateOpenTabs(
				this.options.workdir,
				(ids) => {
					let ordered = [...ids];
					for (const tab of removed) ordered = ordered.filter((id) => id !== tab.meta.sessionId);
					for (const { previous, tab } of rebound) {
						const index = ordered.indexOf(previous.meta.sessionId);
						ordered = ordered.filter((id) => id !== tab.meta.sessionId);
						if (index >= 0) ordered.splice(index, 1, tab.meta.sessionId);
						else ordered.push(tab.meta.sessionId);
					}
					for (const tab of added) {
						if (ordered.includes(tab.meta.sessionId)) continue;
						ordered.push(tab.meta.sessionId);
					}
					if (reordered) {
						const localOrder = next.map((tab) => tab.meta.sessionId);
						ordered = [
							...localOrder.filter((id) => ordered.includes(id)),
							...ordered.filter((id) => !localOrder.includes(id)),
						];
					}
					ids.clear();
					for (const id of ordered) ids.add(id);
				},
				activeChanged ? active : undefined,
			);
		}
		if (changedMeta.length || replace) {
			const patches = (replace ? next : changedMeta).map((tab) => {
				const previous = previousById.get(tab.id)?.meta;
				const meta = tab.meta;
				if (!previous || replace || previous.sessionId !== meta.sessionId) return meta;
				return {
					sessionId: meta.sessionId,
					...(meta.title !== previous.title ||
					meta.autoTitle !== previous.autoTitle ||
					meta.titleLocked !== previous.titleLocked
						? { title: meta.title, autoTitle: meta.autoTitle, titleLocked: meta.titleLocked }
						: {}),
					...(meta.color !== previous.color ? { color: meta.color } : {}),
					...(meta.workdir !== previous.workdir ? { workdir: meta.workdir } : {}),
					...(meta.unread !== previous.unread ? { unread: meta.unread } : {}),
				};
			});
			saveTabMeta(this.options.workdir, patches);
		}
		this.remember();
	}

	/** Make an empty persisted session resumable before peers see its id. */
	private persistEmptySession(tab: AgentTab): void {
		const sessionManager = tab.runtime.session.sessionManager;
		const file = sessionManager.getSessionFile();
		if (!file || existsSync(file)) return;
		const header = sessionManager.getHeader();
		if (!header) throw new Error(`Session has no header: ${sessionManager.getSessionId()}`);
		writeFileSync(
			file,
			`${[header, ...sessionManager.getEntries()].map((entry) => JSON.stringify(entry)).join("\n")}\n`,
			{ flag: "wx" },
		);
		// Mark the manager's file as flushed so its next message appends instead of
		// trying to create the already-published file again with an exclusive write.
		sessionManager.setSessionFile(file);
	}
}
