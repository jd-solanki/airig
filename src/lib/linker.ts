import { readdir, symlink, mkdir, lstat, readlink, unlink } from 'node:fs/promises'
import path from 'node:path'
import { rulesFor, listArtifacts, targetPathsForArtifact } from './provider-registry.js'
import type { AiJson } from './ai-json.js'
import { readAiJson, writeAiJson } from './ai-json.js'

export type SkipReason = 'already-linked' | 'conflict-real-file' | 'conflict-wrong-symlink'

export interface SkippedEntry {
  path: string
  reason: SkipReason
}

export interface LinkResult {
  linked: string[]
  skipped: SkippedEntry[]
}

export interface LinkableEntry {
  sourcePath: string
  label: string
}

export interface OwnedTarget {
  packageKey: string
  version: string
  artifact: string
  targetPath: string
}

export function deriveTargetOwnership(aiJson: AiJson): Map<string, OwnedTarget[]> {
  const ownership = new Map<string, OwnedTarget[]>()

  for (const [packageKey, entry] of Object.entries(aiJson.packages)) {
    for (const artifact of entry.linked) {
      for (const targetPath of targetPathsForArtifact(artifact)) {
        const owners = ownership.get(targetPath) ?? []
        owners.push({ packageKey, version: entry.version, artifact, targetPath })
        ownership.set(targetPath, owners)
      }
    }
  }

  return ownership
}

export async function unlinkFiles(targetPaths: string[]): Promise<void> {
  for (const targetPath of targetPaths) {
    try {
      const stat = await lstat(targetPath)
      if (stat.isSymbolicLink()) await unlink(targetPath)
    } catch {
      // already gone — idempotent
    }
  }
}

export async function scanLinkable(providers: string[]): Promise<LinkableEntry[]> {
  const artifacts = await listArtifacts('.ai', providers)
  return artifacts.map(a => ({ sourcePath: `.ai/${a}`, label: a }))
}

async function iterateRuleEntries(
  providers: string[],
  callback: (sourcePath: string, targetPath: string) => Promise<void>,
): Promise<void> {
  for (const rule of rulesFor(providers)) {
    let entries: string[]
    try {
      entries = await readdir(rule.source)
    } catch {
      continue
    }
    await mkdir(rule.target, { recursive: true })
    for (const entry of entries) {
      await callback(path.join(rule.source, entry), path.join(rule.target, entry))
    }
  }
}

async function createSymlink(
  sourcePath: string,
  targetPath: string,
  result: LinkResult,
): Promise<void> {
  let targetStat: Awaited<ReturnType<typeof lstat>> | undefined
  try {
    targetStat = await lstat(targetPath)
  } catch {
    // target doesn't exist — proceed to create
  }

  if (targetStat) {
    if (targetStat.isSymbolicLink()) {
      const existing = await readlink(targetPath)
      const resolvedExisting = path.resolve(path.dirname(targetPath), existing)
      const resolvedSource = path.resolve(sourcePath)
      if (resolvedExisting === resolvedSource) {
        result.skipped.push({ path: targetPath, reason: 'already-linked' })
        return
      }
      result.skipped.push({ path: targetPath, reason: 'conflict-wrong-symlink' })
    } else {
      result.skipped.push({ path: targetPath, reason: 'conflict-real-file' })
    }
    return
  }

  const relSource = path.relative(path.dirname(targetPath), sourcePath)
  await symlink(relSource, targetPath)
  result.linked.push(targetPath)
}

export async function linkPackageArtifacts(
  providers: string[],
  artifactLabels: string[],
): Promise<LinkResult> {
  const result: LinkResult = { linked: [], skipped: [] }
  const allowedTargets = new Map<string, string>()

  for (const artifact of artifactLabels) {
    for (const targetPath of targetPathsForArtifact(artifact, providers)) {
      allowedTargets.set(targetPath, `.ai/${artifact}`)
    }
  }

  for (const [targetPath, sourcePath] of allowedTargets) {
    await mkdir(path.dirname(targetPath), { recursive: true })
    await createSymlink(sourcePath, targetPath, result)
  }

  return result
}

export async function linkLocalFiles(
  aiJson: AiJson,
  providers: string[],
  allowedSources?: Set<string>,
): Promise<LinkResult> {
  const result: LinkResult = { linked: [], skipped: [] }
  const selectedLabels: string[] = []

  await iterateRuleEntries(providers, async (sourcePath, targetPath) => {
    const aiRelativePath = sourcePath.startsWith('.ai/')
      ? sourcePath.slice('.ai/'.length)
      : sourcePath

    if (allowedSources && !allowedSources.has(sourcePath)) return

    selectedLabels.push(aiRelativePath)
    await createSymlink(sourcePath, targetPath, result)
  })

  aiJson.packages['.'] ??= { version: '*', linked: [] }
  aiJson.packages['.'].linked = [...new Set(selectedLabels)]

  return result
}

export async function linkProviders(
  providers: string[],
  artifactLabels?: string[],
  packageKey = '.',
): Promise<LinkResult> {
  const aiJson = await readAiJson()
  const labels = artifactLabels ?? await listArtifacts('.ai', providers)

  if (packageKey === '.') {
    aiJson.packages['.'] ??= { version: '*', linked: [] }
  }
  if (aiJson.packages[packageKey]) {
    aiJson.packages[packageKey].linked = [...new Set(labels)]
  }

  const result = await linkPackageArtifacts(providers, labels)
  await writeAiJson(aiJson)
  return result
}
