/**
 * The home directory a workdir reading is taken against.
 *
 * A path shows relative to it in the dock's meta row, and a typed `~` in the
 * workdir picker expands to it, so both have to resolve the same directory or the
 * badge and the breadcrumb would name different paths. `HOME`, then `USERPROFILE`,
 * then whatever the platform reports covers the environments the fork runs in.
 */
import { homedir } from "node:os";

export function homeDir(): string {
	return process.env.HOME || process.env.USERPROFILE || homedir();
}
