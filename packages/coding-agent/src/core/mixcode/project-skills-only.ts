/**
 * `MPI_PROJECT_SKILLS_ONLY`: keep skill discovery inside the workdir.
 *
 * A session normally sees skills from the project (`<workdir>/.pi/skills` and the
 * `.agents/skills` directories from the workdir up to the git root), from the user
 * (the agent dir's `skills/`, `~/.agents/skills`) and from whatever `--skill` or
 * settings add. The user roots are personal, so a shared machine, a benchmark or a
 * checkout per repository can want the model to see only what the workdir ships.
 *
 * With the variable on, the filter drops two kinds of skill: one the loader hands
 * it with `user` scope, which in practice is everything from the agent dir's
 * `skills/`, and one whose file lives outside the workdir. The filter runs in the
 * loader's `skillsOverride` hook, so the prompt and every skill invocation surface
 * agree: they all read `resourceLoader.getSkills()`.
 *
 * The variable takes `1` / `true` / `on` / `yes` (trimmed, case-insensitive), and
 * any other non-empty value enables it too. It is off when unset, empty or set to
 * `0` / `false` / `off` / `no`.
 */

import { getCwdRelativePath } from "../../utils/paths.ts";
import type { LoadSkillsResult } from "../skills.ts";

/** An override applied to the loader's skill result. */
export type SkillsOverride = (base: LoadSkillsResult) => LoadSkillsResult;

const FALSY_VALUES = ["0", "false", "off", "no"];

/** Whether `MPI_PROJECT_SKILLS_ONLY` asks for workdir-only skill discovery. */
export function isProjectSkillsOnlyEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
	const value = env.MPI_PROJECT_SKILLS_ONLY?.trim().toLowerCase();
	if (!value) return false;
	return !FALSY_VALUES.includes(value);
}

/**
 * Build the loader override for `workdir`, or `undefined` when the variable is
 * off. Returning `undefined` leaves the loader's own result untouched, so an
 * unset variable costs nothing and cannot change which skills are found.
 */
export function projectSkillsOnlyOverride(
	workdir: string,
	env: NodeJS.ProcessEnv = process.env,
): SkillsOverride | undefined {
	if (!isProjectSkillsOnlyEnabled(env)) return undefined;

	return (base) => ({
		...base,
		skills: base.skills.filter((skill) => {
			if (skill.sourceInfo?.scope === "user") return false;
			return getCwdRelativePath(skill.filePath, workdir) !== undefined;
		}),
	});
}
