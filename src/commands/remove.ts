import { Command } from 'commander'
import { checkbox } from '@inquirer/prompts'
import { rm } from 'node:fs/promises'
import { artifactForTarget } from '../lib/provider-registry.js'
import { readAiJson, writeAiJson, removePackage, setLinked } from '../lib/ai-json.js'
import { deriveTargetOwnership, unlinkFiles, type OwnedTarget } from '../lib/linker.js'


export async function runRemove(pkg: string): Promise<void> {
  const aiJson = await readAiJson()

  if (!aiJson.packages[pkg]) {
    throw new Error(
      `Package "${pkg}" is not installed.\n` +
      '  Check installed packages in .ai/ai.json',
    )
  }

  const isLocal = pkg === '.'
  const ownership = deriveTargetOwnership(aiJson)
  const ownedEntries = [...ownership.values()]
    .flat()
    .filter(owner => owner.packageKey === pkg)
  const ownedTargets = [...new Set(ownedEntries.map(owner => owner.targetPath))]

  if (ownedTargets.length === 0) {
    console.log('No owned artifacts found. Cleaning up package entry.')
    removePackage(aiJson, pkg)
    await writeAiJson(aiJson)
    return
  }

  // Removal is expressed as deselecting active artifacts, so currently linked targets start checked.
  const kept = await checkbox({
    message: `Deselect artifacts to remove from ${pkg}:`,
    choices: ownedTargets.map(targetPath => ({
      value: targetPath,
      name: artifactForTarget(targetPath) ?? targetPath,
      checked: true,
    })),
  })

  const toRemove = ownedTargets.filter(t => !kept.includes(t))

  if (toRemove.length === 0) {
    console.log('Nothing removed.')
    return
  }

  const isFullRemoval = toRemove.length === ownedTargets.length
  const removedTargetSet = new Set(toRemove)
  const removedEntries = ownedEntries.filter(owner => removedTargetSet.has(owner.targetPath))
  const keptArtifacts = keptArtifactsFromTargets(ownedEntries, kept)

  await unlinkFiles(toRemove)

  const filesDeleted: string[] = []
  if (!isLocal) {
    for (const artifact of new Set(removedEntries.map(owner => owner.artifact))) {
      const aiPath = `.ai/${artifact}`
      try {
        await rm(aiPath, { recursive: true, force: true })
        filesDeleted.push(aiPath)
      } catch {
        // already gone
      }
    }
  }

  if (isFullRemoval) {
    removePackage(aiJson, pkg)
  } else {
    setLinked(aiJson, pkg, keptArtifacts)
  }

  await writeAiJson(aiJson)

  console.log(`\nRemoved symlinks (${toRemove.length}):`)
  for (const t of toRemove) console.log(`  ✔ ${t}`)

  if (filesDeleted.length > 0) {
    console.log(`\nDeleted from .ai/ (${filesDeleted.length}):`)
    for (const f of filesDeleted) console.log(`  ✔ ${f}`)
  }

  if (!isFullRemoval) {
    console.log(`\nStill linked (${keptArtifacts.length}):`)
    for (const e of keptArtifacts) console.log(`  ↩ ${e}`)
  }

  if (isFullRemoval) {
    console.log(`\nPackage "${pkg}" fully uninstalled.`)
  }
}

function keptArtifactsFromTargets(ownedEntries: OwnedTarget[], keptTargets: string[]): string[] {
  const keptTargetSet = new Set(keptTargets)
  return [...new Set(
    ownedEntries
      .filter(owner => keptTargetSet.has(owner.targetPath))
      .map(owner => owner.artifact),
  )]
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
