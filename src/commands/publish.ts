import { Command } from 'commander'

export const publishCommand = new Command('publish')
  .description('Create an immutable GitHub release with ai.zip')
  .argument('[tag]', 'Git tag to release (defaults to latest local tag)')
  .action(async (_tag: string | undefined) => {
    console.log('publish: not yet implemented')
    process.exit(0)
  })
