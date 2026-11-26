---
name: merge-upstream-pi
description: Preview and merge an upstream earendil-works/pi release tag into this fork.
disable-model-invocation: true
---

# Merge upstream pi

Preview every sync. The report determines when to merge. With confirmation, merge into `master` and land all sync work in one merge commit. Never push. Use the user's language, including report headings and table headers.

## 1. Preview

Read [MIXCODE.md](../../../MIXCODE.md#upstream-sync) for the rules on which changes the fork keeps.

1. Read `UPSTREAM.json` for the current base tag and SHA. Take the target tag from the invocation.
2. Run `git fetch upstream <tag>`. If the remote is missing, check `git remote -v` and add it with `git remote add upstream https://github.com/earendil-works/pi.git`.
3. Read upstream `CHANGELOG.md` and compare the incoming diff with the entire fork diff from the base to the current `master`. Review older non-MixCode changes even when the incoming diff leaves their files untouched.

   ```sh
   git log <base>..<tag> --oneline
   git diff --name-only <base>..<tag>
   git diff --name-only <base>..master
   git diff <base>..<tag> -- <file>
   ```

| Area | Paths | Review and conflict handling |
|---|---|---|
| Fork-owned | `packages/*/src/mixcode/`, `packages/*/src/modes/interactive/mixcode/`, `packages/*/src/modes/interactive/components/mixcode/` | Check for incompatible fork logic. Resolve and explain changes. |
| Wiring | `interactive-mode.ts`, `keybindings.ts`, `slash-commands.ts` | Check for moved, renamed, or removed hooks. Resolve and explain each wiring change. |
| Needs review | Shared files whose MixCode changes are outside the listed wiring | Follow the resolution authorized in the preview. Ask about a conflict when the agreed scope leaves its resolution open. |
| Pure upstream | Content unrelated to MixCode, including old fork edits | Restore from the target tag in the candidate checkout. |

### Report

Print a full Markdown report in this order. Use tables where useful.

1. **Versions** — base tag and SHA, target tag, commit count.
2. **Changelog** — table of summarized feat, fix, and other entries.
3. **Fork Impact** — changes to fork-owned code or wiring and the adaptations they may need. Mark informational changes `FYI only` and say explicitly if there is no overlap.
4. **Break Risks** — cover every fork touch point. **Hard** means checks or tests fail until adapted. **Soft** means it compiles but behavior or wiring needs verification. **Free** means untouched upstream.
5. **Optimization Opportunities** (optional) — pair fork files with upstream replacements, such as workarounds superseded by upstream work, newly exported APIs, or new hooks. Advisory until approved after the merge.
6. **Merge Work Preview** — hard break count, files needing manual review, rough effort.

End with `Confirm: proceed? (revise / run / run-verify)` and stop.

### Confirmation

The initial invocation only starts the preview. Continue only on the latest reply:

| Reply | Action |
|---|---|
| `revise` | Change target or scope and reprint the full report and confirmation. |
| `run` | Merge. |
| `run-verify` | Merge, then verify with an independent subagent. |
| A specific tag such as `v1.2.3` | Treat as `run` for that target. |
| Reply to the post-merge optimization list | Continue at **Optimizations** without repeating the preview or merge. |

A request for release news alone authorizes only the preview.

## 2. Merge

1. Record the current `master` as `<pre-merge-head>`. Check `git status` and flag overlap with local edits. Prepare the merge in a disposable checkout outside the repository. Verify its `HEAD` is `<pre-merge-head>` and its `<tag>` resolves to the fetched target SHA.
2. In the candidate checkout, run `git merge <tag> --no-ff --no-commit`. Resolve conflicts by the table above. After each resolved TS or JS file that Node can parse directly, run `node --check <file>` before resolving the next one.
3. In `UPSTREAM.json`, update `tag`, `commit` (full target SHA), and `syncedAt` (today in ISO format). Keep `url` and the existing schema. In `MIXCODE_CHANGELOG.md`, rename the current `## Unreleased — base pi <old tag>` heading to `## base pi <old tag> — <date>`, then prepend this stub above it:

   ```markdown
   ## Unreleased — base pi <tag>

   ### Added

   ### Changed

   ### Fixed

   ### Removed
   ```

4. Run `npm install --ignore-scripts` in the candidate checkout. Hydrate model data with the target tag's `nix/model-catalog.json` revision. Use the typed catalog URL from `nix/package.nix`, verify its SHA-256, and pass the JSON to `node packages/ai/scripts/hydrate-model-catalog.ts <catalog.json>`. Run `npm run build:offline`, then `npm run check` and `./test-all.sh`. Use the tag's generated TypeScript wrappers. If the pin is unavailable or fails verification, report the failure before choosing another input.
5. Run the regression scenarios identified during preview. For session lifecycle changes, cover a run that finishes behind another tab and verify its recorded output on return. Fix failures caused by the merge. If a failure also reproduces on the target tag, report it before changing upstream code. Save the check and test logs and record the candidate commit and catalog revision.
6. Stage only sync changes and commit with `git commit -m "feat: merge upstream pi <tag>"`. Review `git diff <tag> HEAD` against `MIXCODE.md`, including changes outside the incoming range. Verify both parents and exactly one line from `git log --first-parent --oneline <pre-merge-head>..HEAD`.
7. For `run-verify`, complete **Independent verification** first. In the original checkout, fetch the candidate SHA locally if it is in a separate clone. Confirm `master` still points to `<pre-merge-head>` and fast-forward it with `git merge --ff-only --no-overwrite-ignore <candidate>`. Stop and report if Git refuses. Report the merge and verification results, then continue to **Optimizations**.

## 3. Independent verification

For `run-verify`, give the subagent the candidate SHA, the approved preview, the check and test log paths, and the highest-risk scenario to reproduce. Verify parity with the target, metadata, both merge parents, and the scenario result. Fix only failed items, amend into the same merge commit, and recheck until clean or blocked. Return to step 7 to update `master`.

## 4. Optimizations

After a clean merge and any independent verification, reprint the optimization list. Number entries and give the fork file, upstream replacement, benefit, and rough effort. If there are none, say so and stop. Otherwise ask which to apply and stop. Accept replies in the user's own words.

Apply only confirmed items, with minimal changes in fork-owned code. Re-run `npm run check` and `./test-all.sh`. Amend into `feat: merge upstream pi <tag>` and recheck the one-line first-parent range from `<pre-merge-head>`. Report applied items, files touched, check results, and reasons for any skipped items.
