/**
 * Minimal ambient types for `fengari`, which ships no declarations.
 *
 * Only the surface the Lua batch executor uses is typed; the VM itself stays
 * `any`, matching fengari's C-API style where the state and functions are
 * dynamically typed by design.
 */
declare module "fengari" {
	export const lua: any;
	export const lauxlib: any;
	export const lualib: any;
	export function to_luastring(str: string): Uint8Array;
	export function to_jsstring(str: Uint8Array): string;
}
