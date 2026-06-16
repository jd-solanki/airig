import { Command } from 'commander'
import { rm } from 'node:fs/promises'
import path from 'node:path'
import { Octokit } from '@octokit/rest'
import { readAiJson, writeAiJson } from '../lib/ai-json.js'
import { fetchReleaseInfo, downloadAsset } from '../lib/github.js'
import { parseExactPackageRef } from '../lib/package-ref.js'
import { listArtifacts, PROVIDER_REGISTRY, targetPathsForArtifact } from '../lib/provider-registry.js'
import { copyReleaseArtifactsToLocal, withExtractedReleaseAi } from '../lib/setup-release.js'
import { unlinkFiles } from '../lib/linker.js'
import { resolveSetupScope, type SetupScope } from '../lib/setup-scope.js'
import {
  assertNoTargetConflicts,
  createRelativeSymlinkIfMissing,
  targetPointsToSource,
  targetSourcePairs,
} from '../lib/target-links.js'

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
    throw new Error(
      `Package "${packageKey}" is not installed.\n` +
      '  Install it first with: airig add <owner/repo>[@version]',
    )
  }
  if (entry.version === '*') {
    throw new Error(`Package "${packageKey}" is a local setup and cannot be updated as a remote Setup Release.`)
  }

  const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN })
  const { tag: resolvedTag, assetDownloadUrl, immutable } = await fetchReleaseInfo(owner, repo, tag, octokit)

  if (!immutable) {
    throw new Error(
      `Security restriction: release ${resolvedTag} of ${owner}/${repo} is not immutable.\n` +
      '  Updating from mutable releases is unsafe — assets can be swapped after you review them.\n' +
      '  Ask the package author to enable immutable releases in their repo settings.',
    )
  }

  console.log(`  Downloading ${owner}/${repo}@${resolvedTag}...`)
  const assetBuffer = await downloadAsset(assetDownloadUrl)

  await withExtractedReleaseAi(assetBuffer, 'airig-update-', async extractedAiDir => {
    const newArtifacts = await listArtifacts(extractedAiDir, allProviders)
    const newArtifactSet = new Set(newArtifacts)
    const previousVersion = entry.version
    const previousLinked = [...entry.linked]
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
    }
    await unlinkFiles([...targetsToUnlink])

    entry.version = resolvedTag
    entry.linked = prunedLinked

    await reconcileScopedPackageLinks(scope, activeProviders, prunedLinked)
    await writeAiJson(aiJson, scope.aiJsonPath)

    console.log(
      `\nUpdated ${owner}/${repo} from ${previousVersion} to ${resolvedTag} ` +
      `(${prunedLinked.length} active file(s) refreshed, ${deletedLinked.length} pruned).`,
    )
  })
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
  providers: string[],
  artifacts: string[],
): Promise<void> {
  const targets = targetSourcePairs(scope.sourceRoot, scope.targetRoot, providers, artifacts)
  await assertNoTargetConflicts(targets, 'update')

  for (const [targetPath, sourcePath] of targets) {
    await createRelativeSymlinkIfMissing(sourcePath, targetPath)
  }
}

export const updateCommand = new Command('update')
  .description('Refresh an installed Setup Release at an exact immutable version')
  .argument('<package>', 'Package to update, e.g. owner/repo@1.2.0')
  .option('--global', 'Update an installed release in the user Global AI Setup at ~/.ai')
  .action(async (pkg: string, options: UpdateOptions) => {
    try {
      await runUpdate(pkg, options)
    } catch (err) {
      console.error(`✖ ${(err as Error).message}`)
      process.exit(1)
    }
  })
