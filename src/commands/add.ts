import { Command } from 'commander'
import { mkdtemp, rm, mkdir, writeFile, cp, readdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Octokit } from '@octokit/rest'
import extractZip from 'extract-zip'
import { readAiJson, writeAiJson, addPackage, type PackageEntry } from '../lib/ai-json.js'
import { fetchReleaseInfo, downloadAsset } from '../lib/github.js'
import { runLink } from './link.js'

function parsePackageRef(pkg: string): { owner: string; repo: string; tag: string | undefined } {
  const atIdx = pkg.lastIndexOf('@')
  let ref = pkg
  let tag: string | undefined

  if (atIdx > 0) {
    tag = pkg.slice(atIdx + 1)
    ref = pkg.slice(0, atIdx)
  }

  const slashIdx = ref.indexOf('/')
  if (slashIdx < 1 || slashIdx === ref.length - 1) {
    throw new Error(`Invalid package reference "${pkg}". Expected: owner/repo or owner/repo@version`)
  }

  return { owner: ref.slice(0, slashIdx), repo: ref.slice(slashIdx + 1), tag }
}

// Recursively find dirs that directly contain SKILL.md
async function findSkillDirs(dir: string): Promise<string[]> {
  let entries: { name: string; isFile(): boolean; isDirectory(): boolean }[]
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return []
  }

  if (entries.some(e => e.isFile() && e.name === 'SKILL.md')) {
    return [dir]
  }

  const results: string[] = []
  for (const entry of entries) {
    if (entry.isDirectory()) {
      results.push(...await findSkillDirs(path.join(dir, entry.name)))
    }
  }
  return results
}

// Flatten nested skill dirs to the top level of skillsDir
async function flattenSkills(skillsDir: string): Promise<void> {
  const skillDirs = await findSkillDirs(skillsDir)

  const names = new Map<string, string>()
  for (const dir of skillDirs) {
    const name = path.basename(dir)
    if (names.has(name)) {
      throw new Error(
        `Skill name collision: "${name}" appears at "${names.get(name)}" and "${dir}" in the package`,
      )
    }
    names.set(name, dir)
  }

  for (const dir of skillDirs) {
    const dest = path.join(skillsDir, path.basename(dir))
    if (dir !== dest) {
      await cp(dir, dest, { recursive: true })
    }
  }

  // Remove category dirs (anything at top level that isn't a resolved skill dir)
  const topEntries = await readdir(skillsDir, { withFileTypes: true })
  for (const entry of topEntries) {
    if (entry.isDirectory() && !names.has(entry.name)) {
      await rm(path.join(skillsDir, entry.name), { recursive: true, force: true })
    }
  }
}

async function copyReleaseAiToLocal(extractedAiDir: string): Promise<void> {
  await mkdir('.ai', { recursive: true })
  const entries = await readdir(extractedAiDir, { withFileTypes: true })
  for (const entry of entries) {
    await cp(
      path.join(extractedAiDir, entry.name),
      path.join('.ai', entry.name),
      { recursive: true, force: true, verbatimSymlinks: true },
    )
  }
}

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

  const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'ohmyai-add-'))
  try {
    console.log(`  Downloading ${owner}/${repo}@${resolvedTag}...`)
    const assetBuffer = await downloadAsset(assetDownloadUrl)
    const zipPath = path.join(tmpDir, 'ai.zip')
    await writeFile(zipPath, assetBuffer)

    const extractDir = path.join(tmpDir, 'extracted')
    await mkdir(extractDir)
    await extractZip(zipPath, { dir: extractDir })

    const extractedAiDir = path.join(extractDir, '.ai')
    if (!existsSync(extractedAiDir)) {
      throw new Error('The release zip does not contain an .ai/ directory')
    }

    const skillsSrc = path.join(extractedAiDir, 'skills')
    if (existsSync(skillsSrc)) {
      await flattenSkills(skillsSrc)
    }

    await copyReleaseAiToLocal(extractedAiDir)

    const entry: PackageEntry = { version: resolvedTag, linked: [] }
    addPackage(aiJson, packageKey, entry)
    await writeAiJson(aiJson)

    console.log(`\nDownloaded ${owner}/${repo}@${resolvedTag}`)
    await runLink(undefined, { packageKey })
  } finally {
    await rm(tmpDir, { recursive: true, force: true })
  }
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
