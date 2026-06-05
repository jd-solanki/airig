import { Command } from 'commander'
import { rm } from 'node:fs/promises'
import { readAiJson, writeAiJson, removePackage } from '../lib/ai-json.js'
import { deriveTargetOwnership, unlinkFiles } from '../lib/linker.js'


export async function runRemove(pkg: string): Promise<void> {
  const aiJson = await readAiJson()

  if (!aiJson.packages[pkg]) {
    throw new Error(
      `Package "${pkg}" is not installed.\n` +
      '  Check installed packages in .ai/ai.json',
    )
  }

  const isLocal = pkg === '.'
  const linkedArtifacts = aiJson.packages[pkg].linked
  const ownership = deriveTargetOwnership(aiJson)
  const ownedEntries = [...ownership.values()]
    .flat()
    .filter(owner => owner.packageKey === pkg)
  const ownedTargets = [...new Set(ownedEntries.map(owner => owner.targetPath))]

  await unlinkFiles(ownedTargets)

  const filesDeleted: string[] = []
  if (!isLocal) {
    for (const artifact of new Set(linkedArtifacts)) {
      const aiPath = `.ai/${artifact}`
      try {
        await rm(aiPath, { recursive: true, force: true })
        filesDeleted.push(aiPath)
      } catch {
        // Source cleanup should not fail the uninstall when the local tree was already edited.
      }
    }
  }

  removePackage(aiJson, pkg)
  await writeAiJson(aiJson)

  if (ownedTargets.length > 0) {
    console.log(`\nRemoved symlinks (${ownedTargets.length}):`)
    for (const t of ownedTargets) console.log(`  ✔ ${t}`)
  }

  if (filesDeleted.length > 0) {
    console.log(`\nDeleted from .ai/ (${filesDeleted.length}):`)
    for (const f of filesDeleted) console.log(`  ✔ ${f}`)
  }

  console.log(`\nPackage "${pkg}" fully uninstalled.`)
}

export const removeCommand = new Command('remove')
  .description('Uninstall an installed package')
  .argument('<package>', 'Package to remove, e.g. owner/repo or . for the local package')
  .action(async (pkg: string) => {
    try {
      await runRemove(pkg)
    } catch (err) {
      console.error(`✖ ${(err as Error).message}`)
      process.exit(1)
    }
  })
