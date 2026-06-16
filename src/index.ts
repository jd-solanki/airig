#!/usr/bin/env node
import { Command } from 'commander'
import updateNotifier from 'update-notifier'
import { publishCommand } from './commands/publish'
import { addCommand } from './commands/add'
import { removeCommand } from './commands/remove'
import { updateCommand } from './commands/update'
import packageJson from '../package.json' with { type: 'json' }

updateNotifier({ pkg: packageJson }).notify()

const program = new Command('airig')
  .description('Manage project-scoped AI Setup artifacts')
  .version(packageJson.version)

program.addCommand(publishCommand)
program.addCommand(addCommand)
program.addCommand(updateCommand)
program.addCommand(removeCommand)

await program.parseAsync()
