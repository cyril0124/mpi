/**
 * Toast lifetime and the per-tab slot: one live toast per tab, replaced by the next
 * push, and dropped once it is three seconds old or on request.
 */
import { describe, expect, it } from "vitest";
import {
	activeToast,
	clearToast,
	pushToast,
	TOAST_DURATION_MS,
	type ToastHost,
} from "../../src/core/mixcode/toast/toast.ts";

describe("toast state", () => {
	it("carries a three second lifetime", () => {
		expect(TOAST_DURATION_MS).toBe(3_000);
	});

	it("stores type, message and push time, replacing the previous toast", () => {
		const tab: ToastHost = {};
		pushToast(tab, { type: "success", message: "Copied 11 chars." });

		expect(tab.toast?.type).toBe("success");
		expect(tab.toast?.message).toBe("Copied 11 chars.");
		expect(typeof tab.toast?.createdAt).toBe("number");

		pushToast(tab, { type: "error", message: "Copy failed" });

		expect(tab.toast?.type).toBe("error");
		expect(tab.toast?.message).toBe("Copy failed");
	});

	it("keeps a fresh toast and clears the stale one when it is read", () => {
		const tab: ToastHost = {};
		pushToast(tab, { type: "info", message: "Fresh" });

		expect(activeToast(tab)?.message).toBe("Fresh");

		tab.toast = { type: "info", message: "Fresh", createdAt: Date.now() - TOAST_DURATION_MS - 1 };

		expect(activeToast(tab)).toBeUndefined();
		expect(tab.toast).toBeUndefined();
	});

	it("drops the tab's toast on request", () => {
		const tab: ToastHost = {};
		pushToast(tab, { type: "warning", message: "Cannot close the last tab." });

		clearToast(tab);

		expect(activeToast(tab)).toBeUndefined();
	});
});
