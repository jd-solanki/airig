import { Command } from 'commander'
import { Octokit } from '@octokit/rest'
import { readAiJson, writeAiJson, addPackage, type PackageEntry } from '../lib/ai-json.js'
import { fetchReleaseInfo, downloadAsset } from '../lib/github.js'
import { parsePackageRef } from '../lib/package-ref.js'
import { copyReleaseAiToLocal, withExtractedReleaseAi } from '../lib/setup-release.js'
import { runLink } from './link.js'

export async function runAdd(pkg: string): Promise<void> {
  const { owner, repo, tag: inputTag } = parsePackageRef(pkg)
  const packageKey = `${owner}/${repo}`
  const aiJson = await readAiJson()

  if (aiJson.packages[packageKey]) {
    throw new Error(
      `${packageKey} is already downloaded.\n` +
      '  Use ohmyai link to change active artifacts, ohmyai update to change versions, or ohmyai remove first.',
    )
  }

  const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN })

  const { tag: resolvedTag, assetDownloadUrl, immutable } = await fetchReleaseInfo(owner, repo, inputTag, octokit)

  if (!immutable) {
    throw new Error(
      `Security restriction: release ${resolvedTag} of ${owner}/${repo} is not immutable.\n` +
      '  Installing mutable releases is unsafe — assets can be swapped after you review them.\n' +
      '  Ask the package author to enable immutable releases in their repo settings.',
    )
  }

  console.log(`  Downloading ${owner}/${repo}@${resolvedTag}...`)
  const assetBuffer = await downloadAsset(assetDownloadUrl)
  await withExtractedReleaseAi(assetBuffer, 'ohmyai-add-', async extractedAiDir => {
    await copyReleaseAiToLocal(extractedAiDir)

    const entry: PackageEntry = { version: resolvedTag, linked: [] }
    addPackage(aiJson, packageKey, entry)
    await writeAiJson(aiJson)

    console.log(`\nDownloaded ${owner}/${repo}@${resolvedTag}`)
    await runLink(undefined, { packageKey })
  })
}

export const addCommand = new Command('add')
  .description('Install an immutable release into .ai/ with linked artifact tracking')
  .argument('<package>', 'Package to install, e.g. owner/repo or owner/repo@1.2.0')
  .action(async (pkg: string) => {
    try {
      await runAdd(pkg)
    } catch (err) {
      console.error(`✖ ${(err as Error).message}`)
      process.exit(1)
    }
  })
