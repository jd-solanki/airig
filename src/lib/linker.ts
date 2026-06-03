import { readdir, symlink, mkdir, lstat, readlink, unlink } from 'node:fs/promises'
import path from 'node:path'
import { rulesFor, listArtifacts } from './provider-registry.js'
import { readAiJson, writeAiJson } from './ai-json.js'

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

export async function linkProviders(
  providers: string[],
  ownershipValue?: string,
  allowedSources?: Set<string>,
): Promise<LinkResult> {
  const aiJson = await readAiJson()

  if (!ownershipValue) {
    aiJson.packages['.'] ??= { version: '*' }
  }

  const exclude = (!ownershipValue && aiJson.packages['.']?.exclude) ? aiJson.packages['.'].exclude : []

  const rules = rulesFor(providers)

  const linked: string[] = []
  const skipped: SkippedEntry[] = []

  for (const rule of rules) {
    let entries: string[]
    try {
      entries = await readdir(rule.source)
    } catch {
      continue
    }

    await mkdir(rule.target, { recursive: true })

    for (const entry of entries) {
      const sourcePath = path.join(rule.source, entry)
      const targetPath = path.join(rule.target, entry)

      const aiRelativePath = sourcePath.startsWith('.ai/')
        ? sourcePath.slice('.ai/'.length)
        : sourcePath

      if (!ownershipValue && isExcluded(aiRelativePath, exclude!)) {
        skipped.push({ path: targetPath, reason: 'excluded' })
        continue
      }

      if (allowedSources && !allowedSources.has(sourcePath)) {
        continue
      }

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
            skipped.push({ path: targetPath, reason: 'already-linked' })
            continue
          }
          skipped.push({ path: targetPath, reason: 'conflict-wrong-symlink' })
        } else {
          skipped.push({ path: targetPath, reason: 'conflict-real-file' })
        }
        continue
      }

      const relSource = path.relative(path.dirname(targetPath), sourcePath)
      await symlink(relSource, targetPath)

      aiJson.ownership[targetPath] = ownershipValue ?? sourcePath
      linked.push(targetPath)
    }
  }

  await writeAiJson(aiJson)
  return { linked, skipped }
}
