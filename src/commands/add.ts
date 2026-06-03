import { Command } from 'commander'
import { checkbox } from '@inquirer/prompts'
import { mkdtemp, rm, mkdir, writeFile, cp, readdir, lstat, copyFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Octokit } from '@octokit/rest'
import extractZip from 'extract-zip'
import { PROVIDER_REGISTRY, rulesFor, listArtifacts } from '../lib/provider-registry.js'
import { linkProviders } from '../lib/linker.js'
import { readAiJson, writeAiJson, addPackage, type PackageEntry } from '../lib/ai-json.js'
import { fetchReleaseInfo, downloadAsset } from '../lib/github.js'

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

// Target symlink paths that would be created for an artifact given selected providers
function computeTargetPaths(artifact: string, selectedProviders: string[]): string[] {
  const targets: string[] = []
  for (const rule of rulesFor(selectedProviders)) {
    const relSource = rule.source.startsWith('.ai/') ? rule.source.slice('.ai/'.length) : rule.source
    if (artifact.startsWith(relSource + '/')) {
      targets.push(path.join(rule.target, artifact.slice(relSource.length + 1)))
    }
  }
  return targets
}

// Copy selected artifacts from the temp extracted dir into .ai/
async function copyArtifactsToAi(extractedAiDir: string, artifacts: string[]): Promise<void> {
  for (const artifact of artifacts) {
    const src = path.join(extractedAiDir, artifact)
    const dest = path.join('.ai', artifact)
    await mkdir(path.dirname(dest), { recursive: true })
    const stat = await lstat(src)
    if (stat.isDirectory()) {
      await cp(src, dest, { recursive: true })
    } else {
      await copyFile(src, dest)
    }
  }
}

async function runAdd(pkg: string): Promise<void> {
  const { owner, repo, tag: inputTag } = parsePackageRef(pkg)

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

    const allArtifacts = await listArtifacts(extractedAiDir)
    if (allArtifacts.length === 0) {
      console.log('Nothing to install — the package contains no installable artifacts.')
      return
    }

    const selectedArtifacts = await checkbox({
      message: 'Select artifacts to install:',
      choices: allArtifacts.map(a => ({ value: a, name: a, checked: true })),
    })
    if (selectedArtifacts.length === 0) {
      console.log('No artifacts selected. Nothing installed.')
      return
    }

    const excludedArtifacts = allArtifacts.filter(a => !selectedArtifacts.includes(a))

    const selectedProviders = await checkbox({
      message: 'Select providers to wire:',
      choices: Object.keys(PROVIDER_REGISTRY).map(p => ({ value: p, name: p })),
    })

    const ownershipValue = `${owner}/${repo}@${resolvedTag}`
    const aiJson = await readAiJson()
    const packageConflicts: string[] = []
    const localOverrides: string[] = []

    for (const artifact of selectedArtifacts) {
      for (const target of computeTargetPaths(artifact, selectedProviders)) {
        const existing = aiJson.ownership[target]
        if (!existing) continue
        if (existing.startsWith('.ai/')) {
          localOverrides.push(target)
        } else {
          packageConflicts.push(`  ${target}  (owned by ${existing})`)
        }
      }
    }

    if (packageConflicts.length > 0) {
      throw new Error(
        `Conflicts detected — the following symlinks are already owned by another package:\n` +
        packageConflicts.join('\n') + '\n' +
        '  Remove the conflicting package first with: ohmyai remove <owner/repo>',
      )
    }

    for (const target of localOverrides) {
      console.warn(`  ⚠ ${target} was locally-managed, now owned by ${ownershipValue}`)
    }

    await copyArtifactsToAi(extractedAiDir, selectedArtifacts)

    const linkResult = await linkProviders(aiJson, selectedProviders, ownershipValue)

    const entry: PackageEntry = { version: resolvedTag }
    if (excludedArtifacts.length > 0) entry.exclude = excludedArtifacts
    addPackage(aiJson, `${owner}/${repo}`, entry)
    await writeAiJson(aiJson)

    console.log(`\nInstalled ${owner}/${repo}@${resolvedTag}`)
    if (linkResult.linked.length > 0) {
      console.log(`\nLinked (${linkResult.linked.length}):`)
      for (const p of linkResult.linked) console.log(`  ✔ ${p}`)
    }
    if (excludedArtifacts.length > 0) {
      console.log(`\nExcluded (${excludedArtifacts.length}):`)
      for (const e of excludedArtifacts) console.log(`  ○ ${e}`)
    }
    if (localOverrides.length > 0) {
      console.log(`\nLocally-managed entries overwritten (${localOverrides.length}):`)
      for (const o of localOverrides) console.log(`  ⚠ ${o}`)
    }
    if (linkResult.skipped.length > 0) {
      console.log(`\nLink conflicts skipped (${linkResult.skipped.length}):`)
      for (const s of linkResult.skipped) console.log(`  ⚠ ${s.path}`)
    }
  } finally {
    await rm(tmpDir, { recursive: true, force: true })
  }
}

export const addCommand = new Command('add')
  .description('Install an immutable release into .ai/ with ownership tracking')
  .argument('<package>', 'Package to install, e.g. owner/repo or owner/repo@1.2.0')
  .action(async (pkg: string) => {
    try {
      await runAdd(pkg)
    } catch (err) {
      console.error(`✖ ${(err as Error).message}`)
      process.exit(1)
    }
  })
