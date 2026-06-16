import { cp, mkdir, mkdtemp, readdir, readlink, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import extractZip from 'extract-zip'
import { lstatIfExists } from './filesystem.js'

async function findSkillDirs(dir: string): Promise<string[]> {
  let entries: { name: string; isFile(): boolean; isDirectory(): boolean }[]
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return []
  }

  if (entries.some(e => e.isFile() && e.name === 'SKILL.md')) {
    return [dir]
  }

  const results: string[] = []
  for (const entry of entries) {
    if (entry.isDirectory()) {
      results.push(...await findSkillDirs(path.join(dir, entry.name)))
    }
  }
  return results
}

async function flattenSkills(skillsDir: string): Promise<void> {
  const skillDirs = await findSkillDirs(skillsDir)

  const names = new Map<string, string>()
  for (const dir of skillDirs) {
    const name = path.basename(dir)
    if (names.has(name)) {
      throw new Error(
        `Skill name collision: "${name}" appears at "${names.get(name)}" and "${dir}" in the package`,
      )
    }
    names.set(name, dir)
  }

  for (const dir of skillDirs) {
    const dest = path.join(skillsDir, path.basename(dir))
    if (dir !== dest) {
      await cp(dir, dest, { recursive: true })
    }
  }

  const topEntries = await readdir(skillsDir, { withFileTypes: true })
  for (const entry of topEntries) {
    if (entry.isDirectory() && !names.has(entry.name)) {
      await rm(path.join(skillsDir, entry.name), { recursive: true, force: true })
    }
  }
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
      throw new Error('The release zip does not contain an .ai/ directory')
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
