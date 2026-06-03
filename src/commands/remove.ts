import { Command } from 'commander'
import { checkbox } from '@inquirer/prompts'
import { rm } from 'node:fs/promises'
import path from 'node:path'
import { PROVIDER_REGISTRY, SKILLS_RULE, type SymlinkRule } from '../lib/provider-registry.js'
import { readAiJson, writeAiJson, removePackage, removeOwnership } from '../lib/ai-json.js'
import { unlinkFiles } from '../lib/linker.js'

function allRules(): SymlinkRule[] {
  return [
    ...Object.values(PROVIDER_REGISTRY).flatMap(p => p.rules),
    SKILLS_RULE,
  ]
}

// Reverse-map a symlink target path to the .ai/-relative artifact path
function targetToArtifact(targetPath: string): string | undefined {
  for (const rule of allRules()) {
    if (targetPath === rule.target || targetPath.startsWith(rule.target + '/')) {
      const rel = path.relative(rule.target, targetPath)
      return rule.source.slice('.ai/'.length) + '/' + rel
    }
  }
  return undefined
}

export async function runRemove(pkg: string): Promise<void> {
  const aiJson = await readAiJson()

  if (!aiJson.packages[pkg]) {
    throw new Error(
      `Package "${pkg}" is not installed.\n` +
      '  Check installed packages in .ai/ai.json',
    )
  }

  const isLocal = pkg === '.'
  const version = aiJson.packages[pkg].version
  const ownershipValue = isLocal ? null : `${pkg}@${version}`

  const ownedTargets = Object.entries(aiJson.ownership)
    .filter(([, v]) => isLocal ? v.startsWith('.ai/') : v === ownershipValue)
    .map(([targetPath]) => targetPath)

  if (ownedTargets.length === 0) {
    console.log('No owned artifacts found. Cleaning up package entry.')
    removePackage(aiJson, pkg)
    await writeAiJson(aiJson)
    return
  }

  // All pre-checked = currently installed. User unchecks what they want removed.
  const kept = await checkbox({
    message: `Deselect artifacts to remove from ${pkg}:`,
    choices: ownedTargets.map(targetPath => ({
      value: targetPath,
      name: targetToArtifact(targetPath) ?? targetPath,
      checked: true,
    })),
  })

  const toRemove = ownedTargets.filter(t => !kept.includes(t))

  if (toRemove.length === 0) {
    console.log('Nothing removed.')
    return
  }

  const isFullRemoval = toRemove.length === ownedTargets.length

  await unlinkFiles(toRemove)

  const filesDeleted: string[] = []
  if (!isLocal) {
    for (const targetPath of toRemove) {
      const artifact = targetToArtifact(targetPath)
      if (!artifact) continue
      const aiPath = `.ai/${artifact}`
      try {
        await rm(aiPath, { recursive: true, force: true })
        filesDeleted.push(aiPath)
      } catch {
        // already gone
      }
    }
  }

  const addedExcludes: string[] = []
  if (isFullRemoval) {
    for (const targetPath of toRemove) removeOwnership(aiJson, targetPath)
    removePackage(aiJson, pkg)
  } else {
    for (const targetPath of toRemove) {
      removeOwnership(aiJson, targetPath)
      const artifact = targetToArtifact(targetPath)
      if (artifact) {
        aiJson.packages[pkg].exclude ??= []
        aiJson.packages[pkg].exclude!.push(artifact)
        addedExcludes.push(artifact)
      }
    }
  }

  await writeAiJson(aiJson)

  console.log(`\nRemoved symlinks (${toRemove.length}):`)
  for (const t of toRemove) console.log(`  ✔ ${t}`)

  if (filesDeleted.length > 0) {
    console.log(`\nDeleted from .ai/ (${filesDeleted.length}):`)
    for (const f of filesDeleted) console.log(`  ✔ ${f}`)
  }

  if (!isFullRemoval && addedExcludes.length > 0) {
    console.log(`\nAdded to exclude (${addedExcludes.length}):`)
    for (const e of addedExcludes) console.log(`  ○ ${e}`)
  }

  if (isFullRemoval) {
    console.log(`\nPackage "${pkg}" fully uninstalled.`)
  }
}

export const removeCommand = new Command('remove')
  .description('Uninstall or trim artifacts from an installed package')
  .argument('<package>', 'Package to remove, e.g. owner/repo or . for the local package')
  .action(async (pkg: string) => {
    try {
      await runRemove(pkg)
    } catch (err) {
      console.error(`✖ ${(err as Error).message}`)
      process.exit(1)
    }
  })
