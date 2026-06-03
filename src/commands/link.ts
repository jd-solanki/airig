import { Command } from 'commander'

export const linkCommand = new Command('link')
  .description('Symlink .ai/ files into provider config directories')
  .argument('[provider]', 'Provider to link: claude | codex')
  .action(async (_provider: string | undefined) => {
    console.log('link: not yet implemented')
    process.exit(0)
  })
