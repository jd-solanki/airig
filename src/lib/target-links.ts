import { existsSync } from 'node:fs'
import { mkdir, readlink, symlink } from 'node:fs/promises'
import path from 'node:path'
import { lstatIfExists } from './filesystem'
import { targetPathsForArtifact } from './provider-registry'

export interface TargetConflict {
  targetPath: string
  reason: 'real-file' | 'wrong-symlink'
}

export function targetSourcePairs(
  sourceRoot: string,
  targetRoot: string,
  providers: string[],
  artifacts: string[],
): Map<string, string> {
  const pairs = new Map<string, string>()

  for (const artifact of artifacts) {
    for (const targetPath of targetPathsForArtifact(artifact, providers)) {
      pairs.set(
        path.join(targetRoot, targetPath),
        path.join(sourceRoot, artifact),
      )
    }
  }

  return pairs
}

export async function assertNoTargetConflicts(
  targetSources: Map<string, string>,
  retryCommand: string,
  allowedWrongSymlinkTargets = new Set<string>(),
): Promise<void> {
  const conflicts: TargetConflict[] = []

  for (const [targetPath, sourcePath] of targetSources) {
    const conflict = await targetConflictFor(sourcePath, targetPath)
    if (isAllowedWrongSymlink(conflict, allowedWrongSymlinkTargets)) continue
    if (conflict) conflicts.push(conflict)
  }

  if (conflicts.length === 0) return

  throw new Error(
    `Conflicts detected — the following target paths are already occupied:\n` +
    conflicts
      .map(conflict => `  ${conflict.targetPath}  (${conflict.reason})`)
      .join('\n') + '\n' +
    `  Remove or move the conflicting files, then run ${retryCommand} again.`,
  )
}

export async function targetConflictFor(
  sourcePath: string,
  targetPath: string,
): Promise<TargetConflict | undefined> {
  if (path.resolve(sourcePath) === path.resolve(targetPath)) return undefined

  const targetStat = await lstatIfExists(targetPath)
  if (!targetStat) return undefined

  if (!targetStat.isSymbolicLink()) return { targetPath, reason: 'real-file' }

  if (await targetPointsToSource(targetPath, sourcePath)) return undefined
  return { targetPath, reason: 'wrong-symlink' }
}

export async function targetPointsToSource(targetPath: string, sourcePath: string): Promise<boolean> {
  const targetStat = await lstatIfExists(targetPath)
  if (!targetStat?.isSymbolicLink()) return false

  const existing = await readlink(targetPath)
  const resolvedExisting = path.resolve(path.dirname(targetPath), existing)
  const resolvedSource = path.resolve(sourcePath)
  return resolvedExisting === resolvedSource
}

export async function createRelativeSymlink(sourcePath: string, targetPath: string): Promise<void> {
  if (path.resolve(sourcePath) === path.resolve(targetPath)) return

  await mkdir(path.dirname(targetPath), { recursive: true })
  await symlink(path.relative(path.dirname(targetPath), sourcePath), targetPath)
}

export async function createRelativeSymlinkIfMissing(sourcePath: string, targetPath: string): Promise<void> {
  if (existsSync(targetPath)) return
  await createRelativeSymlink(sourcePath, targetPath)
}

function isAllowedWrongSymlink(
  conflict: TargetConflict | undefined,
  allowedWrongSymlinkTargets: Set<string>,
): boolean {
  return conflict?.reason === 'wrong-symlink' &&
    allowedWrongSymlinkTargets.has(path.resolve(conflict.targetPath))
}
