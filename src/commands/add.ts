import { Command } from 'commander'

export const addCommand = new Command('add')
  .description('Install an immutable release into .ai/ with ownership tracking')
  .argument('<package>', 'Package to install, e.g. owner/repo or owner/repo@1.2.0')
  .action(async (_pkg: string) => {
    console.log('add: not yet implemented')
    process.exit(0)
  })
