#!/usr/bin/env bash
# Run every test for mixcode-synced code, one package at a time.
#
# Tests live in <package>/test/mixcode/*.test.ts, except in packages whose runner
# globs only test/*.test.ts, where they are flat test/mixcode-*.test.ts files.
# Only these files run here; ./test.sh runs the whole non-e2e suite.
set -uo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
vitest="$root/node_modules/vitest/dist/cli.js"
status=0
found=0

run() {
  local package_dir="$1"
  shift
  echo "== ${package_dir#"$root"/}"
  (cd "$package_dir" && "$@") || status=1
}

shopt -s nullglob

# Vitest packages: <package>/test/mixcode/<module>.test.ts
for dir in "$root"/packages/*/test/mixcode; do
  package_dir="$(dirname "$(dirname "$dir")")"
  files=("$dir"/*.test.ts)
  ((${#files[@]} == 0)) && continue
  found=1
  run "$package_dir" node "$vitest" --run "${files[@]#"$package_dir"/}"
done

# node:test packages (packages/tui): flat test/mixcode-<module>.test.ts
for dir in "$root"/packages/*/test; do
  package_dir="$(dirname "$dir")"
  files=("$dir"/mixcode-*.test.ts)
  ((${#files[@]} == 0)) && continue
  found=1
  run "$package_dir" node --test "${files[@]#"$package_dir"/}"
done

if ((found == 0)); then
  echo "No mixcode tests found."
fi

exit "$status"
