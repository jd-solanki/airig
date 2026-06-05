import { Command } from 'commander'
import { checkbox } from '@inquirer/prompts'
import { PROVIDER_REGISTRY } from '../lib/provider-registry.js'
import { linkLocalFiles, scanLinkable, type SkipReason } from '../lib/linker.js'
import { readAiJson, writeAiJson } from '../lib/ai-json.js'

const SKIP_REASON_LABEL: Record<SkipReason, string> = {
  'already-linked':          '↩',
  'conflict-real-file':      '⚠',
  'conflict-wrong-symlink':  '⚠',
}

const SKIP_REASON_TEXT: Record<SkipReason, string> = {
  'already-linked':          'already linked',
  'conflict-real-file':      'real file at target',
  'conflict-wrong-symlink':  'symlinked elsewhere',
}

export const linkCommand = new Command('link')
  .description('Symlink .ai/ files into provider config directories')
  .argument('[provider]', 'Provider to link: claude | codex')
  .option('--single-line-summary', 'Print a single summary line instead of grouped output')
  .action(async (provider: string | undefined, opts: { singleLineSummary?: boolean }) => {
    try {
      await runLink(provider, opts)
    } catch (err) {
      console.error(`✖ ${(err as Error).message}`)
      process.exit(1)
    }
  })

async function runLink(provider: string | undefined, opts: { singleLineSummary?: boolean }): Promise<void> {
    let providers: string[]

    if (provider) {
      if (!PROVIDER_REGISTRY[provider]) {
        console.error(`✖ Unknown provider: ${provider}. Available: ${Object.keys(PROVIDER_REGISTRY).join(', ')}`)
        process.exit(1)
      }
      providers = [provider]
    } else {
      providers = await checkbox({
        message: 'Select providers to link:',
        choices: Object.keys(PROVIDER_REGISTRY).map(p => ({ value: p, name: p })),
      })
      if (providers.length === 0) {
        console.log('No providers selected.')
        return
      }
    }

    const aiJson = await readAiJson()
    aiJson.packages['.'] ??= { version: '*', linked: [] }
    const currentLinked = new Set(aiJson.packages['.'].linked)
    const linkable = await scanLinkable(providers)

    if (linkable.length === 0) {
      console.log('No linkable files found.')
      return
    }

    const selectedSources = await checkbox({
      message: 'Select files to link:',
      choices: linkable.map(e => ({
        value: e.sourcePath,
        name: e.label,
        checked: currentLinked.size === 0 || currentLinked.has(e.label),
      })),
    })
    if (selectedSources.length === 0) {
      console.log('No files selected.')
      aiJson.packages['.'].linked = []
      await writeAiJson(aiJson)
      return
    }

    const { linked, skipped } = await linkLocalFiles(aiJson, providers, new Set(selectedSources))
    await writeAiJson(aiJson)

    if (opts.singleLineSummary) {
      console.log(`Linked ${linked.length}, skipped ${skipped.length}.`)
      return
    }

    if (linked.length === 0 && skipped.length === 0) {
      console.log('Nothing to link.')
      return
    }

    if (linked.length > 0) {
      console.log(`\nLinked (${linked.length}):`)
      for (const p of linked) console.log(`  ✔ ${p}`)
    }

    if (skipped.length > 0) {
      console.log(`\nSkipped (${skipped.length}):`)
      for (const s of skipped) {
        console.log(`  ${SKIP_REASON_LABEL[s.reason]} ${s.path}  ${SKIP_REASON_TEXT[s.reason]}`)
      }
    }
}
