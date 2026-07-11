import { cp, mkdir, mkdtemp, readdir, readlink, rename, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import extractZip from 'extract-zip'
import { lstatIfExists } from './filesystem'
import { resolveSkills } from './skill-resolver'
import { diagnostics } from '../diagnostics'

/**
 * Normalize a release's `skills/` directory into a flat `<name>/` layout,
 * collapsing catalog layouts (`<category>/<name>/SKILL.md`) so the copied-in
 * `.ai/skills/` is a clean, browsable list of Skills.
 *
 * The flattened Skills are staged into a sibling directory and swapped in
 * atomically, rather than copied in place. In-place copying merges a leaf Skill
 * into a same-named category directory (`coding/coding` → `coding`), leaving the
 * category's other children nested underneath — which is exactly what buries a
 * Skill too deep for a coding agent to discover. A leaf-name collision raises
 * `AIRIG_R0022` before anything is swapped.
 */
async function flattenSkills(skillsDir: string): Promise<void> {
  const skills = await resolveSkills(skillsDir)
  if (skills.every(skill => skill.sourceRelPath === skill.name)) return

  const stagingDir = `${skillsDir}.airig-flat`
  await rm(stagingDir, { recursive: true, force: true })
  await mkdir(stagingDir, { recursive: true })

  for (const skill of skills) {
    await cp(
      path.join(skillsDir, skill.sourceRelPath),
      path.join(stagingDir, skill.name),
      { recursive: true, verbatimSymlinks: true },
    )
  }

  await rm(skillsDir, { recursive: true, force: true })
  await rename(stagingDir, skillsDir)
}

export async function withExtractedReleaseAi<T>(
  assetBuffer: Buffer,
  tmpPrefix: string,
  fn: (extractedAiDir: string) => Promise<T>,
): Promise<T> {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), tmpPrefix))
  try {
    const zipPath = path.join(tmpDir, 'ai.zip')
    await writeFile(zipPath, assetBuffer)

    const extractDir = path.join(tmpDir, 'extracted')
    await mkdir(extractDir)
    await extractZip(zipPath, { dir: extractDir })

    const extractedAiDir = path.join(extractDir, '.ai')
    if (!existsSync(extractedAiDir)) {
      throw diagnostics.AIRIG_R0020()
    }

    const skillsSrc = path.join(extractedAiDir, 'skills')
    if (existsSync(skillsSrc)) {
      await flattenSkills(skillsSrc)
    }

    return await fn(extractedAiDir)
  } finally {
    await rm(tmpDir, { recursive: true, force: true })
  }
}

export async function copyReleaseAiToLocal(extractedAiDir: string): Promise<void> {
  await mkdir('.ai', { recursive: true })
  const entries = await readdir(extractedAiDir, { withFileTypes: true })
  for (const entry of entries) {
    await cp(
      path.join(extractedAiDir, entry.name),
      path.join('.ai', entry.name),
      { recursive: true, force: true, verbatimSymlinks: true },
    )
  }
}

export async function copyReleaseArtifactsToLocal(
  extractedAiDir: string,
  artifacts: string[],
  targetRoot = '.ai',
): Promise<void> {
  await mkdir(targetRoot, { recursive: true })
  const artifactsToCopy = await expandReleaseArtifactsWithSymlinkDependencies(extractedAiDir, artifacts)

  for (const artifact of artifactsToCopy) {
    const sourcePath = path.join(extractedAiDir, artifact)
    const targetPath = path.join(targetRoot, artifact)
    await mkdir(path.dirname(targetPath), { recursive: true })
    await rm(targetPath, { recursive: true, force: true })
    await cp(sourcePath, targetPath, { recursive: true, force: true, verbatimSymlinks: true })
  }
}

export async function expandReleaseArtifactsWithSymlinkDependencies(
  extractedAiDir: string,
  artifacts: string[],
): Promise<string[]> {
  const expanded = new Set<string>()

  async function visit(artifact: string): Promise<void> {
    if (expanded.has(artifact)) return
    expanded.add(artifact)

    const sourcePath = path.join(extractedAiDir, artifact)
    const stat = await lstatIfExists(sourcePath)
    if (!stat?.isSymbolicLink()) return

    const linkTarget = await readlink(sourcePath)
    if (path.isAbsolute(linkTarget)) return

    const dependency = path.relative(extractedAiDir, path.resolve(path.dirname(sourcePath), linkTarget))
    if (dependency.startsWith('..') || dependency === '') return
    if (existsSync(path.join(extractedAiDir, dependency))) await visit(dependency)
  }

  for (const artifact of artifacts) {
    await visit(artifact)
  }

  return [...expanded]
}

export async function replaceReleaseArtifact(extractedAiDir: string, artifact: string): Promise<void> {
  const sourcePath = path.join(extractedAiDir, artifact)
  const targetPath = path.join('.ai', artifact)
  await mkdir(path.dirname(targetPath), { recursive: true })
  await rm(targetPath, { recursive: true, force: true })
  await cp(sourcePath, targetPath, { recursive: true, force: true, verbatimSymlinks: true })
}
