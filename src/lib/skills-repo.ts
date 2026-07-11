import { cp, mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import extractZip from 'extract-zip'
import type { ResolvedSkill } from './skill-resolver'
import { diagnostics } from '../diagnostics'

/**
 * Extract a repository zipball into a temp directory, locate the single
 * top-level directory GitHub wraps the tree in (`<owner>-<repo>-<sha>`), and hand
 * its path to `fn`. The temp directory is always removed afterwards.
 */
export async function withExtractedRepoZip<T>(
  zipBuffer: Buffer,
  tmpPrefix: string,
  fn: (repoRoot: string) => Promise<T>,
): Promise<T> {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), tmpPrefix))
  try {
    const zipPath = path.join(tmpDir, 'repo.zip')
    await writeFile(zipPath, zipBuffer)

    const extractDir = path.join(tmpDir, 'extracted')
    await mkdir(extractDir)
    await extractZip(zipPath, { dir: extractDir })

    return await fn(await repoRootOf(extractDir))
  } finally {
    await rm(tmpDir, { recursive: true, force: true })
  }
}

/**
 * Copy each selected Skill into the flat remote install cache at
 * `<sourceRoot>/skills/<name>`, collapsing whatever catalog nesting it had in the
 * source (`skills/<category>/<name>` → `.ai/skills/<name>`). An existing
 * destination is replaced so an update refreshes content in place.
 */
export async function copyRepoSkillsToLocal(
  repoRoot: string,
  skills: ResolvedSkill[],
  sourceRoot = '.ai',
): Promise<void> {
  const skillsRoot = path.join(sourceRoot, 'skills')
  await mkdir(skillsRoot, { recursive: true })

  for (const skill of skills) {
    const source = path.join(repoRoot, skill.sourceRelPath)
    const dest = path.join(skillsRoot, skill.name)
    await rm(dest, { recursive: true, force: true })
    await cp(source, dest, { recursive: true, verbatimSymlinks: true })
  }
}

async function repoRootOf(extractDir: string): Promise<string> {
  const entries = await readdir(extractDir, { withFileTypes: true })
  const directories = entries.filter(entry => entry.isDirectory())
  const root = directories[0]
  if (directories.length !== 1 || !root) {
    throw diagnostics.AIRIG_R0028()
  }
  return path.join(extractDir, root.name)
}
