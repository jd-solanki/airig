#!/usr/bin/env node
import { Command } from 'commander'
import { linkCommand } from './commands/link.js'
import { publishCommand } from './commands/publish.js'
import { addCommand } from './commands/add.js'
import { removeCommand } from './commands/remove.js'

const program = new Command('ohmyai')
  .description('Distribute and manage AI setups across providers')

program.addCommand(linkCommand)
program.addCommand(publishCommand)
program.addCommand(addCommand)
program.addCommand(removeCommand)

program.parse()
