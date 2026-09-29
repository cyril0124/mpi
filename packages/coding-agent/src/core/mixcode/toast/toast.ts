/**
 * Toast notifications: one typed, short-lived message per tab, painted over the
 * transcript by the interactive surface.
 */

/** Kind of a toast, selecting its icon and color. */
export type ToastType = "info" | "success" | "warning" | "error";

/** A live toast, with the push time its lifetime is measured from. */
export interface ToastNotification {
	type: ToastType;
	message: string;
	createdAt: number;
}

/** What a caller hands to {@link pushToast}. */
export interface ToastRequest {
	type: ToastType;
	message: string;
}

/** How long a toast stays live, in milliseconds. */
export const TOAST_DURATION_MS = 3_000;

/** The toast slot a tab exposes. */
export interface ToastHost {
	toast?: ToastNotification;
}

/** The confirmation a successful copy reports, counting characters. */
export function copyConfirmation(chars: number): string {
	return `Copied ${chars} chars.`;
}

/** The message a failed copy reports, carrying the clipboard's own reason. */
export function copyFailure(detail: string): string {
	return `Copy failed: ${detail}`;
}

/** Store a toast, replacing the tab's previous one. */
export function pushToast(host: ToastHost, toast: ToastRequest): void {
	host.toast = { ...toast, createdAt: Date.now() };
}

/** Drop the tab's toast, if any. */
export function clearToast(host: ToastHost): void {
	host.toast = undefined;
}

/**
 * The tab's live toast, or undefined. An expired toast is cleared here, so a
 * stale message cannot come back when the tab is looked at again.
 */
export function activeToast(host: ToastHost): ToastNotification | undefined {
	const toast = host.toast;
	if (toast === undefined) return undefined;
	if (Date.now() - toast.createdAt > TOAST_DURATION_MS) {
		host.toast = undefined;
		return undefined;
	}
	return toast;
}
