/**
 * Lua batch executor. The TypeScript counterpart is `batch-ts.ts`.
 */
import * as path from "node:path";
import { resolveBatchModel } from "./batch-models.ts";
import { parseBatchContextLimit, parseBatchPrompts, renderTemplate } from "./batch-plan.ts";
import type { BatchContext, BatchPlan, BatchReuseMode, BatchTabRequest } from "./types.ts";

/**
 * Run the Lua source under fengari and collect all `mixcode.open_tab()` calls into a
 * BatchPlan, with no side effects on the TUI: the host applies the plan afterwards.
 * Throws as `Lua error in <path>: ...` for syntax, runtime, or validation failures, with
 * the failing line and, for a runtime failure, its Lua call chain.
 */
export async function runLuaScript(
	source: string,
	scriptPath: string,
	context: BatchContext = { workdir: "", tabs: [] },
): Promise<BatchPlan> {
	// Loaded on demand: fengari is CJS-only and costs ~67 ms to evaluate, which every
	// CLI startup would otherwise pay, including runs that never load a batch script.
	const fengari = await import("fengari");
	const { lua, lauxlib, lualib, to_luastring, to_jsstring } = fengari.default ?? fengari;

	const L = lauxlib.luaL_newstate();
	lualib.luaL_openlibs(L);
	prependScriptDirToPackagePath(L, scriptPath, lua, to_luastring, to_jsstring);

	// Fallback for `script_dir` when the caller's chunk has no file name.
	const scriptDir = resolveBatchScriptDir(scriptPath);
	const requests: BatchTabRequest[] = [];

	// Register mixcode.open_tab(opts)
	lua.lua_newtable(L);
	lua.lua_pushcfunction(L, () => {
		if (!lua.lua_istable(L, 1)) {
			return lauxlib.luaL_error(L, to_luastring("mixcode.open_tab expects a table argument"));
		}

		const name = getStringField(L, 1, "name", lua, lauxlib, to_luastring, to_jsstring);
		if (!name) {
			return lauxlib.luaL_error(L, to_luastring("mixcode.open_tab: 'name' field is required"));
		}

		const prompt = getStringField(L, 1, "prompt", lua, lauxlib, to_luastring, to_jsstring) ?? undefined;
		const workdir = getStringField(L, 1, "workdir", lua, lauxlib, to_luastring, to_jsstring) ?? undefined;
		const model = getStringField(L, 1, "model", lua, lauxlib, to_luastring, to_jsstring) ?? undefined;
		const thinking = getStringField(L, 1, "thinking", lua, lauxlib, to_luastring, to_jsstring) ?? undefined;
		const systemPrompt = getStringField(L, 1, "system_prompt", lua, lauxlib, to_luastring, to_jsstring) ?? undefined;
		const mode =
			(getStringField(L, 1, "mode", lua, lauxlib, to_luastring, to_jsstring) as BatchReuseMode | null) ?? undefined;

		lua.lua_getfield(L, 1, to_luastring("context_limit"));
		const limitType = lua.lua_type(L, -1);
		// Preserve numeric inputs as numbers; Lua string coercion would hide invalid types.
		let rawLimit: unknown;
		if (limitType === lua.LUA_TNUMBER) rawLimit = lua.lua_tonumber(L, -1);
		else if (limitType === lua.LUA_TSTRING) rawLimit = to_jsstring(lua.lua_tostring(L, -1));
		else if (limitType !== lua.LUA_TNIL) rawLimit = false;
		lua.lua_pop(L, 1);

		let contextLimit: BatchTabRequest["contextLimit"];
		let prompts: string[] | undefined;
		try {
			contextLimit = parseBatchContextLimit(rawLimit, name);
			const rawPrompts = getPromptsField(L, name, lua, to_luastring, to_jsstring);
			prompts = parseBatchPrompts(rawPrompts, prompt, name);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			return lauxlib.luaL_error(L, to_luastring("%s"), to_luastring(message));
		}

		requests.push({
			name,
			prompt,
			...(prompts !== undefined ? { prompts } : {}),
			workdir,
			model,
			thinking,
			systemPrompt,
			mode,
			...(contextLimit !== undefined ? { contextLimit } : {}),
		});
		return 0;
	});
	lua.lua_setfield(L, -2, to_luastring("open_tab"));

	lua.lua_pushcfunction(L, () => {
		lua.lua_pushstring(L, to_luastring(context.workdir));
		return 1;
	});
	lua.lua_setfield(L, -2, to_luastring("current_workdir"));

	lua.lua_pushcfunction(L, () => {
		lua.lua_pushstring(L, to_luastring(callingScriptDir(L, lua, scriptDir, to_jsstring)));
		return 1;
	});
	lua.lua_setfield(L, -2, to_luastring("script_dir"));

	// CLI args after `--`; 1-indexed Lua array.
	lua.lua_pushcfunction(L, () => {
		const args = context.args ?? [];
		lua.lua_createtable(L, args.length, 0);
		args.forEach((arg, index) => {
			lua.lua_pushstring(L, to_luastring(arg));
			lua.lua_rawseti(L, -2, index + 1);
		});
		return 1;
	});
	lua.lua_setfield(L, -2, to_luastring("args"));

	lua.lua_pushcfunction(L, () => {
		const name = lua.lua_isnoneornil(L, 1) ? "" : to_jsstring(lua.lua_tostring(L, 1));
		lua.lua_pushboolean(
			L,
			context.tabs.some((tab) => tab.name === name),
		);
		return 1;
	});
	lua.lua_setfield(L, -2, to_luastring("tab_exists"));

	lua.lua_pushcfunction(L, () => {
		lua.lua_createtable(L, context.tabs.length, 0);
		context.tabs.forEach((tab, index) => {
			lua.lua_createtable(L, 0, 6);
			setStringField(L, "name", tab.name, lua, to_luastring);
			setStringField(L, "session_id", tab.sessionId, lua, to_luastring);
			setStringField(L, "workdir", tab.workdir, lua, to_luastring);
			setStringField(L, "model", tab.model, lua, to_luastring);
			setStringField(L, "thinking", tab.thinking, lua, to_luastring);
			setStringField(L, "status", tab.status, lua, to_luastring);
			lua.lua_rawseti(L, -2, index + 1);
		});
		return 1;
	});
	lua.lua_setfield(L, -2, to_luastring("list_tabs"));

	// Invocation snapshot of available models (same lifetime as list_tabs).
	lua.lua_pushcfunction(L, () => {
		const models = context.models ?? [];
		lua.lua_createtable(L, models.length, 0);
		models.forEach((model, index) => {
			lua.lua_createtable(L, 0, 6);
			setStringField(L, "id", model.id, lua, to_luastring);
			setStringField(L, "provider", model.provider, lua, to_luastring);
			setStringField(L, "model_id", model.modelId, lua, to_luastring);
			setStringField(L, "display_name", model.displayName, lua, to_luastring);
			lua.lua_pushnumber(L, model.contextWindow);
			lua.lua_setfield(L, -2, to_luastring("context_window"));
			lua.lua_pushboolean(L, model.reasoning);
			lua.lua_setfield(L, -2, to_luastring("reasoning"));
			lua.lua_rawseti(L, -2, index + 1);
		});
		return 1;
	});
	lua.lua_setfield(L, -2, to_luastring("list_models"));

	lua.lua_pushcfunction(L, () => {
		const query = lua.lua_type(L, 1) === lua.LUA_TSTRING ? to_jsstring(lua.lua_tostring(L, 1)) : undefined;
		try {
			lua.lua_pushstring(L, to_luastring(resolveBatchModel(query, context).id));
			return 1;
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			return lauxlib.luaL_error(L, to_luastring("%s"), to_luastring(message));
		}
	});
	lua.lua_setfield(L, -2, to_luastring("resolve_model"));

	const renderFn = () => luaRender(L, lua, lauxlib, to_luastring, to_jsstring);
	lua.lua_pushcfunction(L, renderFn);
	lua.lua_setfield(L, -2, to_luastring("render"));

	lua.lua_setglobal(L, to_luastring("mixcode"));
	lua.lua_pushcfunction(L, renderFn);
	lua.lua_setglobal(L, to_luastring("render"));

	// Name the chunk after the script path so Lua's own position prefix and the traceback frames
	// below read `<path>:<line>:`.
	const chunk = to_luastring(source);
	const loadStatus = lauxlib.luaL_loadbuffer(L, chunk, chunk.length, to_luastring(`@${scriptPath}`));
	if (loadStatus !== 0) {
		throw new Error(formatLuaError(scriptPath, luaErrorText(L, lua, lauxlib, to_jsstring)));
	}

	// The message handler appends the call chain a runtime error would otherwise lose.
	lua.lua_pushcfunction(L, () => {
		const message = luaErrorText(L, lua, lauxlib, to_jsstring);
		lauxlib.luaL_traceback(L, L, message, 1);
		return 1;
	});
	// lua_pcall takes the handler by stack index: place it under the chunk, which is on top.
	lua.lua_insert(L, -2);
	const status = lua.lua_pcall(L, 0, 0, lua.lua_gettop(L) - 1);
	if (status !== 0) {
		throw new Error(formatLuaError(scriptPath, luaErrorText(L, lua, lauxlib, to_jsstring)));
	}

	return { requests };
}

/**
 * Text of the error value on top of the stack. A script may raise any value, while Lua can only
 * prepend a traceback to a string, so a non-string is converted the way `tostring` would.
 */
function luaErrorText(L: any, lua: any, lauxlib: any, to_jsstring: (s: Uint8Array) => string): string {
	if (lua.lua_type(L, -1) === lua.LUA_TSTRING) return to_jsstring(lua.lua_tostring(L, -1));
	lauxlib.luaL_tolstring(L, -1);
	const text = to_jsstring(lua.lua_tostring(L, -1));
	lua.lua_pop(L, 1);
	return text;
}

/** Length of the chunk id Lua keeps; `luaO_chunkid` cuts a longer file name down to this. */
const LUA_CHUNK_ID_SIZE = 59;

/**
 * Fold Lua's position prefix into the `Lua error in <path>` line, so the path is printed once and
 * the rest of the message starts at the line number. A file chunk id longer than
 * `LUA_CHUNK_ID_SIZE` is printed as `...` plus its tail, so both forms are matched.
 */
function formatLuaError(scriptPath: string, errText: string): string {
	const chunkId = `@${scriptPath}`;
	const prefixes = [`${scriptPath}:`];
	if (chunkId.length > LUA_CHUNK_ID_SIZE) {
		const keptTail = chunkId.slice(chunkId.length - (LUA_CHUNK_ID_SIZE - 3));
		prefixes.push(`...${keptTail}:`);
	}
	const prefix = prefixes.find((candidate) => errText.startsWith(candidate));
	if (prefix === undefined) return `Lua error in ${scriptPath}: ${errText}`;
	return `Lua error in ${scriptPath}:${errText.slice(prefix.length)}`;
}

/**
 * Absolute directory holding the batch script file, with native separators.
 * Shared by `script_dir` / `scriptDir()` and the Lua `require` search path.
 * Symlinks are not resolved.
 */
export function resolveBatchScriptDir(scriptPath: string): string {
	return path.dirname(path.resolve(scriptPath));
}

/**
 * Directory reported by `mixcode.script_dir()`. The caller's chunk decides it, so a
 * module loaded with `require` sees its own directory instead of the entry script's.
 */
function callingScriptDir(L: any, lua: any, entryDir: string, to_jsstring: (s: Uint8Array) => string): string {
	const ar = new lua.lua_Debug();
	if (lua.lua_getstack(L, 1, ar) === 0) return entryDir;
	if (lua.lua_getinfo(L, "S", ar) === 0) return entryDir;
	const source = ar.source ? to_jsstring(ar.source) : "";
	// Fengari prefixes file-backed chunks with "@"; others use "=" or "[string ...]".
	if (!source.startsWith("@")) return entryDir;
	return resolveBatchScriptDir(source.slice(1));
}

/**
 * Prepend the script's directory to `package.path`, so `require` in a batch script
 * finds sibling modules no matter where the host runs from.
 */
function prependScriptDirToPackagePath(
	L: any,
	scriptPath: string,
	lua: any,
	to_luastring: (s: string) => Uint8Array,
	to_jsstring: (s: Uint8Array) => string,
): void {
	const scriptDir = resolveBatchScriptDir(scriptPath).replaceAll("\\", "/");
	lua.lua_getglobal(L, to_luastring("package"));
	lua.lua_getfield(L, -1, to_luastring("path"));
	const existingPath = to_jsstring(lua.lua_tostring(L, -1));
	lua.lua_pop(L, 1);
	const scriptDirTemplates = `${scriptDir}/?.lua;${scriptDir}/?/init.lua`;
	lua.lua_pushstring(L, to_luastring(`${scriptDirTemplates};${existingPath}`));
	lua.lua_setfield(L, -2, to_luastring("path"));
	lua.lua_pop(L, 1);
}

/** The `mixcode.render` / global `render` implementation; returns its Lua return count. */
function luaRender(
	L: any,
	lua: any,
	lauxlib: any,
	to_luastring: (s: string) => Uint8Array,
	to_jsstring: (s: Uint8Array) => string,
): number {
	if (lua.lua_isnoneornil(L, 1)) {
		return lauxlib.luaL_error(L, to_luastring("render expects a template string"));
	}
	if (!lua.lua_istable(L, 2)) {
		return lauxlib.luaL_error(L, to_luastring("render expects a variables table"));
	}
	const template = to_jsstring(lua.lua_tostring(L, 1));
	try {
		const rendered = renderTemplate(template, (name) => {
			lua.lua_getfield(L, 2, to_luastring(name));
			if (lua.lua_isnil(L, -1) || lua.lua_isnoneornil(L, -1)) {
				lua.lua_pop(L, 1);
				return undefined;
			}
			lauxlib.luaL_tolstring(L, -1);
			const value = to_jsstring(lua.lua_tostring(L, -1));
			lua.lua_pop(L, 2);
			return value;
		});
		lua.lua_pushstring(L, to_luastring(rendered));
		return 1;
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return lauxlib.luaL_error(L, to_luastring(message));
	}
}

/** Read only a dense, 1-indexed Lua array; never coerce numbers into prompt text. */
function getPromptsField(
	L: any,
	tabName: string,
	lua: any,
	to_luastring: (s: string) => Uint8Array,
	to_jsstring: (s: Uint8Array) => string,
): unknown {
	lua.lua_getfield(L, 1, to_luastring("prompts"));
	try {
		if (lua.lua_isnil(L, -1)) return undefined;
		if (!lua.lua_istable(L, -1)) return false;
		const tableIndex = lua.lua_gettop(L);
		const length = lua.lua_rawlen(L, tableIndex);
		let count = 0;
		lua.lua_pushnil(L);
		while (lua.lua_next(L, tableIndex) !== 0) {
			const index = lua.lua_tointeger(L, -2);
			if (!lua.lua_isinteger(L, -2) || index < 1 || index > length) {
				throw new Error(`Error: Invalid prompts for tab '${tabName}': expected a dense array`);
			}
			count++;
			lua.lua_pop(L, 1);
		}
		if (count !== length) {
			throw new Error(`Error: Invalid prompts for tab '${tabName}': expected a dense array`);
		}
		const prompts: unknown[] = [];
		for (let index = 1; index <= length; index++) {
			lua.lua_rawgeti(L, tableIndex, index);
			prompts.push(lua.lua_type(L, -1) === lua.LUA_TSTRING ? to_jsstring(lua.lua_tostring(L, -1)) : undefined);
			lua.lua_pop(L, 1);
		}
		return prompts;
	} finally {
		// Restore the open_tab argument stack even when validation rejects a key.
		lua.lua_settop(L, 1);
	}
}

/**
 * Read a string field from a Lua table at the given stack index. Returns null for a
 * nil field, and raises a Lua error for a non-string one.
 */
function getStringField(
	L: any,
	tableIndex: number,
	field: string,
	lua: any,
	lauxlib: any,
	to_luastring: (s: string) => Uint8Array,
	to_jsstring: (s: Uint8Array) => string,
): string | null {
	lua.lua_getfield(L, tableIndex, to_luastring(field));
	if (lua.lua_isnil(L, -1) || lua.lua_isnoneornil(L, -1)) {
		lua.lua_pop(L, 1);
		return null;
	}
	if (lua.lua_type(L, -1) !== lua.LUA_TSTRING) {
		return lauxlib.luaL_error(L, to_luastring(`mixcode.open_tab: '${field}' field must be a string`));
	}
	const value = to_jsstring(lua.lua_tostring(L, -1));
	lua.lua_pop(L, 1);
	return value;
}

function setStringField(L: any, field: string, value: string, lua: any, to_luastring: (s: string) => Uint8Array): void {
	lua.lua_pushstring(L, to_luastring(value));
	lua.lua_setfield(L, -2, to_luastring(field));
}
