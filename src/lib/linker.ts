import { symlink, mkdir, lstat, readlink, unlink } from 'node:fs/promises'
import path from 'node:path'
import { listArtifacts, targetPathsForArtifact } from './provider-registry.js'
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

export interface ReconcileLinkResult extends LinkResult {
  unlinked: string[]
  localOverrides: string[]
}

export interface LinkableEntry {
  label: string
}

export interface OwnedTarget {
  packageKey: string
  version: string
  artifact: string
  targetPath: string
}

export interface PackageConflict {
  targetPath: string
  owner: OwnedTarget
}

interface TargetConflict {
  targetPath: string
  reason: 'real-file' | 'wrong-symlink'
}

function isLocalPackage(version: string | undefined): boolean {
  return version === '*'
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
  return artifacts.map(label => ({ label }))
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

async function targetConflictFor(
  sourcePath: string,
  targetPath: string,
): Promise<TargetConflict | undefined> {
  let targetStat: Awaited<ReturnType<typeof lstat>>
  try {
    targetStat = await lstat(targetPath)
  } catch {
    return undefined
  }

  if (!targetStat.isSymbolicLink()) return { targetPath, reason: 'real-file' }

  const existing = await readlink(targetPath)
  const resolvedExisting = path.resolve(path.dirname(targetPath), existing)
  const resolvedSource = path.resolve(sourcePath)
  if (resolvedExisting === resolvedSource) return undefined
  return { targetPath, reason: 'wrong-symlink' }
}

async function assertNoTargetConflicts(
  providers: string[],
  artifactLabels: string[],
): Promise<void> {
  const conflicts: TargetConflict[] = []
  const allowedTargets = new Map<string, string>()

  for (const artifact of artifactLabels) {
    for (const targetPath of targetPathsForArtifact(artifact, providers)) {
      allowedTargets.set(targetPath, `.ai/${artifact}`)
    }
  }

  for (const [targetPath, sourcePath] of allowedTargets) {
    const conflict = await targetConflictFor(sourcePath, targetPath)
    if (conflict) conflicts.push(conflict)
  }

  if (conflicts.length === 0) return

  throw new Error(
    `Conflicts detected — the following target paths are already occupied:\n` +
    conflicts
      .map(conflict => `  ${conflict.targetPath}  (${conflict.reason})`)
      .join('\n') + '\n' +
    '  Remove or move the conflicting files, then run the command again.',
  )
}

function assertNoBlockingSkips(skipped: SkippedEntry[]): void {
  const conflicts = skipped.filter(entry => entry.reason !== 'already-linked')
  if (conflicts.length === 0) return

  throw new Error(
    `Conflicts detected — the following target paths could not be linked:\n` +
    conflicts
      .map(conflict => `  ${conflict.path}  (${conflict.reason})`)
      .join('\n') + '\n' +
    '  Remove or move the conflicting files, then run the command again.',
  )
}

export function findRemotePackageConflicts(
  aiJson: AiJson,
  packageKey: string,
  providers: string[],
  artifactLabels: string[],
): PackageConflict[] {
  const ownership = deriveTargetOwnership(aiJson)
  const conflicts: PackageConflict[] = []

  for (const artifact of artifactLabels) {
    for (const targetPath of targetPathsForArtifact(artifact, providers)) {
      for (const owner of ownership.get(targetPath) ?? []) {
        if (owner.packageKey === packageKey) continue
        if (isLocalPackage(aiJson.packages[packageKey]?.version)) continue
        if (isLocalPackage(owner.version)) continue
        conflicts.push({ targetPath, owner })
      }
    }
  }

  return conflicts
}

export function findLocalPackageOverrides(
  aiJson: AiJson,
  packageKey: string,
  providers: string[],
  artifactLabels: string[],
): PackageConflict[] {
  const ownership = deriveTargetOwnership(aiJson)
  const overrides: PackageConflict[] = []

  if (isLocalPackage(aiJson.packages[packageKey]?.version)) return overrides

  for (const artifact of artifactLabels) {
    for (const targetPath of targetPathsForArtifact(artifact, providers)) {
      for (const owner of ownership.get(targetPath) ?? []) {
        if (owner.packageKey === packageKey) continue
        if (isLocalPackage(owner.version)) overrides.push({ targetPath, owner })
      }
    }
  }

  return overrides
}

export function pruneLocalPackageOverrides(aiJson: AiJson, overrides: PackageConflict[]): void {
  const artifactsByPackage = new Map<string, Set<string>>()

  for (const { owner } of overrides) {
    const artifacts = artifactsByPackage.get(owner.packageKey) ?? new Set<string>()
    artifacts.add(owner.artifact)
    artifactsByPackage.set(owner.packageKey, artifacts)
  }

  for (const [packageKey, artifacts] of artifactsByPackage) {
    const entry = aiJson.packages[packageKey]
    if (!entry || !isLocalPackage(entry.version)) continue
    entry.linked = entry.linked.filter(artifact => !artifacts.has(artifact))
  }
}

export async function reconcilePackageLinks(
  aiJson: AiJson,
  packageKey: string,
  providers: string[],
  selectedLabels: string[],
  scopedLabels = selectedLabels,
): Promise<ReconcileLinkResult> {
  if (!aiJson.packages[packageKey]) {
    throw new Error(`Package "${packageKey}" is not installed.`)
  }

  const selected = [...new Set(selectedLabels)]
  const selectedSet = new Set(selected)
  const scopedSet = new Set(scopedLabels)
  const currentLinked = aiJson.packages[packageKey].linked
  const preserved = currentLinked.filter(label => !scopedSet.has(label))
  const removed = currentLinked.filter(label => scopedSet.has(label) && !selectedSet.has(label))
  const conflicts = findRemotePackageConflicts(aiJson, packageKey, providers, selected)

  if (conflicts.length > 0) {
    throw new Error(
      `Conflicts detected — the following symlinks are already owned by another package:\n` +
      conflicts
        .map(({ targetPath, owner }) => `  ${targetPath}  (owned by ${owner.packageKey}@${owner.version})`)
        .join('\n') + '\n' +
      '  Remove the conflicting package first with: airig remove <owner/repo>',
    )
  }

  await assertNoTargetConflicts(providers, selected)

  const ownership = deriveTargetOwnership(aiJson)
  const targetPathsToUnlink = new Set<string>()
  for (const artifact of removed) {
    for (const targetPath of targetPathsForArtifact(artifact, providers)) {
      const otherOwners = (ownership.get(targetPath) ?? [])
        .filter(owner => owner.packageKey !== packageKey)
      if (otherOwners.length === 0) targetPathsToUnlink.add(targetPath)
    }
  }

  await unlinkFiles([...targetPathsToUnlink])

  const localOverrides = findLocalPackageOverrides(aiJson, packageKey, providers, selected)
  pruneLocalPackageOverrides(aiJson, localOverrides)

  const { linked, skipped } = await linkPackageArtifacts(providers, selected)
  assertNoBlockingSkips(skipped)
  aiJson.packages[packageKey].linked = [...new Set([...preserved, ...selected])]

  return {
    linked,
    skipped,
    unlinked: [...targetPathsToUnlink],
    localOverrides: localOverrides.map(({ targetPath }) => targetPath),
  }
}

export async function linkLocalFiles(
  aiJson: AiJson,
  providers: string[],
  selectedLabels?: Set<string>,
): Promise<LinkResult> {
  aiJson.packages['.'] ??= { version: '*', linked: [] }
  const scopedLabels = await listArtifacts('.ai', providers)
  const labels = selectedLabels
    ? [...selectedLabels]
    : scopedLabels
  return reconcilePackageLinks(aiJson, '.', providers, labels, scopedLabels)
}

export async function linkProviders(
  providers: string[],
  artifactLabels?: string[],
  packageKey = '.',
): Promise<LinkResult> {
  const aiJson = await readAiJson()
  const scopedLabels = await listArtifacts('.ai', providers)
  const labels = artifactLabels ?? scopedLabels

  if (packageKey === '.') {
    aiJson.packages['.'] ??= { version: '*', linked: [] }
  }

  const result = await reconcilePackageLinks(aiJson, packageKey, providers, labels, scopedLabels)
  await writeAiJson(aiJson)
  return result
}
