#!/usr/bin/env node
import { Command } from 'commander'
import { publishCommand } from './commands/publish.js'
import { addCommand } from './commands/add.js'
import { removeCommand } from './commands/remove.js'
import { updateCommand } from './commands/update.js'
import { maybeNotifyForUpdate } from './lib/update-notifier.js'
import packageJson from '../package.json' with { type: 'json' }

const program = new Command('airig')
  .description('Manage project-scoped AI Setup artifacts')
  .version(packageJson.version)

program.addCommand(publishCommand)
program.addCommand(addCommand)
program.addCommand(updateCommand)
program.addCommand(removeCommand)

program.hook('postAction', () => {
  try {
    maybeNotifyForUpdate()
  } catch {}
})

await program.parseAsync()
