import { Command } from 'commander'
import { Octokit } from '@octokit/rest'
import { checkbox } from '@inquirer/prompts'
import { existsSync } from 'node:fs'
import { lstat } from 'node:fs/promises'
import path from 'node:path'
import { readAiJson, writeAiJson, addPackage, type AiJson, type PackageEntry } from '../lib/ai-json'
import { fetchReleaseInfo, downloadAsset } from '../lib/github'
import { parsePackageRef } from '../lib/package-ref'
import {
  copyReleaseArtifactsToLocal,
  expandReleaseArtifactsWithSymlinkDependencies,
  withExtractedReleaseAi,
} from '../lib/setup-release'
import { listArtifacts, PROVIDER_REGISTRY, targetPathsForArtifact } from '../lib/provider-registry'
import {
  findLocalPackageOverrides,
  findRemotePackageConflicts,
  pruneLocalPackageOverrides,
  reconcilePackageLinks,
  unlinkFiles,
} from '../lib/linker'
import {
  assertNoTargetConflicts as assertNoTargetConflictsForPairs,
  createRelativeSymlinkIfMissing,
  targetSourcePairs,
} from '../lib/target-links'
import {
  globalLocalPackageKey,
  globalLocalSourceRepoRoot,
  globalLocalSourceRoot,
  globalSetupRoot,
  resolveSetupScope,
  type SetupScope,
} from '../lib/setup-scope'
import { diagnostics } from '../diagnostics'

interface AddOptions {
  global?: boolean
}

interface LocalOverridePlan {
  overrides: ReturnType<typeof findLocalPackageOverrides>
  targetPaths: Set<string>
}

export async function runAdd(pkg: string, options: AddOptions = {}): Promise<void> {
  if (pkg === '.') {
    if (options.global) {
      await runAddGlobalLocal()
      return
    }
    await runAddLocal()
    return
  }

  const scope = resolveSetupScope(options)
  const { owner, repo, tag: inputTag } = parsePackageRef(pkg)
  const packageKey = `${owner}/${repo}`
  const aiJson = await readAiJson(scope.aiJsonPath)
  const existingEntry = aiJson.packages[packageKey]

  if (existingEntry && inputTag && inputTag !== existingEntry.version) {
    throw diagnostics.AIRIG_R0002({ packageKey, installedVersion: existingEntry.version })
  }

  const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN })
  const requestedTag = existingEntry ? existingEntry.version : inputTag
  const { tag: resolvedTag, assetDownloadUrl, immutable } = await fetchReleaseInfo(owner, repo, requestedTag, octokit)

  if (!immutable) {
    throw diagnostics.AIRIG_R0003({ owner, repo, tag: resolvedTag, action: 'Installing' })
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
    const localOverridePlan = options.global
      ? planLocalOverrides(aiJson, packageKey, providers, selectedNew, scope)
      : emptyLocalOverridePlan()
    assertNoRemoteConflicts(aiJson, packageKey, providers, selectedNew)
    await assertNoSourceConflicts(packageKey, currentLinked, artifactsToCopy, scope, localOverridePlan.targetPaths)
    await assertNoTargetConflicts(selectedNew, providers, scope, localOverridePlan.targetPaths)
    await pruneLocalOverrides(aiJson, scope, localOverridePlan.overrides)

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

async function assertNoSourceConflicts(
  packageKey: string,
  currentLinked: string[],
  artifactsToCopy: string[],
  scope = resolveSetupScope(),
  allowedLocalTargets = new Set<string>(),
): Promise<void> {
  const conflicts: string[] = []

  for (const artifact of artifactsToCopy) {
    if (currentLinked.includes(artifact)) continue

    const sourcePath = path.join(scope.sourceRoot, artifact)
    if (!existsSync(sourcePath)) continue

    const sourceStat = await lstat(sourcePath)
    const isAllowedLocalOverride = allowedLocalTargets.has(path.resolve(sourcePath)) && sourceStat.isSymbolicLink()
    if (!isAllowedLocalOverride) conflicts.push(artifact)
  }

  if (conflicts.length === 0) return

  throw diagnostics.AIRIG_R0004({
    packageKey,
    files: conflicts.map(artifact => `  ${path.join(scope.sourcePrefix, artifact)}`).join('\n'),
  })
}

function emptyLocalOverridePlan(): LocalOverridePlan {
  return {
    overrides: [],
    targetPaths: new Set<string>(),
  }
}

function planLocalOverrides(
  aiJson: AiJson,
  packageKey: string,
  providers: string[],
  artifacts: string[],
  scope: SetupScope,
): LocalOverridePlan {
  const overrides = findLocalPackageOverrides(aiJson, packageKey, providers, artifacts)
  return {
    overrides,
    targetPaths: localOverrideTargetPaths(overrides, scope),
  }
}

async function pruneLocalOverrides(
  aiJson: AiJson,
  scope: SetupScope,
  localOverrides: ReturnType<typeof findLocalPackageOverrides>,
): Promise<void> {
  await unlinkFiles(localOverrides.map(({ targetPath }) => path.join(scope.targetRoot, targetPath)))
  pruneLocalPackageOverrides(aiJson, localOverrides)
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

async function runAddGlobalLocal(): Promise<void> {
  const globalRoot = globalSetupRoot()
  const sourceRepoRoot = globalLocalSourceRepoRoot(globalRoot)
  if (path.resolve(sourceRepoRoot) === path.resolve(globalRoot)) {
    throw diagnostics.AIRIG_R0008()
  }

  const sourceRoot = globalLocalSourceRoot(globalRoot)
  const scope: SetupScope = {
    aiJsonPath: path.join(globalRoot, 'ai.json'),
    sourceRoot,
    targetRoot: globalRoot,
    sourcePrefix: sourceRoot,
    manifestLabel: '~/.ai/ai.json',
  }
  const aiJson = await readAiJson(scope.aiJsonPath)
  const packageKey = globalLocalPackageKey(globalRoot)

  // Global dogfooding records the source repository root, not its `.ai`
  // directory, so moving the repo leaves an explicit stale key for remove.
  // `version: "*"` marks this as a local source regardless of the key text.
  aiJson.packages[packageKey] ??= { version: '*', linked: [] }

  const providers = await promptProviders()
  if (providers.length === 0) {
    console.log('No providers selected.')
    return
  }

  const currentLinked = aiJson.packages[packageKey].linked
  const selectable = (await listArtifacts(sourceRoot, providers))
    .filter(artifact => {
      if (!currentLinked.includes(artifact)) return true
      return targetPathsForArtifact(artifact, providers)
        .some(targetPath => !existsSync(path.join(scope.targetRoot, targetPath)))
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

  await assertNoTargetConflicts(selectedNew, providers, scope)
  const selected = [...new Set([...currentLinked, ...selectedNew])]
  await reconcileGlobalLocalPackageLinks(aiJson, packageKey, providers, selected, scope)
  await writeAiJson(aiJson, scope.aiJsonPath)

  console.log(`\nAdded ${selectedNew.length} global local file(s).`)
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

  throw diagnostics.AIRIG_R0005({
    conflicts: conflicts
      .map(({ targetPath, owner }) => `  ${targetPath}  (owned by ${owner.packageKey}@${owner.version})`)
      .join('\n'),
    command: 'airig remove',
  })
}

async function assertNoTargetConflicts(
  artifacts: string[],
  providers: string[],
  scope = resolveSetupScope(),
  allowedWrongSymlinkTargets = new Set<string>(),
): Promise<void> {
  await assertNoTargetConflictsForPairs(
    targetSourcePairs(scope.sourceRoot, scope.targetRoot, providers, artifacts),
    'add',
    allowedWrongSymlinkTargets,
  )
}

async function reconcileRemoteGlobalPackageLinks(
  aiJson: AiJson,
  packageKey: string,
  providers: string[],
  selectedLabels: string[],
): Promise<void> {
  if (!aiJson.packages[packageKey]) {
    throw diagnostics.AIRIG_R0001({ packageKey })
  }

  const scope = resolveSetupScope({ global: true })
  const selected = [...new Set(selectedLabels)]
  const conflicts = findRemotePackageConflicts(aiJson, packageKey, providers, selected)

  if (conflicts.length > 0) {
    throw diagnostics.AIRIG_R0005({
      conflicts: conflicts
        .map(({ targetPath, owner }) => `  ${targetPath}  (owned by ${owner.packageKey}@${owner.version})`)
        .join('\n'),
      command: 'airig remove',
    })
  }

  const localOverridePlan = planLocalOverrides(aiJson, packageKey, providers, selected, scope)
  await assertNoTargetConflicts(selected, providers, scope, localOverridePlan.targetPaths)
  await pruneLocalOverrides(aiJson, scope, localOverridePlan.overrides)

  const targets = targetSourcePairs(scope.sourceRoot, scope.targetRoot, providers, selected)
  for (const [targetPath, sourcePath] of targets) {
    await createRelativeSymlinkIfMissing(sourcePath, targetPath)
  }

  aiJson.packages[packageKey].linked = selected
}

function localOverrideTargetPaths(
  localOverrides: ReturnType<typeof findLocalPackageOverrides>,
  scope: SetupScope,
): Set<string> {
  return new Set(
    localOverrides.map(({ targetPath }) => path.resolve(path.join(scope.targetRoot, targetPath))),
  )
}

async function reconcileGlobalLocalPackageLinks(
  aiJson: AiJson,
  packageKey: string,
  providers: string[],
  selectedLabels: string[],
  scope: SetupScope,
): Promise<void> {
  if (!aiJson.packages[packageKey]) {
    throw diagnostics.AIRIG_R0001({ packageKey })
  }

  const selected = [...new Set(selectedLabels)]
  await assertNoTargetConflicts(selected, providers, scope)

  const targets = targetSourcePairs(scope.sourceRoot, scope.targetRoot, providers, selected)
  for (const [targetPath, sourcePath] of targets) {
    await createRelativeSymlinkIfMissing(sourcePath, targetPath)
  }

  aiJson.packages[packageKey].linked = selected
}

export const addCommand = new Command('add')
  .description('Interactively add active AI Setup artifacts')
  .argument('<package>', 'Package to add, e.g. owner/repo, owner/repo@1.2.0, or .')
  .option('--global', 'Install into the user Global AI Setup at ~/.ai')
  .action(runAdd)
