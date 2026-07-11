import { readdir } from 'node:fs/promises'
import path from 'node:path'
import { diagnostics } from '../diagnostics'

/**
 * A Skill discovered inside a skills container directory, normalized so callers
 * can install it flat regardless of how the source organized it.
 *
 * - `name` is the flattened leaf directory name (`clean-code`); it drives the
 *   flat provider-dir target (`.claude/skills/clean-code`).
 * - `sourceRelPath` is the Skill's location relative to the scanned container,
 *   in posix form (`coding/clean-code` for a catalog layout, `clean-code` for a
 *   flat one); it drives the copy/link source.
 * - `group` is the source category the Skill sits under (`coding`), or
 *   `undefined` when the Skill is not nested. It is display-only — used to group
 *   interactive selection — and is never persisted into `.ai/`.
 */
export interface ResolvedSkill {
  name: string
  sourceRelPath: string
  group?: string
}

/**
 * Discover every Skill inside a skills container (e.g. `.ai/skills`), flattening
 * catalog layouts (`<category>/<name>/SKILL.md`) down to their leaf name.
 *
 * A directory that directly contains a `SKILL.md` is a Skill and is not
 * descended into; any other directory is treated as a category and walked one
 * level further. Two Skills that flatten to the same `name` are a collision and
 * raise `AIRIG_R0022` — a flat provider namespace cannot hold both.
 *
 * Returns the Skills sorted by `sourceRelPath` for deterministic output. A
 * missing or unreadable container yields an empty list rather than throwing, so
 * callers can probe a container that may not exist.
 */
export async function resolveSkills(skillsDir: string): Promise<ResolvedSkill[]> {
  const leafRelPaths = await findSkillLeaves(skillsDir, '')
  leafRelPaths.sort()

  const skills: ResolvedSkill[] = []
  const seen = new Map<string, string>()

  for (const sourceRelPath of leafRelPaths) {
    const name = path.posix.basename(sourceRelPath)
    const existing = seen.get(name)
    if (existing !== undefined) {
      throw diagnostics.AIRIG_R0022({ name, firstPath: existing, secondPath: sourceRelPath })
    }
    seen.set(name, sourceRelPath)

    const parent = path.posix.dirname(sourceRelPath)
    skills.push({
      name,
      sourceRelPath,
      ...(parent === '.' ? {} : { group: parent }),
    })
  }

  return skills
}

/**
 * Collect the posix-relative paths (relative to the original container) of every
 * directory that directly contains a `SKILL.md`, descending through category
 * directories that do not. `relPath` accumulates the path walked so far.
 */
async function findSkillLeaves(absDir: string, relPath: string): Promise<string[]> {
  let entries: Awaited<ReturnType<typeof readdir>>
  try {
    entries = await readdir(absDir, { withFileTypes: true })
  } catch {
    return []
  }

  if (entries.some(entry => entry.isFile() && entry.name === 'SKILL.md')) {
    return relPath === '' ? [] : [relPath]
  }

  const leaves: string[] = []
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const childRel = relPath === '' ? entry.name : path.posix.join(relPath, entry.name)
    leaves.push(...await findSkillLeaves(path.join(absDir, entry.name), childRel))
  }
  return leaves
}
