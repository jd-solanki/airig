import { Command } from 'commander'
import { lstat, readlink, rm } from 'node:fs/promises'
import path from 'node:path'
import { Octokit } from '@octokit/rest'
import { readAiJson, writeAiJson } from '../lib/ai-json.js'
import { fetchReleaseInfo, downloadAsset } from '../lib/github.js'
import { parseExactPackageRef } from '../lib/package-ref.js'
import { listArtifacts, PROVIDER_REGISTRY, targetPathsForArtifact } from '../lib/provider-registry.js'
import { copyReleaseArtifactsToLocal, withExtractedReleaseAi } from '../lib/setup-release.js'
import { reconcilePackageLinks, unlinkFiles } from '../lib/linker.js'

export async function runUpdate(pkg: string): Promise<void> {
  const { owner, repo, tag } = parseExactPackageRef(pkg)
  const packageKey = `${owner}/${repo}`
  const allProviders = Object.keys(PROVIDER_REGISTRY)
  const aiJson = await readAiJson()
  const entry = aiJson.packages[packageKey]

  if (!entry) {
    throw new Error(
      `Package "${packageKey}" is not installed.\n` +
      '  Install it first with: airig add <owner/repo>[@version]',
    )
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
    const activeProviders = await activeProvidersForLinkedArtifacts(previousLinked)
    const prunedLinked = previousLinked.filter(artifact => newArtifactSet.has(artifact))
    const deletedLinked = previousLinked.filter(artifact => !newArtifactSet.has(artifact))

    await copyReleaseArtifactsToLocal(extractedAiDir, prunedLinked)

    const targetsToUnlink = new Set<string>()
    for (const artifact of deletedLinked) {
      await rm(`.ai/${artifact}`, { recursive: true, force: true })
      for (const targetPath of targetPathsForArtifact(artifact, activeProviders)) {
        targetsToUnlink.add(targetPath)
      }
    }
    await unlinkFiles([...targetsToUnlink])

    entry.version = resolvedTag
    entry.linked = prunedLinked

    await reconcilePackageLinks(aiJson, packageKey, activeProviders, prunedLinked, prunedLinked)
    await writeAiJson(aiJson)

    console.log(
      `\nUpdated ${owner}/${repo} from ${previousVersion} to ${resolvedTag} ` +
      `(${prunedLinked.length} active file(s) refreshed, ${deletedLinked.length} pruned).`,
    )
  })
}

async function activeProvidersForLinkedArtifacts(linkedArtifacts: string[]): Promise<string[]> {
  const activeProviders: string[] = []

  for (const provider of Object.keys(PROVIDER_REGISTRY)) {
    if (await hasActiveProviderTarget(provider, linkedArtifacts)) {
      activeProviders.push(provider)
    }
  }

  return activeProviders
}

async function hasActiveProviderTarget(provider: string, linkedArtifacts: string[]): Promise<boolean> {
  for (const artifact of linkedArtifacts) {
    for (const targetPath of targetPathsForArtifact(artifact, [provider])) {
      if (await targetPointsToArtifact(targetPath, artifact)) return true
    }
  }

  return false
}

async function targetPointsToArtifact(targetPath: string, artifact: string): Promise<boolean> {
  let targetStat: Awaited<ReturnType<typeof lstat>>
  try {
    targetStat = await lstat(targetPath)
  } catch {
    return false
  }

  if (!targetStat.isSymbolicLink()) return false

  const existing = await readlink(targetPath)
  const resolvedExisting = path.resolve(path.dirname(targetPath), existing)
  const resolvedSource = path.resolve(`.ai/${artifact}`)
  return resolvedExisting === resolvedSource
}

export const updateCommand = new Command('update')
  .description('Refresh an installed Setup Release at an exact immutable version')
  .argument('<package>', 'Package to update, e.g. owner/repo@1.2.0')
  .action(async (pkg: string) => {
    try {
      await runUpdate(pkg)
    } catch (err) {
      console.error(`✖ ${(err as Error).message}`)
      process.exit(1)
    }
  })
