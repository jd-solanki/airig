import { Command } from 'commander'
import { rm } from 'node:fs/promises'
import { Octokit } from '@octokit/rest'
import { readAiJson, writeAiJson } from '../lib/ai-json.js'
import { fetchReleaseInfo, downloadAsset } from '../lib/github.js'
import { parseExactPackageRef } from '../lib/package-ref.js'
import { listArtifacts, PROVIDER_REGISTRY, targetPathsForArtifact } from '../lib/provider-registry.js'
import { replaceReleaseArtifact, withExtractedReleaseAi } from '../lib/setup-release.js'
import { reconcilePackageLinks, unlinkFiles } from '../lib/linker.js'

export async function runUpdate(pkg: string): Promise<void> {
  const { owner, repo, tag } = parseExactPackageRef(pkg)
  const packageKey = `${owner}/${repo}`
  const providers = Object.keys(PROVIDER_REGISTRY)
  const aiJson = await readAiJson()
  const entry = aiJson.packages[packageKey]

  if (!entry) {
    throw new Error(
      `Package "${packageKey}" is not installed.\n` +
      '  Install it first with: ohmyai add <owner/repo>[@version]',
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

  await withExtractedReleaseAi(assetBuffer, 'ohmyai-update-', async extractedAiDir => {
    const newArtifacts = await listArtifacts(extractedAiDir, providers)
    const newArtifactSet = new Set(newArtifacts)
    const previousVersion = entry.version
    const previousLinked = [...entry.linked]
    const prunedLinked = previousLinked.filter(artifact => newArtifactSet.has(artifact))
    const deletedLinked = previousLinked.filter(artifact => !newArtifactSet.has(artifact))

    for (const artifact of newArtifacts) {
      await replaceReleaseArtifact(extractedAiDir, artifact)
    }

    const targetsToUnlink = new Set<string>()
    for (const artifact of deletedLinked) {
      await rm(`.ai/${artifact}`, { recursive: true, force: true })
      for (const targetPath of targetPathsForArtifact(artifact, providers)) {
        targetsToUnlink.add(targetPath)
      }
    }
    await unlinkFiles([...targetsToUnlink])

    entry.version = resolvedTag
    entry.linked = prunedLinked

    await reconcilePackageLinks(aiJson, packageKey, providers, prunedLinked, prunedLinked)
    await writeAiJson(aiJson)

    console.log(
      `\nUpdated ${owner}/${repo} from ${previousVersion} to ${resolvedTag} ` +
      `(${newArtifacts.length} downloaded, ${deletedLinked.length} pruned).`,
    )
  })
}

export const updateCommand = new Command('update')
  .description('Update an installed immutable release at an exact version')
  .argument('<package>', 'Package to update, e.g. owner/repo@1.2.0')
  .action(async (pkg: string) => {
    try {
      await runUpdate(pkg)
    } catch (err) {
      console.error(`✖ ${(err as Error).message}`)
      process.exit(1)
    }
  })
