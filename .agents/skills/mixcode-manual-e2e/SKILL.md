---
name: mixcode-manual-e2e
description: Create user-runnable manual TUI demos and reproducers for this pi fork.
disable-model-invocation: true
---

# MixCode Manual E2E

Reproduce the requested behavior in this checkout’s fullscreen TUI and retain live evidence.

```text
./tmp/<feature-slug>-manual/run.sh → idle fullscreen TUI
Ready: type /repro              → one submission drives every phase
Visible result                   → same input starts a fresh run
```

Use one in-TUI entry point. Prefer `/repro` for multi-step flows. An existing command or exact message qualifies if it drives the entire scenario. Keep the TUI open after completion. Startup waits for input. Scrolling and expanding are optional. Report any blocker that would require another action, config edit, or terminal.

## Boundaries

- Work only under `tmp/<feature-slug>-manual/`. Read existing demo files before editing and preserve unrelated work. Use unique runtime and tmux resources. Ask only about conflicts or requirements the repo cannot resolve.
- Feed local faux responses through real commands, tools, and public extension APIs. Keep errors visible. Never call external model APIs, use user credentials, synthesize lifecycle events, mutate internal UI state, or fake results. Report states the public offline flow cannot reach instead of adding test hooks. Preserve product source, formal tests, dependencies, and permanent user config.

## 1. Map the flow

Resolve repo links from this skill’s directory, three levels below the checkout root.

1. Read [AGENTS.md](../../../AGENTS.md), [MIXCODE.md](../../../MIXCODE.md), and [run.sh](../../../run.sh). Inspect the feature and its callers in this checkout. Find fork code under `packages/*/src/**/mixcode/` and commands and keys in the [fork docs](../../../docs/README.md) and [upstream drift](../../../docs/upstream-drift.md).
2. Check [extension](../../../packages/coding-agent/docs/extensions.md), [CLI](../../../packages/coding-agent/docs/cli.md), and [configuration](../../../packages/coding-agent/docs/configuration.md) contracts plus workspace types and examples, including `node_modules`.
3. Map idle, streaming or running, success, failure, timeout, abort, empty output, and feature-specific states to real triggers and expected visible text. Give a reason for each inapplicable or unreachable state.
4. Choose the one input. Map setup and async phases behind it. Use realistic fixtures and keep transient states readable.

## 2. Build the Demo

Keep only scenario-required files:

```text
tmp/<feature-slug>-manual/
├── README.md
├── run.sh
├── extensions/demo.ts          # local provider and optional orchestration
├── project-pi/settings.json
└── evidence/run.XXXXXX/        # retained captures and outputs from each run
```

### Source launcher and isolation

Use an argument-free launcher. Repo `run.sh` with `PI_DEV=1` runs `packages/coding-agent/src/bun/cli.ts` from source. Check dependencies before launch to prevent auto-install. Report missing prerequisites separately.

Both stdin and stdout require terminals. Either redirected stream triggers print mode. Use a tmux pane for headless driving and capture with `capture-pane`. `--tui-mode fullscreen` selects the layout once interactive mode is available.

Replace `<feature-slug>` and make `run.sh` executable:

```bash
#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_dir="$(cd "$script_dir/../.." && pwd)"

if [ ! -t 0 ] || [ ! -t 1 ]; then
  printf 'Interactive TUI required: run this launcher in a terminal or tmux pane.\n' >&2
  exit 1
fi

command -v bun >/dev/null
if [ ! -x "$repo_dir/node_modules/.bin/tsc" ] ||
   [ ! -f "$repo_dir/node_modules/typebox/build/index.mjs" ] ||
   [ ! -f "$repo_dir/node_modules/typebox/build/index.d.mts" ]; then
  printf 'Missing workspace dependencies; prepare the checkout before running this demo.\n' >&2
  exit 1
fi

runtime_dir="$(mktemp -d "${TMPDIR:-/tmp}/pi-<feature-slug>-manual.XXXXXX")"
agent_dir="$runtime_dir/agent"
workdir="$runtime_dir/workdir"

cleanup() {
  rm -rf -- "$runtime_dir"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

mkdir -p "$agent_dir" "$workdir" "$script_dir/evidence"
evidence_dir="$(mktemp -d "$script_dir/evidence/run.XXXXXX")"
cp -R "$script_dir/project-pi" "$workdir/.pi"
printf 'Runtime: %s\nEvidence: %s\n' "$runtime_dir" "$evidence_dir"
printf '%s\n' "$runtime_dir" > "$evidence_dir/runtime-path.txt"

cd "$workdir"
env -i \
  PATH="$PATH" \
  HOME="$HOME" \
  TERM="${TERM:-xterm-256color}" \
  COLORTERM="${COLORTERM:-}" \
  LANG="${LANG:-C.UTF-8}" \
  PI_DEV=1 \
  PI_OFFLINE=1 \
  PI_CODING_AGENT_DIR="$agent_dir" \
  MIXCODE_EVIDENCE_DIR="$evidence_dir" \
  VISUAL=/bin/true \
  EDITOR=/bin/true \
  "$repo_dir/run.sh" \
  --tui-mode fullscreen \
  --approve \
  --no-extensions --extension "$script_dir/extensions/demo.ts" \
  --no-skills --no-prompt-templates --no-themes --no-context-files
```

- `env -i` strips credentials and session overrides. Preserve the caller’s `COLORTERM` for truecolor detection. `PI_CODING_AGENT_DIR` isolates settings, auth, models, trust, sessions, and workspace state.
- `--approve` trusts the generated workdir for this invocation. Copy `.pi` to protect the fixture from settings writes. Load the demo extension explicitly against checkout dependencies. Discovery flags exclude unrelated resources, including home skills and ancestor context. Enable a category only when testing it, with controlled fixtures and documented limits.
- `PI_OFFLINE` suppresses automatic network activity. Explicit provider calls still require the local faux model. Config isolation leaves filesystem access intact. Store persistent outputs in `$MIXCODE_EVIDENCE_DIR` and remove runtime files on exit.

### Single entry point

Import `fauxProvider` and response helpers from `@earendil-works/pi-ai` ([provider source](../../../packages/ai/src/providers/faux.ts)). Register `faux.provider` with `pi.registerProvider()` in the extension factory before startup model selection. The provider supplies models and local auth. Use `models.json` only for required overrides.

Match the registered provider and model in project settings. Minimal example for `manual-e2e` and `alpha`:

```json
{
  "defaultProvider": "manual-e2e",
  "defaultModel": "alpha",
  "retry": { "enabled": false }
}
```

Use the public [extension API](../../../packages/coding-agent/src/core/extensions/types.ts) for every phase.

1. In `session_start`, verify the local provider/model and show the exact trigger via `ctx.ui.setStatus()` or `ctx.ui.notify()`. Fail with a registration, loading, or selection diagnostic on mismatch. Limit startup to verification and readiness.
2. Register one `/repro` handler with `pi.registerCommand()` or handle one exact message deterministically. Reset fixtures, queue faux responses, and invoke real operations. Call `pi.sendUserMessage()` internally if the agent/tool pipeline needs it. Enable retries only for retry scenarios. Size context and fixtures to meet real preconditions.
3. Before each phase trigger, show `CHECKPOINT n/N: <what to inspect>` via public UI and append it to `$MIXCODE_EVIDENCE_DIR/checkpoints.log`. Prove the behavior with pane captures and real output. Use single-digit `tokensPerSecond` or slow real tool work to leave a readable running state.
4. Drive all phases through public completion/idle APIs with bounded waits and cancellation. Reject duplicate triggers until the real work finishes. Release the guard on success, failure, or cancellation and reset scenario-local state on the next run.

## 3. Write the README

Use the user’s language and preserve exact commands, keys, and UI text. Include:

1. Shell launcher, prerequisites, and time to idle fullscreen TUI.
2. One copyable in-TUI input, scenario duration, and expected visible result.
3. Ordered automatic checkpoints, followed separately by optional observation keys and normal exit. Use current fork bindings.
4. Coverage table with state, trigger, expected text, observed result, evidence file, and limitation. Distinguish inapplicable from unverified states.
5. Local provider/model, runtime cleanup, and retained evidence location.

## 4. Verify in the fullscreen TUI

Follow [interactive-testing](../../../.pi/skills/interactive-testing.md) using a dedicated tmux socket. Passing requires `#{alternate_on}` = `1`, full-pane captures of idle readiness and the actual behavior, and completion after one editor submission. Print, JSON, RPC, SDK calls, imports, and canned replies count only as preparation. Without a live run, report blocked.

1. Check `bash -n`, executable bit, and JSON parsing. Confirm non-terminal execution fails with the TUI-required message. Validate the extension with installed workspace tools and the real loader. Docs/demo-only work needs no repository-wide build or tests.
2. Set `socket="pi-<feature-slug>-e2e-$$"` and launch `tmux -L "$socket" -f /dev/null new-session -d -s demo -x 120 -y 36 "$repo_dir/tmp/<feature-slug>-manual/run.sh"`. Record socket and pane size. Use the same socket for every command.
3. Capture readiness and observe at least 3 seconds without scenario activity. Send the README input with `tmux -L "$socket" send-keys -t demo:0.0 -l '<input>'`, followed by a separate `send-keys ... Enter`. Wait for the result without further input. For every applicable state, including async running, save `tmux -L "$socket" capture-pane -t demo:0.0 -p > "$evidence_dir/<state>.txt"`. Keep actual tool output and checkpoint logs in the launcher’s printed evidence directory.
4. Record the launcher/CLI process tree, selected model, and loaded resource paths. Confirm the checkout CLI and isolated faux model. Exercise documented preconditions and failure branches. For color differences, compare actual truecolor and 256-color output. Unexpected alternatives fail.
5. Submit the same input again and verify a fresh run without setup or reload. Exit through the UI. Verify the runtime in `runtime-path.txt` is gone and demo tmux session and child processes ended. Remove only the dedicated server and scratch files. Record cleanup and keep the demo and all captures. Mark missing captures or incomplete cleanup unverified.

## Delivery

Give the shell launcher first and the one in-TUI input separately. Report the observed behavior, demo path, verified coverage with evidence links, focused checks, local model, cleanup, and every blocker or unverified state. Tie each scenario success claim to a live capture.
