import { Command } from 'commander'
import { checkbox } from '@inquirer/prompts'
import { rm } from 'node:fs/promises'
import path from 'node:path'
import { readAiJson, writeAiJson, removePackage, type AiJson } from '../lib/ai-json.js'
import { targetPathsForArtifact } from '../lib/provider-registry.js'
import { unlinkFiles } from '../lib/linker.js'
import { resolveSetupScope, type SetupScope } from '../lib/setup-scope.js'

interface RemoveOptions {
  global?: boolean
}

interface RemoveChoice {
  packageKey: string
  artifact: string
}

interface RemovePromptChoice {
  value: RemoveChoice
  name: string
  checked: boolean
}

interface RemovalSummary {
  symlinkCount: number
  sourceCount: number
}

export async function runRemove(pkg?: string, options: RemoveOptions = {}): Promise<void> {
  const scope = resolveSetupScope(options)
  const aiJson = await readAiJson(scope.aiJsonPath)
  const packageKeys = installedPackageKeys(aiJson, pkg)
  assertPackagesInstalled(aiJson, packageKeys, scope.manifestLabel)

  const choices = removeChoicesForPackages(aiJson, packageKeys)

  if (choices.length === 0) {
    removeEmptyPackages(aiJson, packageKeys)
    await writeAiJson(aiJson, scope.aiJsonPath)
    console.log('No linked files found.')
    return
  }

  const selected = await checkbox<RemoveChoice>({
    message: 'Select files to remove:',
    choices,
  })

  if (selected.length === 0) {
    console.log('No files selected.')
    return
  }

  const { symlinkCount, sourceCount } = await removeSelectedArtifacts(aiJson, selected, scope)

  await writeAiJson(aiJson, scope.aiJsonPath)

  console.log(
    `\nRemoved ${selected.length} file(s), ` +
    `${symlinkCount} symlink target(s), and ${sourceCount} source file(s).`,
  )
}

function installedPackageKeys(aiJson: AiJson, requestedPackage?: string): string[] {
  const packageKeys = requestedPackage ? [requestedPackage] : Object.keys(aiJson.packages)
  if (packageKeys.length === 0) {
    throw new Error('No AI Setup artifacts are installed.')
  }

  return packageKeys
}

function assertPackagesInstalled(
  aiJson: AiJson,
  packageKeys: string[],
  manifestLabel: string,
): void {
  for (const packageKey of packageKeys) {
    if (!aiJson.packages[packageKey]) {
      throw new Error(
        `Package "${packageKey}" is not installed.\n` +
        `  Check installed packages in ${manifestLabel}`,
      )
    }
  }
}

function removeChoicesForPackages(aiJson: AiJson, packageKeys: string[]): RemovePromptChoice[] {
  return packageKeys.flatMap(packageKey =>
    aiJson.packages[packageKey].linked.map(artifact => ({
      value: { packageKey, artifact },
      name: `${packageKey} / ${categoryForArtifact(artifact)} / ${artifact}`,
      checked: false,
    })),
  )
}

function removeEmptyPackages(aiJson: AiJson, packageKeys: string[]): void {
  for (const packageKey of packageKeys) removePackage(aiJson, packageKey)
}

async function removeSelectedArtifacts(
  aiJson: AiJson,
  selected: RemoveChoice[],
  scope: SetupScope,
): Promise<RemovalSummary> {
  let symlinkCount = 0
  let sourceCount = 0

  for (const [packageKey, artifacts] of groupArtifactsByPackage(selected)) {
    const summary = await removePackageArtifacts(aiJson, packageKey, artifacts, scope)
    symlinkCount += summary.symlinkCount
    sourceCount += summary.sourceCount
  }

  return { symlinkCount, sourceCount }
}

function groupArtifactsByPackage(selected: RemoveChoice[]): Map<string, Set<string>> {
  const selectedByPackage = new Map<string, Set<string>>()

  for (const { packageKey, artifact } of selected) {
    const artifacts = selectedByPackage.get(packageKey) ?? new Set<string>()
    artifacts.add(artifact)
    selectedByPackage.set(packageKey, artifacts)
  }

  return selectedByPackage
}

async function removePackageArtifacts(
  aiJson: AiJson,
  packageKey: string,
  artifacts: Set<string>,
  scope: SetupScope,
): Promise<RemovalSummary> {
  const entry = aiJson.packages[packageKey]
  const targetPaths = targetPathsForArtifacts([...artifacts], scope)
  await unlinkFiles(targetPaths)

  const sourceCount = entry.version === '*'
    ? 0
    : await removeRemotePackageSources(artifacts, scope)

  entry.linked = entry.linked.filter(artifact => !artifacts.has(artifact))
  if (entry.linked.length === 0) removePackage(aiJson, packageKey)

  return {
    symlinkCount: targetPaths.length,
    sourceCount,
  }
}

function targetPathsForArtifacts(artifacts: string[], scope: SetupScope): string[] {
  const targetPaths = artifacts
    .flatMap(artifact => targetPathsForArtifact(artifact))
    .map(targetPath => path.join(scope.targetRoot, targetPath))

  return [...new Set(targetPaths)]
}

async function removeRemotePackageSources(
  artifacts: Set<string>,
  scope: SetupScope,
): Promise<number> {
  for (const artifact of artifacts) {
    await rm(path.join(scope.sourceRoot, artifact), { recursive: true, force: true })
  }

  return artifacts.size
}

function categoryForArtifact(artifact: string): string {
  if (artifact === 'AGENTS.md' || artifact === 'CLAUDE.md') return 'Project Instruction Files'
  if (artifact.startsWith('skills/')) return 'Skills'
  if (artifact.includes('/commands/')) return 'Custom Commands'
  if (artifact.includes('/agents/')) return 'Agents'
  if (artifact.includes('/hooks/')) return 'Hooks'
  return 'Other'
}

export const removeCommand = new Command('remove')
  .description('Interactively remove active AI Setup artifacts')
  .argument('[package]', 'Optional package to remove from, e.g. owner/repo or .')
  .option('--global', 'Remove from the user Global AI Setup at ~/.ai')
  .action(async (pkg: string | undefined, options: RemoveOptions) => {
    try {
      await runRemove(pkg, options)
    } catch (err) {
      console.error(`✖ ${(err as Error).message}`)
      process.exit(1)
    }
  })
