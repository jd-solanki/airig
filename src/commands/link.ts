import { Command } from 'commander'
import { checkbox } from '@inquirer/prompts'
import { PROVIDER_REGISTRY } from '../lib/provider-registry.js'
import { linkProviders, type SkipReason } from '../lib/linker.js'

const SKIP_REASON_LABEL: Record<SkipReason, string> = {
  'already-linked':          '↩',
  'conflict-real-file':      '⚠',
  'conflict-wrong-symlink':  '⚠',
  'excluded':                '○',
}

const SKIP_REASON_TEXT: Record<SkipReason, string> = {
  'already-linked':          'already linked',
  'conflict-real-file':      'real file at target',
  'conflict-wrong-symlink':  'symlinked elsewhere',
  'excluded':                'excluded',
}

export const linkCommand = new Command('link')
  .description('Symlink .ai/ files into provider config directories')
  .argument('[provider]', 'Provider to link: claude | codex')
  .option('--single-line-summary', 'Print a single summary line instead of grouped output')
  .action(async (provider: string | undefined, opts: { singleLineSummary?: boolean }) => {
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

    const { linked, skipped } = await linkProviders(providers)

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
  })
