import { stripTerminalSequences } from "@earendil-works/pi-tui";
import { beforeEach, describe, expect, it } from "vitest";
import type { HomeCard } from "../../src/modes/interactive/components/mixcode/home/home-model.ts";
import { HomeView, type HomeViewModel } from "../../src/modes/interactive/components/mixcode/home/home-view.ts";
import { initTheme } from "../../src/modes/interactive/theme/theme.ts";

/**
 * Startup loading strategy: the roster lists the whole persisted layout from the
 * first frame, and a tab still coming up names the phase it is on.
 */
beforeEach(() => {
	initTheme("dark");
});

/** A live idle card, the shape the mode builds for a ready tab. */
function idleCard(id: string, title: string): HomeCard {
	return { id, title, status: "idle", unread: false, tokens: 100, contextWindow: 1000 };
}

/** A persisted tab still being restored; no runtime, so no model or tokens yet. */
function placeholderCard(id: string, title: string, loadingPhase?: HomeCard["loadingPhase"]): HomeCard {
	return { id, title, status: "loading", unread: false, loadingPhase, tokens: null, contextWindow: 0 };
}

/** Render one Home frame at a width that keeps the stacked layout. */
function render(model: Partial<HomeViewModel>): string {
	const view = new HomeView({
		getModel: () => ({
			version: "0.0.0-test",
			workdir: "/tmp",
			workingCount: 0,
			waitingCount: 0,
			agents: [],
			selectedIndex: 0,
			nonIdleOnly: false,
			overlayOpen: false,
			...model,
		}),
		getHeight: () => undefined,
		onAction: () => {},
	});
	return stripTerminalSequences(view.render(100).join("\n"));
}

describe("Home loading cards", () => {
	it("lists every persisted tab on the first frame, with its phase chip", () => {
		const frame = render({
			agents: [
				{ card: placeholderCard("s1", "Agent-01", "session"), messages: [] },
				{ card: placeholderCard("s2", "Agent-02", "resources"), messages: [] },
				{ card: placeholderCard("s3", "Agent-03"), messages: [] },
				{ card: idleCard("s4", "Agent-04"), messages: [] },
			],
		});
		expect(frame).toContain("Agent-01");
		expect(frame).toContain("Agent-02");
		expect(frame).toContain("Agent-03");
		expect(frame).toContain("Agent-04");
		expect(frame).toContain("[session]");
		expect(frame).toContain("[resources]");
		// A tab waiting its turn, with no phase assigned yet, falls back to the generic label.
		expect(frame).toContain("[loading]");
	});

	it("does not paint a loading phase on a ready tab", () => {
		const frame = render({ agents: [{ card: idleCard("s1", "Agent-01"), messages: [] }] });
		expect(frame).toContain("[idle]");
		expect(frame).not.toContain("[loading]");
	});

	it("names the tabs parked on an extension dialog, phase chip or not", () => {
		const frame = render({
			waitingCount: 2,
			agents: [
				// A restore parked on a `session_start` dialog reports the question, not the phase.
				{ card: { ...placeholderCard("s1", "Agent-01", "resources"), waiting: true }, messages: [] },
				{ card: { ...idleCard("s2", "Agent-02"), waiting: true }, messages: [] },
			],
		});
		expect(frame).toContain("2 input");
		expect(frame).not.toContain("[resources]");
		expect(frame.match(/\[input\]/g)).toHaveLength(2);
	});
});
