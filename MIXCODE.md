# MixCode fork rules

Fork-local rules for this checkout. Upstream's contributor rules stay in `AGENTS.md`; these do
not come from upstream.

## Branch

Use `master` for local commits.

## Upstream sync

Merge upstream release tags into `master`; never rebase the fork onto upstream. A merge keeps
fork commit SHAs stable and keeps `--first-parent` usable for separating fork commits from
upstream ones, and each conflict is resolved once. A rebase rewrites every fork commit SHA on
each sync and re-opens the same conflicts.

Match the upstream release tag for all content unrelated to MixCode, including differences left
by earlier merges. In `git diff <tag> HEAD`, every remaining change must serve a specific MixCode
feature or record the sync. Keep edits in shared files to the integration that MixCode requires.

Put feature code in the affected area's `mixcode/` directory. Shared helpers go directly
under `mixcode/`. Put feature tests in `packages/<package>/test/mixcode/`, one file per module.
The TUI runner reads flat test paths, so use `packages/tui/test/mixcode-<module>.test.ts` there.

`UPSTREAM.json` records the upstream version the fork is based on: `url`, `tag`, `commit`,
`syncedAt`. When merging an upstream tag, update `tag`, `commit` and `syncedAt` in the same
commit as the merge. Do not add fields for branch name or commit dates; `git branch` and
`git log` already carry them.

## Tests

Run `./test-all.sh` for fork changes: it runs every mixcode test, one package at a time, and covers only fork test paths. It does not replace `./test.sh`, the upstream gate for the whole non-e2e suite.

## Documentation

Fork documentation lives in `docs/` at the repo root, as English files with matching `.zh.md`
translations that link to each other. Never edit an upstream-owned page for fork behavior —
`packages/*/docs/`, `packages/*/README.md`, `packages/*/CHANGELOG.md`, or `src/**/*.md`: a fork
edit there conflicts on every upstream merge. Record every divergence in
`docs/upstream-drift.md` in the same commit as the change that causes it. Record fork releases
and changes in `MIXCODE_CHANGELOG.md`, grouped by upstream base tag.

## Tooling

Use `bun` to run things: `bun run <script>`, `bun scripts/foo.ts`, and `run.sh` for the dev loop.
`run.sh` installs with `bun install --force --ignore-scripts --no-save`, so a local install writes
no `bun.lock`; keep it that way.

After dependency changes, run `npm install --package-lock-only --ignore-scripts` and
`npm run install-lock:coding-agent` to update the npm locks. Run `npm run check` from a clean
checkout outside any tree containing scratch checkouts. The dependency and import checks walk
subdirectories directly.
