import { Command } from 'commander'
import { rm } from 'node:fs/promises'
import path from 'node:path'
import { Octokit } from '@octokit/rest'
import { readAiJson, writeAiJson } from '../lib/ai-json'
import { fetchReleaseInfo, downloadAsset } from '../lib/github'
import { parseExactPackageRef } from '../lib/package-ref'
import { listArtifacts, PROVIDER_REGISTRY, targetPathsForArtifact } from '../lib/provider-registry'
import { copyReleaseArtifactsToLocal, withExtractedReleaseAi } from '../lib/setup-release'
import { unlinkFiles } from '../lib/linker'
import { resolveSetupScope, type SetupScope } from '../lib/setup-scope'
import {
  assertNoTargetConflicts,
  createRelativeSymlinkIfMissing,
  targetPointsToSource,
  targetSourcePairs,
} from '../lib/target-links'
import { diagnostics } from '../diagnostics'

interface UpdateOptions {
  global?: boolean
}

export async function runUpdate(pkg: string, options: UpdateOptions = {}): Promise<void> {
  const { owner, repo, tag } = parseExactPackageRef(pkg)
  const packageKey = `${owner}/${repo}`
  const scope = resolveSetupScope(options)
  const allProviders = Object.keys(PROVIDER_REGISTRY)
  const aiJson = await readAiJson(scope.aiJsonPath)
  const entry = aiJson.packages[packageKey]

  if (!entry) {
    throw diagnostics.AIRIG_R0001({
      packageKey,
      hint: 'Install it first with: airig add <owner/repo>[@version]',
    })
  }
  if (entry.version === '*') {
    throw diagnostics.AIRIG_R0007({ packageKey })
  }

  const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN })
  const { tag: resolvedTag, assetDownloadUrl, immutable } = await fetchReleaseInfo(owner, repo, tag, octokit)

  if (!immutable) {
    throw diagnostics.AIRIG_R0003({ owner, repo, tag: resolvedTag, action: 'Updating from' })
  }

  console.log(`  Downloading ${owner}/${repo}@${resolvedTag}...`)
  const assetBuffer = await downloadAsset(assetDownloadUrl)

  await withExtractedReleaseAi(assetBuffer, 'airig-update-', async extractedAiDir => {
    const newArtifacts = await listArtifacts(extractedAiDir, allProviders)
    const newArtifactSet = new Set(newArtifacts)
    const previousVersion = entry.version
    const previousLinked = [...entry.linked]
    const activeTargetsByArtifact = await activeTargetsForLinkedArtifacts(previousLinked, scope)
    const activeProviders = await activeProvidersForLinkedArtifacts(previousLinked, scope)
    const prunedLinked = previousLinked.filter(artifact => newArtifactSet.has(artifact))
    const deletedLinked = previousLinked.filter(artifact => !newArtifactSet.has(artifact))

    await copyReleaseArtifactsToLocal(extractedAiDir, prunedLinked, scope.sourceRoot)

    const targetsToUnlink = new Set<string>()
    for (const artifact of deletedLinked) {
      await rm(path.join(scope.sourceRoot, artifact), { recursive: true, force: true })
      for (const targetPath of targetPathsForArtifact(artifact, activeProviders)) {
        targetsToUnlink.add(path.join(scope.targetRoot, targetPath))
      }
      for (const targetPath of activeTargetsByArtifact.get(artifact) ?? []) {
        targetsToUnlink.add(targetPath)
      }
    }
    await unlinkFiles([...targetsToUnlink])

    entry.version = resolvedTag
    entry.linked = prunedLinked

    await reconcileScopedPackageLinks(scope, activeProviders, activeTargetsByArtifact, prunedLinked)
    await writeAiJson(aiJson, scope.aiJsonPath)

    console.log(
      `\nUpdated ${owner}/${repo} from ${previousVersion} to ${resolvedTag} ` +
      `(${prunedLinked.length} active file(s) refreshed, ${deletedLinked.length} pruned).`,
    )
  })
}

async function activeTargetsForLinkedArtifacts(
  linkedArtifacts: string[],
  scope: SetupScope,
): Promise<Map<string, string[]>> {
  const activeTargetsByArtifact = new Map<string, string[]>()

  for (const artifact of linkedArtifacts) {
    const sourcePath = path.join(scope.sourceRoot, artifact)
    for (const targetPath of targetPathsForArtifact(artifact)) {
      const absoluteTargetPath = path.join(scope.targetRoot, targetPath)
      if (await targetPointsToSource(
        absoluteTargetPath,
        sourcePath,
      )) {
        const activeTargets = activeTargetsByArtifact.get(artifact) ?? []
        activeTargets.push(absoluteTargetPath)
        activeTargetsByArtifact.set(artifact, activeTargets)
      }
    }
  }

  return activeTargetsByArtifact
}

async function activeProvidersForLinkedArtifacts(
  linkedArtifacts: string[],
  scope: SetupScope,
): Promise<string[]> {
  const activeProviders: string[] = []

  for (const provider of Object.keys(PROVIDER_REGISTRY)) {
    if (await hasActiveProviderTarget(provider, linkedArtifacts, scope)) {
      activeProviders.push(provider)
    }
  }

  return activeProviders
}

async function hasActiveProviderTarget(
  provider: string,
  linkedArtifacts: string[],
  scope: SetupScope,
): Promise<boolean> {
  for (const artifact of linkedArtifacts) {
    if (!canInferProviderFromArtifact(artifact)) continue

    for (const targetPath of targetPathsForArtifact(artifact, [provider])) {
      if (await targetPointsToSource(
        path.join(scope.targetRoot, targetPath),
        path.join(scope.sourceRoot, artifact),
      )) return true
    }
  }

  return false
}

async function reconcileScopedPackageLinks(
  scope: SetupScope,
  activeProviders: string[],
  activeTargetsByArtifact: Map<string, string[]>,
  artifacts: string[],
): Promise<void> {
  const targets = targetSourcePairs(scope.sourceRoot, scope.targetRoot, activeProviders, artifacts)

  for (const artifact of artifacts) {
    for (const targetPath of activeTargetsByArtifact.get(artifact) ?? []) {
      targets.set(targetPath, path.join(scope.sourceRoot, artifact))
    }
  }

  await assertNoTargetConflicts(targets, 'update')

  for (const [targetPath, sourcePath] of targets) {
    await createRelativeSymlinkIfMissing(sourcePath, targetPath)
  }
}

function canInferProviderFromArtifact(artifact: string): boolean {
  // Root instruction files can be shared across providers, so they cannot prove selection.
  return artifact.includes('/')
}

export const updateCommand = new Command('update')
  .description('Refresh an installed Setup Release at an exact immutable version')
  .argument('<package>', 'Package to update, e.g. owner/repo@1.2.0')
  .option('--global', 'Update an installed release in the user Global AI Setup at ~/.ai')
  .action(runUpdate)
