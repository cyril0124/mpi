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

Keep the fork's edits in upstream-owned files down to the wiring that calls into `mixcode/`
code. A merge can only conflict where this fork edits a file upstream also edits, so every line
added to `interactive-mode.ts`, `keybindings.ts` or `slash-commands.ts` is a line to re-resolve
at each sync.

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
`docs/upstream-drift.md` in the same commit as the change that causes it.

## Tooling

Use `bun` to run things: `bun run <script>`, `bun scripts/foo.ts`, and `run.sh` for the dev loop.
`run.sh` installs with `bun install --force --ignore-scripts --no-save`, so a local install writes
no `bun.lock`; keep it that way.

Keep `npm` for the dependency layer: `package-lock.json` and
`packages/coding-agent/npm-shrinkwrap.json` are its output, and `npm run check` validates both.
Change dependencies with `npm install --package-lock-only --ignore-scripts` plus
`node scripts/generate-coding-agent-shrinkwrap.mjs`, never with `bun add`: bun writes `bun.lock`
only, so the npm lock goes stale while the checks stay green, and `npm ci` then fails upstream.
