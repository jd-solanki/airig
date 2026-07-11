import { readdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
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
  return assembleSkills(leafRelPaths.map(leafRel => skillFromContainer('', leafRel)))
}

/**
 * The skills-CLI scan set, mirrored exactly (see the Skill glossary in
 * CONTEXT.md). Each entry is a container scanned like a `skills/` directory:
 * one level deep for flat skills, two for catalog layouts. `.curated`,
 * `.experimental`, and `.system` are transparent buckets, so they are scanned as
 * their own containers *and* excluded from the plain `skills/` walk — otherwise a
 * bucket skill would surface twice, once mislabeled with the bucket as its group.
 */
const SKILLS_REPO_CONTAINERS: ReadonlyArray<{ dir: string; excludeTopLevel?: readonly string[] }> = [
  { dir: 'skills', excludeTopLevel: ['.curated', '.experimental', '.system'] },
  { dir: 'skills/.curated' },
  { dir: 'skills/.experimental' },
  { dir: 'skills/.system' },
  { dir: '.agents/skills' },
  { dir: '.aider-desk/skills' },
]

/**
 * Discover every Skill in a bare skills-CLI repository, applying the full scan
 * set above and flattening each to its leaf `name`. A `SKILL.md` at the repo root
 * makes the whole repo a single Skill named `repoName` (its `sourceRelPath` is
 * `.`). Leaf-name collisions across any containers raise `AIRIG_R0022`, holding
 * the one-flat-namespace-per-target invariant across the whole repo.
 */
export async function resolveSkillsRepo(repoRoot: string, repoName: string): Promise<ResolvedSkill[]> {
  const leaves: ResolvedSkill[] = []

  if (existsSync(path.join(repoRoot, 'SKILL.md'))) {
    leaves.push({ name: repoName, sourceRelPath: '.' })
  }

  for (const container of SKILLS_REPO_CONTAINERS) {
    const containerAbs = path.join(repoRoot, container.dir)
    const leafRelPaths = await findSkillLeaves(containerAbs, '', container.excludeTopLevel)
    for (const leafRel of leafRelPaths) {
      leaves.push(skillFromContainer(container.dir, leafRel))
    }
  }

  return assembleSkills(leaves)
}

/**
 * Build a `ResolvedSkill` from a leaf path relative to its scan container: the
 * leaf's basename is the flattened `name`, its parent directory is the
 * display-only `group`, and its path under the container joins onto `container`
 * to form the repo-relative `sourceRelPath`.
 */
function skillFromContainer(container: string, leafRel: string): ResolvedSkill {
  const name = path.posix.basename(leafRel)
  const parent = path.posix.dirname(leafRel)
  const sourceRelPath = container === '' ? leafRel : path.posix.join(container, leafRel)
  return { name, sourceRelPath, ...(parent === '.' ? {} : { group: parent }) }
}

/**
 * Sort skills by source path for deterministic output and reject any two that
 * flatten to the same leaf `name` — a flat provider namespace cannot hold both.
 */
function assembleSkills(skills: ResolvedSkill[]): ResolvedSkill[] {
  const sorted = [...skills].sort(bySourceRelPath)
  const seen = new Map<string, string>()

  for (const skill of sorted) {
    const existing = seen.get(skill.name)
    if (existing !== undefined) {
      throw diagnostics.AIRIG_R0022({ name: skill.name, firstPath: existing, secondPath: skill.sourceRelPath })
    }
    seen.set(skill.name, skill.sourceRelPath)
  }

  return sorted
}

function bySourceRelPath(a: ResolvedSkill, b: ResolvedSkill): number {
  if (a.sourceRelPath < b.sourceRelPath) return -1
  if (a.sourceRelPath > b.sourceRelPath) return 1
  return 0
}

/**
 * Collect the posix-relative paths (relative to the original container) of every
 * directory that directly contains a `SKILL.md`, descending through category
 * directories that do not. `relPath` accumulates the path walked so far.
 */
async function findSkillLeaves(
  absDir: string,
  relPath: string,
  excludeTopLevel?: readonly string[],
): Promise<string[]> {
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
    // Exclusions apply only at the container top, where the special buckets sit;
    // deeper directories are ordinary categories and are always descended.
    if (relPath === '' && excludeTopLevel?.includes(entry.name)) continue
    const childRel = relPath === '' ? entry.name : path.posix.join(relPath, entry.name)
    leaves.push(...await findSkillLeaves(path.join(absDir, entry.name), childRel))
  }
  return leaves
}
