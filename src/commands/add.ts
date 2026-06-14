import { Command } from 'commander'
import { Octokit } from '@octokit/rest'
import { checkbox } from '@inquirer/prompts'
import { existsSync } from 'node:fs'
import { lstat, mkdir, readlink, symlink } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { readAiJson, writeAiJson, addPackage, type AiJson, type PackageEntry } from '../lib/ai-json.js'
import { fetchReleaseInfo, downloadAsset } from '../lib/github.js'
import { parsePackageRef } from '../lib/package-ref.js'
import {
  copyReleaseArtifactsToLocal,
  expandReleaseArtifactsWithSymlinkDependencies,
  withExtractedReleaseAi,
} from '../lib/setup-release.js'
import { listArtifacts, PROVIDER_REGISTRY, targetPathsForArtifact } from '../lib/provider-registry.js'
import { findRemotePackageConflicts, reconcilePackageLinks } from '../lib/linker.js'

interface TargetConflict {
  targetPath: string
  reason: 'real-file' | 'wrong-symlink'
}

interface AddOptions {
  global?: boolean
}

interface AddScope {
  aiJsonPath: string
  sourceRoot: string
  targetRoot: string
  sourcePrefix: string
}

function addScope(options: AddOptions = {}): AddScope {
  if (!options.global) {
    return {
      aiJsonPath: path.join('.ai', 'ai.json'),
      sourceRoot: '.ai',
      targetRoot: '.',
      sourcePrefix: '.ai',
    }
  }

  const globalRoot = path.join(os.homedir(), '.ai')
  return {
    aiJsonPath: path.join(globalRoot, 'ai.json'),
    sourceRoot: globalRoot,
    targetRoot: globalRoot,
    sourcePrefix: globalRoot,
  }
}

export async function runAdd(pkg: string, options: AddOptions = {}): Promise<void> {
  if (pkg === '.') {
    if (options.global) {
      throw new Error('add --global . is not supported yet. Use add --global <owner/repo>[@version].')
    }
    await runAddLocal()
    return
  }

  const scope = addScope(options)
  const { owner, repo, tag: inputTag } = parsePackageRef(pkg)
  const packageKey = `${owner}/${repo}`
  const aiJson = await readAiJson(scope.aiJsonPath)
  const existingEntry = aiJson.packages[packageKey]

  if (existingEntry && inputTag && inputTag !== existingEntry.version) {
    throw new Error(
      `${packageKey} is already installed at ${existingEntry.version}.\n` +
      '  Use airig update <owner/repo>@<version> to move versions.',
    )
  }

  const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN })
  const requestedTag = existingEntry ? existingEntry.version : inputTag
  const { tag: resolvedTag, assetDownloadUrl, immutable } = await fetchReleaseInfo(owner, repo, requestedTag, octokit)

  if (!immutable) {
    throw new Error(
      `Security restriction: release ${resolvedTag} of ${owner}/${repo} is not immutable.\n` +
      '  Installing mutable releases is unsafe — assets can be swapped after you review them.\n' +
      '  Ask the package author to enable immutable releases in their repo settings.',
    )
  }

  console.log(`  Downloading ${owner}/${repo}@${resolvedTag}...`)
  const assetBuffer = await downloadAsset(assetDownloadUrl)
  await withExtractedReleaseAi(assetBuffer, 'airig-add-', async extractedAiDir => {
    const providers = await promptProviders()
    if (providers.length === 0) {
      console.log('No providers selected.')
      return
    }

    const currentLinked = existingEntry?.linked ?? []
    const selectable = (await listArtifacts(extractedAiDir, providers))
      .filter(artifact => !currentLinked.includes(artifact))
    if (selectable.length === 0) {
      console.log(`No new files found for ${packageKey}@${resolvedTag}.`)
      return
    }

    const selectedNew = await checkbox({
      message: 'Select files to add:',
      choices: selectable.map(label => ({
        value: label,
        name: label,
        checked: currentLinked.length === 0,
      })),
    })
    if (selectedNew.length === 0) {
      console.log('No files selected.')
      return
    }

    const artifactsToCopy = await expandReleaseArtifactsWithSymlinkDependencies(extractedAiDir, selectedNew)
    assertNoRemoteConflicts(aiJson, packageKey, providers, selectedNew)
    assertNoSourceConflicts(packageKey, currentLinked, artifactsToCopy, scope)
    await assertNoTargetConflicts(selectedNew, providers, scope)

    await copyReleaseArtifactsToLocal(extractedAiDir, selectedNew, scope.sourceRoot)

    const entry: PackageEntry = { version: resolvedTag, linked: [] }
    if (!existingEntry) addPackage(aiJson, packageKey, entry)

    const selected = [...new Set([...currentLinked, ...selectedNew])]
    if (options.global) {
      await reconcileRemoteGlobalPackageLinks(aiJson, packageKey, providers, selected)
    } else {
      await reconcilePackageLinks(aiJson, packageKey, providers, selected, selected)
    }
    await writeAiJson(aiJson, scope.aiJsonPath)

    console.log(`\nAdded ${selectedNew.length} file(s) from ${owner}/${repo}@${resolvedTag}.`)
  })
}

function assertNoSourceConflicts(
  packageKey: string,
  currentLinked: string[],
  artifactsToCopy: string[],
  scope = addScope(),
): void {
  const conflicts = artifactsToCopy
    .filter(artifact => !currentLinked.includes(artifact))
    .filter(artifact => existsSync(path.join(scope.sourceRoot, artifact)))

  if (conflicts.length === 0) return

  throw new Error(
    `Conflicts detected — ${packageKey} would overwrite existing .ai source files:\n` +
    conflicts.map(artifact => `  ${path.join(scope.sourcePrefix, artifact)}`).join('\n') + '\n' +
    '  Remove the conflicting files, then run add again.',
  )
}

async function runAddLocal(): Promise<void> {
  const aiJson = await readAiJson()
  aiJson.packages['.'] ??= { version: '*', linked: [] }

  const providers = await promptProviders()
  if (providers.length === 0) {
    console.log('No providers selected.')
    return
  }

  const currentLinked = aiJson.packages['.'].linked
  const selectable = (await listArtifacts('.ai', providers))
    .filter(artifact => {
      if (!currentLinked.includes(artifact)) return true
      // Still offer artifacts that are missing symlinks for the selected providers
      // (e.g. adding a new provider for an artifact that was previously linked for another provider only)
      return targetPathsForArtifact(artifact, providers).some(tp => !existsSync(tp))
    })
  if (selectable.length === 0) {
    console.log('No new local files found.')
    return
  }

  const selectedNew = await checkbox({
    message: 'Select local files to add:',
    choices: selectable.map(label => ({ value: label, name: label, checked: true })),
  })
  if (selectedNew.length === 0) {
    console.log('No files selected.')
    return
  }

  await assertNoTargetConflicts(selectedNew, providers)
  const selected = [...new Set([...currentLinked, ...selectedNew])]
  await reconcilePackageLinks(aiJson, '.', providers, selected, selected)
  await writeAiJson(aiJson)

  console.log(`\nAdded ${selectedNew.length} local file(s).`)
}

async function promptProviders(): Promise<string[]> {
  return checkbox({
    message: 'Select providers to add:',
    choices: Object.keys(PROVIDER_REGISTRY).map(p => ({ value: p, name: p })),
  })
}

function assertNoRemoteConflicts(
  aiJson: Awaited<ReturnType<typeof readAiJson>>,
  packageKey: string,
  providers: string[],
  artifacts: string[],
): void {
  const conflicts = findRemotePackageConflicts(aiJson, packageKey, providers, artifacts)
  if (conflicts.length === 0) return

  throw new Error(
    `Conflicts detected — the following symlinks are already owned by another package:\n` +
    conflicts
      .map(({ targetPath, owner }) => `  ${targetPath}  (owned by ${owner.packageKey}@${owner.version})`)
      .join('\n') + '\n' +
    '  Remove the conflicting files first with: airig remove',
  )
}

async function assertNoTargetConflicts(
  artifacts: string[],
  providers: string[],
  scope = addScope(),
): Promise<void> {
  const conflicts: TargetConflict[] = []

  for (const artifact of artifacts) {
    for (const targetPath of targetPathsForArtifact(artifact, providers)) {
      const conflict = await targetConflictFor(
        path.join(scope.sourceRoot, artifact),
        path.join(scope.targetRoot, targetPath),
      )
      if (conflict) conflicts.push(conflict)
    }
  }

  if (conflicts.length === 0) return

  throw new Error(
    `Conflicts detected — the following target paths are already occupied:\n` +
    conflicts
      .map(conflict => `  ${conflict.targetPath}  (${conflict.reason})`)
      .join('\n') + '\n' +
    '  Remove or move the conflicting files, then run add again.',
  )
}

async function targetConflictFor(
  sourcePath: string,
  targetPath: string,
): Promise<TargetConflict | undefined> {
  if (path.resolve(sourcePath) === path.resolve(targetPath)) return undefined

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

async function createScopedSymlink(sourcePath: string, targetPath: string): Promise<void> {
  if (path.resolve(sourcePath) === path.resolve(targetPath)) return

  await mkdir(path.dirname(targetPath), { recursive: true })
  const relSource = path.relative(path.dirname(targetPath), sourcePath)
  await symlink(relSource, targetPath)
}

async function reconcileRemoteGlobalPackageLinks(
  aiJson: AiJson,
  packageKey: string,
  providers: string[],
  selectedLabels: string[],
): Promise<void> {
  if (!aiJson.packages[packageKey]) {
    throw new Error(`Package "${packageKey}" is not installed.`)
  }

  const scope = addScope({ global: true })
  const selected = [...new Set(selectedLabels)]
  const conflicts = findRemotePackageConflicts(aiJson, packageKey, providers, selected)

  if (conflicts.length > 0) {
    throw new Error(
      `Conflicts detected — the following symlinks are already owned by another package:\n` +
      conflicts
        .map(({ targetPath, owner }) => `  ${targetPath}  (owned by ${owner.packageKey}@${owner.version})`)
        .join('\n') + '\n' +
      '  Remove the conflicting files first with: airig remove',
    )
  }

  await assertNoTargetConflicts(selected, providers, scope)

  const allowedTargets = new Map<string, string>()
  for (const artifact of selected) {
    for (const targetPath of targetPathsForArtifact(artifact, providers)) {
      allowedTargets.set(
        path.join(scope.targetRoot, targetPath),
        path.join(scope.sourceRoot, artifact),
      )
    }
  }

  for (const [targetPath, sourcePath] of allowedTargets) {
    if (!existsSync(targetPath)) await createScopedSymlink(sourcePath, targetPath)
  }

  aiJson.packages[packageKey].linked = selected
}

export const addCommand = new Command('add')
  .description('Interactively add active AI Setup artifacts')
  .argument('<package>', 'Package to add, e.g. owner/repo, owner/repo@1.2.0, or .')
  .option('--global', 'Install into the user Global AI Setup at ~/.ai')
  .action(async (pkg: string, options: AddOptions) => {
    try {
      await runAdd(pkg, options)
    } catch (err) {
      console.error(`✖ ${(err as Error).message}`)
      process.exit(1)
    }
  })
