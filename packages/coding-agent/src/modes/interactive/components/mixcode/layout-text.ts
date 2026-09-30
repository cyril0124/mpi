/**
 * Fixed-width text layout and compact formatting shared across the fork's
 * MixCode components: padding to a column count, windowing a selection, coarse
 * durations, and shortened paths.
 *
 * These helpers are feature-agnostic, so they live outside any one feature
 * folder (Home, settings, the workdir picker and the input dock all read them).
 */
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

/** Truncate then pad to exactly `width` visible columns. */
export function padLine(text: string, width: number): string {
	const clipped = visibleWidth(text) > width ? truncateToWidth(text, width, "") : text;
	const deficit = width - visibleWidth(clipped);
	return deficit > 0 ? clipped + " ".repeat(deficit) : clipped;
}

/** Start index of a window that keeps `selectedIndex` centered when possible. */
export function windowStart(selectedIndex: number, total: number, windowSize: number): number {
	if (total <= windowSize) return 0;
	return Math.max(0, Math.min(selectedIndex - Math.floor(windowSize / 2), total - windowSize));
}

/** Coarse run length in whole seconds: `7s`, `2m 05s`, `1h 02m 03s`. */
export function formatSecondCount(totalSeconds: number): string {
	const hours = Math.floor(totalSeconds / 3600);
	const minutes = Math.floor((totalSeconds % 3600) / 60);
	const seconds = totalSeconds % 60;
	const pad = (value: number) => String(value).padStart(2, "0");
	if (hours > 0) return `${hours}h ${pad(minutes)}m ${pad(seconds)}s`;
	if (minutes === 0) return `${seconds}s`;
	return `${minutes}m ${pad(seconds)}s`;
}

/**
 * Shorten a path that does not fit by collapsing leading path components to one
 * character (two for dot-directories), then truncating as a last resort.
 */
export function compactWorkdir(workdir: string, maxWidth: number): string {
	if (visibleWidth(workdir) <= maxWidth) return workdir;
	const segments = workdir.split("/");
	for (let index = 1; index < segments.length - 1; index++) {
		const segment = segments[index]!;
		if (segment.length > 1) {
			segments[index] = segment.startsWith(".") ? segment.slice(0, 2) : segment.slice(0, 1);
			if (visibleWidth(segments.join("/")) <= maxWidth) return segments.join("/");
		}
	}
	return truncateToWidth(segments.join("/"), maxWidth, "...");
}
