import { Command } from 'commander'
import { checkbox } from '@inquirer/prompts'
import { rm } from 'node:fs/promises'
import { readAiJson, writeAiJson, removePackage } from '../lib/ai-json.js'
import { targetPathsForArtifact } from '../lib/provider-registry.js'
import { unlinkFiles } from '../lib/linker.js'

interface RemoveChoice {
  packageKey: string
  artifact: string
}

export async function runRemove(pkg?: string): Promise<void> {
  const aiJson = await readAiJson()
  const packageKeys = pkg ? [pkg] : Object.keys(aiJson.packages)

  if (packageKeys.length === 0) {
    throw new Error('No AI Setup artifacts are installed.')
  }

  for (const packageKey of packageKeys) {
    if (!aiJson.packages[packageKey]) {
      throw new Error(
        `Package "${packageKey}" is not installed.\n` +
        '  Check installed packages in .ai/ai.json',
      )
    }
  }

  const choices = packageKeys.flatMap(packageKey =>
    aiJson.packages[packageKey].linked.map(artifact => ({
      value: { packageKey, artifact },
      name: `${packageKey} / ${categoryForArtifact(artifact)} / ${artifact}`,
      checked: false,
    })),
  )

  if (choices.length === 0) {
    for (const packageKey of packageKeys) removePackage(aiJson, packageKey)
    await writeAiJson(aiJson)
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

  const selectedByPackage = new Map<string, Set<string>>()
  for (const { packageKey, artifact } of selected) {
    const artifacts = selectedByPackage.get(packageKey) ?? new Set<string>()
    artifacts.add(artifact)
    selectedByPackage.set(packageKey, artifacts)
  }

  let symlinkCount = 0
  let sourceCount = 0
  for (const [packageKey, artifacts] of selectedByPackage) {
    const isLocal = packageKey === '.'
    const targetPaths = [...artifacts].flatMap(artifact => targetPathsForArtifact(artifact))
    await unlinkFiles([...new Set(targetPaths)])
    symlinkCount += targetPaths.length

    if (!isLocal) {
      for (const artifact of artifacts) {
        await rm(`.ai/${artifact}`, { recursive: true, force: true })
        sourceCount += 1
      }
    }

    const entry = aiJson.packages[packageKey]
    entry.linked = entry.linked.filter(artifact => !artifacts.has(artifact))
    if (entry.linked.length === 0) removePackage(aiJson, packageKey)
  }

  await writeAiJson(aiJson)

  console.log(`\nRemoved ${selected.length} file(s), ${symlinkCount} symlink target(s), and ${sourceCount} source file(s).`)
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
  .action(async (pkg: string | undefined) => {
    try {
      await runRemove(pkg)
    } catch (err) {
      console.error(`✖ ${(err as Error).message}`)
      process.exit(1)
    }
  })
