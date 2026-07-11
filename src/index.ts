#!/usr/bin/env node
import { Command } from 'commander'
import updateNotifier from 'update-notifier'
import { publishCommand } from './commands/publish'
import { addCommand } from './commands/add'
import { removeCommand } from './commands/remove'
import { updateCommand } from './commands/update'
import { skillsCommand } from './commands/skills'
import { reportCliError } from './diagnostics'
import packageJson from '../package.json' with { type: 'json' }

updateNotifier({ pkg: packageJson }).notify({ isGlobal: true })

const program = new Command('airig')
  .description('Manage project-scoped AI Setup artifacts')
  .version(packageJson.version)

program.addCommand(publishCommand)
program.addCommand(addCommand)
program.addCommand(updateCommand)
program.addCommand(removeCommand)
program.addCommand(skillsCommand)

try {
  await program.parseAsync()
} catch (err) {
  reportCliError(err)
  process.exit(1)
}
