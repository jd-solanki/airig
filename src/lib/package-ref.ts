import { diagnostics } from '../diagnostics'

export interface PackageRef {
  owner: string
  repo: string
  tag: string | undefined
}

export function parsePackageRef(pkg: string): PackageRef {
  const atIdx = pkg.lastIndexOf('@')
  let ref = pkg
  let tag: string | undefined

  if (atIdx > 0) {
    tag = pkg.slice(atIdx + 1)
    ref = pkg.slice(0, atIdx)
  }

  const slashIdx = ref.indexOf('/')
  if (slashIdx < 1 || slashIdx === ref.length - 1) {
    throw diagnostics.AIRIG_C0001({ pkg })
  }

  return { owner: ref.slice(0, slashIdx), repo: ref.slice(slashIdx + 1), tag }
}

export function parseExactPackageRef(pkg: string): Required<PackageRef> {
  const parsed = parsePackageRef(pkg)
  if (!parsed.tag) {
    throw diagnostics.AIRIG_C0002({ pkg })
  }
  return parsed as Required<PackageRef>
}

export interface SkillsRepoRef {
  owner: string
  repo: string
  /** A branch, tag, or commit SHA; `undefined` selects the default branch HEAD. */
  ref: string | undefined
  /** A single-skill direct path (name or source path), or `undefined` for all. */
  skillPath: string | undefined
}

/**
 * Parse a Skills Repo reference. Unlike {@link parsePackageRef}, the segments
 * after `owner/repo` are a direct-path selector for a single Skill, not part of
 * the repo name: `owner/repo`, `owner/repo@ref`, `owner/repo/skill`, and
 * `owner/repo/nested/skill@ref` are all valid.
 */
export function parseSkillsRef(pkg: string): SkillsRepoRef {
  const atIdx = pkg.lastIndexOf('@')
  let base = pkg
  let ref: string | undefined

  if (atIdx > 0) {
    ref = pkg.slice(atIdx + 1)
    base = pkg.slice(0, atIdx)
  }

  const segments = base.split('/').filter(segment => segment.length > 0)
  if (segments.length < 2) {
    throw diagnostics.AIRIG_C0001({ pkg })
  }

  const [owner, repo, ...skillSegments] = segments
  return {
    owner,
    repo,
    ref,
    skillPath: skillSegments.length > 0 ? skillSegments.join('/') : undefined,
  }
}
