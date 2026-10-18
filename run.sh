#!/usr/bin/env bash
set -euo pipefail

repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
workdir="$(pwd)"
cd "$repo_dir"

# Repair partial installs as well as missing dependencies.
# Probing tsgo is what TypeScript 7 retired: typescript@7 ships `tsc` only, so the probe failed
# on every launch and reinstalled the whole workspace first.
if [ ! -x node_modules/.bin/tsc ] ||
  [ ! -x node_modules/.bin/shx ] ||
  [ ! -f node_modules/typebox/build/index.mjs ] ||
  [ ! -f node_modules/typebox/build/index.d.mts ]; then
  bun install --force --ignore-scripts --no-save
fi

export PATH="$repo_dir/node_modules/.bin:$PATH"

dist_entry="$repo_dir/packages/coding-agent/dist/bun/cli.js"
build_marker="$repo_dir/packages/coding-agent/dist/bundle/cli.js"

# The bundle launcher is written only after the workspace build succeeds.
needs_build() {
  if [ ! -f "$dist_entry" ] || [ ! -f "$build_marker" ]; then
    return 0
  fi

  local newer_inputs
  newer_inputs="$(find packages scripts \
    \( -name node_modules -o -name dist -o -name .git \) -prune -o \
    -type f -newer "$build_marker" -print -quit)"
  if [ -n "$newer_inputs" ]; then
    return 0
  fi

  local input
  for input in run.sh package.json package-lock.json bun.lock bun.lockb bunfig.toml tsconfig*.json; do
    if [ -f "$input" ] && [ "$input" -nt "$build_marker" ]; then
      return 0
    fi
  done
  return 1
}

if [ "${PI_DEV:-0}" = "1" ]; then
  cd "$workdir"
  exec bun "$repo_dir/packages/coding-agent/src/bun/cli.ts" "$@"
fi

if needs_build; then
  # The generated catalog under packages/ai/src/providers/data/ is gitignored, so an
  # upstream sync does not carry it forward and it can describe an older generator than
  # the one baking it into this build. check:model-data only validates the data's
  # structure, so content drift - a model entry missing a field the generator now always
  # writes - passes it. Refresh from the upstream catalogs on every build instead.
  if [ "${SKIP_MODEL_HYDRATE:-0}" = "1" ]; then
    bun run check:model-data >/dev/null 2>&1 || {
      echo "Model data is missing or structurally stale; rerun without SKIP_MODEL_HYDRATE=1" >&2
      exit 1
    }
  else
    bun run hydrate:model-data
  fi
  bun run build:offline
fi

cd "$workdir"
exec bun "$dist_entry" "$@"
