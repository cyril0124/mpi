import { describe, expect, it } from "vitest";
import { KeybindingsManager } from "../../src/core/keybindings.ts";
import {
	createVimTabState,
	enterVimMode,
	exitVimMode,
	handleVimEnterArmKey,
	handleVimKey,
	transferVimMode,
	VIM_ENTER_ARM_WINDOW_MS,
	VIM_LINE_SCROLL_ROWS,
	VIM_PAGE_SCROLL_ROWS,
	type VimKeyHost,
	type VimTabState,
} from "../../src/core/mixcode/vim/vim-mode.ts";

interface Recorded {
	scrollLines: number[];
	oldest: number;
	newest: number;
	jumps: Array<-1 | 1>;
	notices: string[];
}

type FakeHost = VimKeyHost & { recorded: Recorded };

function makeHost(available = true, jumpFound: boolean[] = []): FakeHost {
	const recorded: Recorded = {
		scrollLines: [],
		oldest: 0,
		newest: 0,
		jumps: [],
		notices: [],
	};
	const pending = [...jumpFound];
	const host: FakeHost = {
		recorded,
		keybindings: new KeybindingsManager(),
		controller: {
			available: () => available,
			scrollLines: (lines) => {
				recorded.scrollLines.push(lines);
			},
			scrollToOldest: () => {
				recorded.oldest += 1;
			},
			scrollToNewest: () => {
				recorded.newest += 1;
			},
			jumpUserMessage: (direction) => {
				recorded.jumps.push(direction);
				return pending.shift() ?? true;
			},
		},
		notify: (message) => {
			recorded.notices.push(message);
		},
	};
	return host;
}

function activeState(): VimTabState {
	return { active: true, topArmed: false, enterArmedAt: undefined };
}

describe("vim mode entry", () => {
	it("enters on request when a transcript viewport exists", () => {
		const state = createVimTabState();
		expect(enterVimMode(state, makeHost(true))).toBe(true);
		expect(state.active).toBe(true);
	});

	it("refuses without a fullscreen transcript viewport and says why", () => {
		const state = createVimTabState();
		const host = makeHost(false);
		expect(enterVimMode(state, host)).toBe(false);
		expect(state.active).toBe(false);
		expect(host.recorded.notices[0]).toContain("fullscreen");
	});

	it("leaves the modal surface on q", () => {
		const state = activeState();
		const host = makeHost();
		expect(handleVimKey(state, "q", host)).toBe(true);
		expect(state.active).toBe(false);
	});

	it("clears the armed g prefix on exit", () => {
		const state = activeState();
		state.topArmed = true;
		exitVimMode(state);
		expect(state.topArmed).toBe(false);
	});
});

describe("vim scroll keys", () => {
	it("moves three rows towards older output on k / up", () => {
		for (const key of ["k", "\x1b[A"]) {
			const host = makeHost();
			const state = activeState();
			expect(handleVimKey(state, key, host)).toBe(true);
			expect(host.recorded.scrollLines).toEqual([VIM_LINE_SCROLL_ROWS]);
		}
	});

	it("moves three rows towards newer output on j / down", () => {
		for (const key of ["j", "\x1b[B"]) {
			const host = makeHost();
			expect(handleVimKey(activeState(), key, host)).toBe(true);
			expect(host.recorded.scrollLines).toEqual([-VIM_LINE_SCROLL_ROWS]);
		}
	});

	it("pages up and down by a fixed block of rows", () => {
		const upHost = makeHost();
		handleVimKey(activeState(), "\x1b[5~", upHost);
		expect(upHost.recorded.scrollLines).toEqual([VIM_PAGE_SCROLL_ROWS]);

		const downHost = makeHost();
		handleVimKey(activeState(), "\x1b[6~", downHost);
		expect(downHost.recorded.scrollLines).toEqual([-VIM_PAGE_SCROLL_ROWS]);

		const ctrlHost = makeHost();
		handleVimKey(activeState(), "\x15", ctrlHost);
		handleVimKey(activeState(), "\x04", ctrlHost);
		expect(ctrlHost.recorded.scrollLines).toEqual([VIM_PAGE_SCROLL_ROWS, -VIM_PAGE_SCROLL_ROWS]);
	});

	it("jumps to the oldest row on gg and to the newest on G", () => {
		const host = makeHost();
		const state = activeState();
		handleVimKey(state, "g", host);
		expect(state.topArmed).toBe(true);
		expect(host.recorded.oldest).toBe(0);
		handleVimKey(state, "g", host);
		expect(state.topArmed).toBe(false);
		expect(host.recorded.oldest).toBe(1);

		handleVimKey(state, "G", host);
		expect(host.recorded.newest).toBe(1);
	});

	it("keeps Home and End as single-key top and bottom jumps", () => {
		const host = makeHost();
		const state = activeState();
		handleVimKey(state, "\x1b[H", host);
		expect(host.recorded.oldest).toBe(1);
		expect(state.topArmed).toBe(false);
		handleVimKey(state, "\x1b[F", host);
		expect(host.recorded.newest).toBe(1);
	});

	it("cancels the armed gg prefix on an unrelated key", () => {
		const host = makeHost();
		const state = activeState();
		handleVimKey(state, "g", host);
		handleVimKey(state, "j", host);
		expect(state.topArmed).toBe(false);
		expect(host.recorded.oldest).toBe(0);
	});
});

describe("vim user-message jumps", () => {
	it("jumps forward on right and reports it", () => {
		const host = makeHost();
		expect(handleVimKey(activeState(), "\x1b[C", host)).toBe(true);
		expect(host.recorded.jumps).toEqual([1]);
		expect(host.recorded.notices).toEqual(["Next user message"]);
	});

	it("falls back to the newest output past the last user message", () => {
		const host = makeHost(true, [false]);
		handleVimKey(activeState(), "\x1b[C", host);
		expect(host.recorded.newest).toBe(1);
		expect(host.recorded.notices).toEqual(["Newest output"]);
	});

	it("jumps backward on shift+right and reports the end of history", () => {
		const backward = makeHost();
		handleVimKey(activeState(), "\x1b[1;2C", backward);
		expect(backward.recorded.jumps).toEqual([-1]);

		const exhausted = makeHost(true, [false]);
		handleVimKey(activeState(), "\x1b[1;2C", exhausted);
		expect(exhausted.recorded.notices).toEqual(["No older user message"]);
	});
});

describe("vim modality", () => {
	it("swallows unbound keys so they never reach the editor", () => {
		const host = makeHost();
		for (const key of ["x", "i", "p", "\x1b", "\r"]) {
			expect(handleVimKey(activeState(), key, host)).toBe(true);
		}
		expect(host.recorded.scrollLines).toEqual([]);
		expect(host.recorded.oldest).toBe(0);
		expect(host.recorded.newest).toBe(0);
		expect(host.recorded.jumps).toEqual([]);
	});

	it("passes tab, shift+tab, ctrl+o, ctrl+t and ctrl+q through", () => {
		const host = makeHost();
		const state = activeState();
		state.topArmed = true;
		expect(handleVimKey(state, "\t", host)).toBe(false);
		expect(state.topArmed).toBe(false);
		expect(handleVimKey(activeState(), "\x1b[Z", host)).toBe(false);
		expect(handleVimKey(activeState(), "\x0f", host)).toBe(false);
		expect(handleVimKey(activeState(), "\x14", host)).toBe(false);
		// app.quit defaults to ctrl+shift+q on Windows, so pin it for the raw ctrl+q byte.
		host.keybindings.setUserBindings({ "app.quit": "ctrl+q" });
		expect(handleVimKey(activeState(), "\x11", host)).toBe(false);
	});

	it("ignores every key while inactive", () => {
		const host = makeHost();
		const state = createVimTabState();
		expect(handleVimKey(state, "j", host)).toBe(false);
		expect(host.recorded.scrollLines).toEqual([]);
	});
});

describe("vim entry arm", () => {
	it("arms on an empty editor and enters on u inside the window", () => {
		const state = createVimTabState();
		const host = makeHost();
		const armed = handleVimEnterArmKey(state, "\x15", host, true, 1_000);
		expect(armed).toEqual({ armed: true, entered: false, consumed: true });
		expect(state.enterArmedAt).toBe(1_000);

		const entered = handleVimEnterArmKey(state, "u", host, true, 1_000 + VIM_ENTER_ARM_WINDOW_MS);
		expect(entered.entered).toBe(true);
		expect(state.active).toBe(true);
	});

	it("also enters on a second ctrl+u inside the window", () => {
		const state = createVimTabState();
		const host = makeHost();
		handleVimEnterArmKey(state, "\x15", host, true, 0);
		const entered = handleVimEnterArmKey(state, "\x15", host, true, 500);
		expect(entered.entered).toBe(true);
	});

	it("does not enter once the window expired", () => {
		const state = createVimTabState();
		const host = makeHost();
		handleVimEnterArmKey(state, "\x15", host, true, 0);
		const late = handleVimEnterArmKey(state, "u", host, true, VIM_ENTER_ARM_WINDOW_MS + 1);
		expect(late.entered).toBe(false);
		expect(late.consumed).toBe(false);
		expect(state.active).toBe(false);
	});

	it("cancels the arm on an unrelated key without consuming it", () => {
		const state = createVimTabState();
		const host = makeHost();
		handleVimEnterArmKey(state, "\x15", host, true, 0);
		const other = handleVimEnterArmKey(state, "a", host, true, 100);
		expect(other).toEqual({ armed: false, entered: false, consumed: false });
		expect(state.enterArmedAt).toBeUndefined();
	});

	it("never arms from a non-empty editor and leaves the key to the editor", () => {
		const state = createVimTabState();
		const host = makeHost();
		expect(handleVimEnterArmKey(state, "\x15", host, false, 0).consumed).toBe(false);
		expect(state.enterArmedAt).toBeUndefined();
	});
});

describe("vim tab transfer", () => {
	it("moves the modal surface to the newly focused tab", () => {
		const from = activeState();
		const to = createVimTabState();
		transferVimMode(from, to);
		expect(to.active).toBe(true);
		expect(from.active).toBe(false);
		expect(from.topArmed).toBe(false);
	});

	it("does nothing when the source tab is not modal", () => {
		const from = createVimTabState();
		const to = createVimTabState();
		transferVimMode(from, to);
		expect(to.active).toBe(false);
	});
});
