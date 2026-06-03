import { Command } from 'commander'

export const removeCommand = new Command('remove')
  .description('Uninstall a package — remove symlinks and clean up ai.json')
  .argument('<package>', 'Package to remove, e.g. owner/repo or . for the local package')
  .action(async (_pkg: string) => {
    console.log('remove: not yet implemented')
    process.exit(0)
  })
