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

const GITHUB_URL_PREFIX = /^(?:https?:\/\/)?github\.com\//i

/**
 * Parse a Skills Repo reference. Unlike {@link parsePackageRef}, the segments
 * after `owner/repo` are a direct-path selector for a single Skill, not part of
 * the repo name. Both the `owner/repo` shorthand and full GitHub URLs are
 * accepted: `owner/repo`, `owner/repo@ref`, `owner/repo/skill`,
 * `owner/repo/nested/skill@ref`, `https://github.com/owner/repo`,
 * `https://github.com/owner/repo.git`, and
 * `https://github.com/owner/repo/tree/<ref>/skills/<skill>`.
 */
export function parseSkillsRef(pkg: string): SkillsRepoRef {
  return GITHUB_URL_PREFIX.test(pkg) ? parseSkillsUrl(pkg) : parseSkillsShorthand(pkg)
}

function parseSkillsShorthand(pkg: string): SkillsRepoRef {
  const { base, ref } = splitRef(pkg)
  const segments = base.split('/').filter(segment => segment.length > 0)
  if (segments.length < 2) {
    throw diagnostics.AIRIG_C0001({ pkg })
  }

  const [owner, repo, ...skillSegments] = segments
  return { owner, repo, ref, skillPath: joinSkillPath(skillSegments) }
}

/**
 * Parse a GitHub URL. A `/tree/<ref>` (or `/blob/<ref>`) segment supplies the
 * ref and anything after it is the single-skill subpath; a trailing `@ref`
 * overrides. `.git` suffixes and trailing slashes are tolerated.
 */
function parseSkillsUrl(pkg: string): SkillsRepoRef {
  const { base, ref: refFromSuffix } = splitRef(pkg)
  const afterHost = base.replace(GITHUB_URL_PREFIX, '').replace(/\/+$/, '')
  const segments = afterHost.split('/').filter(segment => segment.length > 0)
  if (segments.length < 2) {
    throw diagnostics.AIRIG_C0001({ pkg })
  }

  const owner = segments[0]
  const repo = segments[1].replace(/\.git$/i, '')
  let rest = segments.slice(2)

  let refFromTree: string | undefined
  if ((rest[0] === 'tree' || rest[0] === 'blob') && rest.length >= 2) {
    refFromTree = rest[1]
    rest = rest.slice(2)
  }

  return { owner, repo, ref: refFromSuffix ?? refFromTree, skillPath: joinSkillPath(rest) }
}

/** Split a trailing `@ref` off a reference, leaving the base. Only an `@` that
 * follows the host is treated as a ref delimiter, so `https://` is unaffected. */
function splitRef(pkg: string): { base: string; ref: string | undefined } {
  const atIdx = pkg.lastIndexOf('@')
  if (atIdx > pkg.indexOf('//') + 1) {
    return { base: pkg.slice(0, atIdx), ref: pkg.slice(atIdx + 1) }
  }
  return { base: pkg, ref: undefined }
}

function joinSkillPath(segments: string[]): string | undefined {
  return segments.length > 0 ? segments.join('/') : undefined
}
