import { describe, expect, it, vi } from "vitest";
import { type ForkCommandHost, ForkCommands } from "../../src/modes/interactive/mixcode/commands/fork-commands.ts";

/** Build the live composer, routing and action collaborators that fork commands dispatch into. */
function commandHost() {
	let text = "draft [paste]";
	let mountedId: string | undefined = "A";
	let activeId: string | undefined = "A";
	// Draft parked on the tab Home's roster has selected while Home covers it.
	const parkedDraft = "parked draft";
	const homeSelection = { active: false, selectedIndex: 0, nonIdleOnly: false };
	const trace: string[] = [];
	const errors: string[] = [];
	const editor = {
		getText: () => text,
		getExpandedText: () => text.replace("[paste]", "expanded paste"),
		setText: (value: string) => {
			trace.push(`write:${value}`);
			text = value;
		},
	};
	const host: ForkCommandHost = {
		composer: {
			get editor() {
				return editor;
			},
			setText: (value) => editor.setText(value),
			submit: async (value) => {
				await commands.dispatch(value);
			},
		},
		routing: {
			get manager() {
				return undefined;
			},
			get activeId() {
				return activeId;
			},
			get mountedId() {
				return mountedId;
			},
			get homeSelection() {
				return homeSelection;
			},
			get session() {
				return { setSessionName: vi.fn(), sessionManager: { getSessionName: () => undefined } };
			},
			activateTab: async () => {},
			attachHomeSelection: async () => {
				// The product attaches the selected tab, which loads that tab's own parked draft into
				// the shared composer before the command takes the composer over.
				trace.push("attach-home");
				homeSelection.active = false;
				editor.setText(parkedDraft);
			},
			newTab: vi.fn(async (title, focus) => {
				trace.push(`new:${title}:${focus}`);
			}),
			closeSession: vi.fn(async () => {}),
			closeAllSessions: vi.fn(async () => {}),
			deleteSession: vi.fn(async () => {}),
			deleteAllSessions: vi.fn(async () => {}),
		},
		actions: {
			batch: vi.fn(async (args) => {
				trace.push(`batch:${args}`);
			}),
			followUp: vi.fn(async (args) => {
				trace.push(`follow:${args}`);
			}),
			scopedModels: vi.fn(),
			thinking: vi.fn(),
			contextLimit: vi.fn(),
			consoleHistory: vi.fn(async () => {}),
			systemPrompt: vi.fn(async () => {}),
			systemTools: vi.fn(async () => {}),
			palette: vi.fn(),
			jump: vi.fn(),
			externalEditor: vi.fn(async (draft) => {
				trace.push(`edit:${draft}`);
				editor.setText("");
				return true;
			}),
			clone: vi.fn(async () => {}),
			workdir: vi.fn(async () => {}),
			vim: vi.fn(),
			toggleZen: vi.fn(),
			toggleInlineWidgets: vi.fn(),
			widgets: vi.fn(),
			reset: vi.fn(async () => {}),
			resumeTrash: vi.fn(),
			error: (message) => errors.push(message),
			warning: vi.fn(),
			status: vi.fn(),
		},
	};
	const commands = new ForkCommands(host);
	return {
		host,
		commands,
		editor,
		trace,
		errors,
		focus: (id: string) => {
			mountedId = id;
			activeId = id;
		},
	};
}

describe("fork command workflows", () => {
	it("splits arguments at the first space and reports usage errors", async () => {
		const { commands, host, editor, trace, errors } = commandHost();
		for (const input of [
			"/settings",
			"/model x",
			"/fork",
			"/resume",
			"/batch\tfile",
			"/thinking\thigh",
			"/scoped-models extra",
			"/clone extra",
		]) {
			expect(await commands.dispatch(input)).toBe(false);
		}
		expect(trace).toEqual([]);
		await commands.dispatch("/follow-up   --batch message");
		await commands.dispatch("/batch   script -- args");
		expect(trace).toEqual(["write:", "follow:   --batch message", "write:", "batch:script -- args"]);
		editor.setText("retain invalid command");
		await commands.dispatch("/editor extra");
		expect(editor.getText()).toBe("retain invalid command");
		await commands.dispatch("/new-session --wrong title");
		expect(editor.getText()).toBe("");
		expect(host.routing.newTab).not.toHaveBeenCalled();
		await commands.dispatch("/new-session --no-focus title with spaces");
		expect(host.routing.newTab).toHaveBeenCalledWith("title with spaces", false);
		expect(errors).toEqual(["Usage: /editor", "Usage: /new-session [--focus|--no-focus] [title]"]);
	});

	it("hands expanded palette draft to /editor and keeps a successful empty write", async () => {
		const { commands, editor, trace } = commandHost();
		await commands.runPalette("editor");
		expect(trace).toEqual(["write:/editor", "edit:draft expanded paste", "write:"]);
		expect(editor.getText()).toBe("");
		editor.setText("second draft");
		await commands.runPalette("thinking");
		expect(editor.getText()).toBe("second draft");
	});

	it("restores palette drafts on failure but keeps text produced by the command", async () => {
		const { commands, host, editor, errors } = commandHost();
		host.actions.batch = async () => {
			throw new Error("batch failed");
		};
		await commands.runPalette("batch");
		expect(errors).toEqual(["batch failed"]);
		expect(editor.getText()).toBe("draft [paste]");
		host.actions.batch = async () => {
			editor.setText("new draft from command");
		};
		await commands.runPalette("batch");
		expect(editor.getText()).toBe("new draft from command");
	});

	it("hands Home's palette command the draft of the tab it attaches", async () => {
		const { commands, host, editor, trace } = commandHost();
		host.routing.homeSelection.active = true;
		host.actions.batch = async () => {
			editor.setText("");
		};
		await commands.runPalette("batch");
		expect(trace[0]).toBe("attach-home");
		expect(editor.getText()).toBe("parked draft");
	});

	it("suspends Home draft handover until completion, including rejection and focus change", async () => {
		const { commands, host, editor, focus } = commandHost();
		let finish: () => void = () => {};
		host.actions.batch = async () => {
			await new Promise<void>((resolve) => {
				finish = resolve;
			});
		};
		const run = commands.runHome("/batch script");
		expect(commands.homeCommandDepth).toBe(1);
		finish();
		await run;
		expect(commands.homeCommandDepth).toBe(0);
		expect(editor.getText()).toBe("draft [paste]");
		host.actions.batch = async () => {
			focus("B");
		};
		await commands.runHome("/batch script");
		expect(editor.getText()).toBe("");
		host.actions.batch = async () => {
			throw new Error("failed");
		};
		await expect(commands.runHome("/batch script")).rejects.toThrow("failed");
		expect(commands.homeCommandDepth).toBe(0);
	});

	it("restores queued draft after clearing commands and passes the live draft to queued /editor", async () => {
		const { commands, editor, trace } = commandHost();
		await commands.runQueued("/thinking high");
		expect(editor.getText()).toBe("draft [paste]");
		await commands.runQueued("/editor");
		expect(trace).toContain("edit:draft expanded paste");
		// A queued /editor that empties the draft still restores it.
		expect(editor.getText()).toBe("draft [paste]");
	});
});
