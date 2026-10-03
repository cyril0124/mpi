# Skill Isolation

[中文文档](skill-isolation.zh.md)

`MPI_PROJECT_SKILLS_ONLY` makes a session see only the skills its workdir ships. It is off by
default; set it to `1` (or `true`, `on`, `yes`, case-insensitive, surrounding whitespace ignored)
and two rules drop skills:

- any skill the loader hands the filter with `user` scope, which in practice is every skill from
  `<agent dir>/skills`;
- any skill whose file lives outside the workdir.

Scope is read before the loader tags each surviving skill with the root it came from, so a skill
that survives still shows that root's label: `[u]` for `~/.agents/skills`, `[p]` under a project.

`0`, `false`, `off`, `no`, an empty value and an unset variable leave discovery alone. Every other
non-empty value counts as on, `MPI_PROJECT_SKILLS_ONLY=disabled` included.

The variable suits a shared machine: benchmarks, evaluations, or a checkout per repository, where
your personal `~/.agents/skills` should not reach a project's prompt.

## What survives

| Root | Default | With `MPI_PROJECT_SKILLS_ONLY` |
| --- | --- | --- |
| `<workdir>/.pi/skills` | loaded | loaded |
| `<workdir>/.agents/skills` | loaded | loaded |
| `.agents/skills` above the workdir, up to the git root | loaded | dropped |
| `<agent dir>/skills` (`~/.pi/agent/skills`) | loaded | dropped by the scope rule |
| `~/.agents/skills` | loaded | dropped by the path rule |

The `~/.agents/skills` row assumes a workdir that does not contain that directory. Whenever it falls
inside the workdir, at any depth, the path rule keeps those skills. The `<agent dir>/skills` row has
no such case: the scope rule drops it wherever it sits, including inside the workdir.

Paths added explicitly with `--skill`, or through a settings file, go through the same filter: a
skill outside the workdir is dropped there too.

## Where it applies

The filter runs inside the resource loader's `skillsOverride` hook, so one decision covers every
surface that reads the loaded skills:

- the `<available_skills>` block of the system prompt,
- `/skill:<name>` invocation from the composer,
- every list built from the loaded skills (the interactive startup panel, `/skill:` completion,
  the SDK session and `--rpc`).

A dropped skill is invisible on every surface listed above, not only in the prompt. Invoking a name
that is no longer loaded is not an error: `/skill:<name>` passes through unchanged and reaches the
model as ordinary text.

The gate is applied where the CLI builds a session's resources (`packages/coding-agent/src/main.ts`
passes the override into `createAgentSessionServices`). An embedder that builds its own
`DefaultResourceLoader` and never passes the override sees every root, as upstream does.

## Upstream difference

Upstream pi has no such variable: it always merges the user and project roots. The fork adds the
gate without changing what an unset variable loads, so a session that does not set it discovers
skills exactly as upstream does.
