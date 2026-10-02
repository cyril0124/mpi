---Batch script API for Lua scripts.
---Write a script file and run it with `mpi --batch script.lua` or `/batch script.lua`:
---
---```lua
---mixcode.open_tab({ name = "review", prompt = "Review the current branch." })
---```
---
---The TypeScript counterpart is `mixcode-batch.d.ts`. Field names are snake_case here.
---The runtime supplies the `mixcode` table; do not require or execute this stub.

---How a request treats an existing tab with the same name: "append", "clear", or "delete".
---@alias MixCodeBatchReuseMode string

---Thinking level: "off", "minimal", "low", "medium", "high", "xhigh", or "max".
---@alias MixCodeBatchThinkingLevel string

---@class MixCodeBatchOpenTabOptions
---@field name string Tab title; matched exactly when reusing an existing tab.
---@field prompt? string One input to submit; mutually exclusive with prompts.
---@field prompts? string[] Ordered inputs, each its own round; blank entries are skipped.
---@field workdir? string Workdir for a new tab; a different workdir on an existing tab is rejected.
---@field model? string Model id or provider/modelId from mixcode.list_models().
---@field thinking? MixCodeBatchThinkingLevel
---@field context_limit? number|string Positive tokens, a /context-limit string such as "32k", or "reset".
---@field system_prompt? string Base system prompt for a new session; the interactive host rejects it.
---@field mode? MixCodeBatchReuseMode Defaults to "append".

---Collect a tab request. Requests are applied after the script returns.
---@param options MixCodeBatchOpenTabOptions
function mixcode.open_tab(options) end

---Arguments after `--`, verbatim, as a 1-indexed array.
---@return string[]
function mixcode.args() end

---Directory the invocation runs in: the calling tab's workdir for /batch, else the instance workdir.
---@return string
function mixcode.current_workdir() end

---Directory of the file calling this function; differs from current_workdir() when the script lives elsewhere.
---@return string
function mixcode.script_dir() end

---Whether the snapshot holds a tab with this exact title.
---@param name string
---@return boolean
function mixcode.tab_exists(name) end

---Tabs captured before this invocation.
---@return table[]
function mixcode.list_tabs() end

---Model catalog captured before this invocation.
---@return table[]
function mixcode.list_models() end

---Resolve a model reference to a canonical provider/modelId, or raise when no enabled model matches.
---@param query string
---@return string
function mixcode.resolve_model(query) end

---Fill `{name}` placeholders from vars; `{{` and `}}` are literal braces.
---@param template string
---@param vars table
---@return string
function mixcode.render(template, vars) end

---Global shorthand for `mixcode.render`.
---@param template string
---@param vars table
---@return string
function render(template, vars) end
