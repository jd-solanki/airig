import { readdir, symlink, mkdir, lstat, readlink, unlink } from 'node:fs/promises'
import path from 'node:path'
import { rulesFor, listArtifacts } from './provider-registry.js'
import type { AiJson } from './ai-json.js'

export type SkipReason = 'already-linked' | 'conflict-real-file' | 'conflict-wrong-symlink' | 'excluded'

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

function isExcluded(aiRelativePath: string, excludeList: string[]): boolean {
  for (const exc of excludeList) {
    if (exc === aiRelativePath) return true
    const dir = exc.endsWith('/') ? exc : exc + '/'
    if (aiRelativePath.startsWith(dir)) return true
  }
  return false
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

export async function scanLinkable(providers: string[], exclude: string[]): Promise<LinkableEntry[]> {
  const artifacts = await listArtifacts('.ai', providers)
  return artifacts
    .filter(a => !isExcluded(a, exclude))
    .map(a => ({ sourcePath: `.ai/${a}`, label: a }))
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
  ownershipValue: string,
  aiJson: AiJson,
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
  aiJson.ownership[targetPath] = ownershipValue
  result.linked.push(targetPath)
}

export async function linkPackageArtifacts(
  aiJson: AiJson,
  providers: string[],
  ownershipValue: string,
): Promise<LinkResult> {
  const result: LinkResult = { linked: [], skipped: [] }
  await iterateRuleEntries(providers, (sourcePath, targetPath) =>
    createSymlink(sourcePath, targetPath, ownershipValue, aiJson, result),
  )
  return result
}

export async function linkLocalFiles(
  aiJson: AiJson,
  providers: string[],
  allowedSources?: Set<string>,
): Promise<LinkResult> {
  const exclude = aiJson.packages['.']?.exclude ?? []
  const result: LinkResult = { linked: [], skipped: [] }
  await iterateRuleEntries(providers, async (sourcePath, targetPath) => {
    const aiRelativePath = sourcePath.startsWith('.ai/')
      ? sourcePath.slice('.ai/'.length)
      : sourcePath

    if (isExcluded(aiRelativePath, exclude)) {
      result.skipped.push({ path: targetPath, reason: 'excluded' })
      return
    }

    if (allowedSources && !allowedSources.has(sourcePath)) return

    await createSymlink(sourcePath, targetPath, sourcePath, aiJson, result)
  })
  return result
}
