import { lstat, unlink } from 'node:fs/promises'
import { listArtifacts, targetPathsForArtifact } from './provider-registry'
import type { AiJson } from './ai-json'
import { readAiJson, writeAiJson } from './ai-json'
import {
  assertNoTargetConflicts as assertNoTargetConflictsForPairs,
  createRelativeSymlink,
  targetConflictFor,
  targetPointsToSource,
  targetSourcePairs,
} from './target-links'
import { diagnostics } from '../diagnostics'

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
  if (await targetPointsToSource(targetPath, sourcePath)) {
    result.skipped.push({ path: targetPath, reason: 'already-linked' })
    return
  }

  const conflict = await targetConflictFor(sourcePath, targetPath)
  if (conflict) {
    result.skipped.push({
      path: targetPath,
      reason: conflict.reason === 'real-file' ? 'conflict-real-file' : 'conflict-wrong-symlink',
    })
    return
  }

  await createRelativeSymlink(sourcePath, targetPath)
  result.linked.push(targetPath)
}

export async function linkPackageArtifacts(
  providers: string[],
  artifactLabels: string[],
): Promise<LinkResult> {
  const result: LinkResult = { linked: [], skipped: [] }
  const targets = targetSourcePairs('.ai', '.', providers, artifactLabels)

  for (const [targetPath, sourcePath] of targets) {
    await createSymlink(sourcePath, targetPath, result)
  }

  return result
}

async function assertNoTargetConflicts(
  providers: string[],
  artifactLabels: string[],
): Promise<void> {
  await assertNoTargetConflictsForPairs(
    targetSourcePairs('.ai', '.', providers, artifactLabels),
    'the command',
  )
}

function assertNoBlockingSkips(skipped: SkippedEntry[]): void {
  const conflicts = skipped.filter(entry => entry.reason !== 'already-linked')
  if (conflicts.length === 0) return

  throw diagnostics.AIRIG_R0010({
    conflicts: conflicts
      .map(conflict => `  ${conflict.path}  (${conflict.reason})`)
      .join('\n'),
  })
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

/**
 * Throw `AIRIG_R0005` if any selected artifact's target is already owned by
 * another remote package. `retryCommand` is the command surfaced to the User for
 * clearing the conflict (e.g. `airig remove <owner/repo>`).
 */
export function assertNoRemotePackageConflicts(
  aiJson: AiJson,
  packageKey: string,
  providers: string[],
  artifactLabels: string[],
  retryCommand: string,
): void {
  const conflicts = findRemotePackageConflicts(aiJson, packageKey, providers, artifactLabels)
  if (conflicts.length === 0) return

  throw diagnostics.AIRIG_R0005({
    conflicts: conflicts
      .map(({ targetPath, owner }) => `  ${targetPath}  (owned by ${owner.packageKey}@${owner.version})`)
      .join('\n'),
    command: retryCommand,
  })
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
    throw diagnostics.AIRIG_R0001({ packageKey })
  }

  const selected = [...new Set(selectedLabels)]
  const selectedSet = new Set(selected)
  const scopedSet = new Set(scopedLabels)
  const currentLinked = aiJson.packages[packageKey].linked
  const preserved = currentLinked.filter(label => !scopedSet.has(label))
  const removed = currentLinked.filter(label => scopedSet.has(label) && !selectedSet.has(label))

  assertNoRemotePackageConflicts(aiJson, packageKey, providers, selected, 'airig remove <owner/repo>')
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
