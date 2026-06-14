import { describe, expect, it } from 'vitest'
import { Command } from 'commander'
import { addCommand } from '../src/commands/add.js'
import { updateCommand } from '../src/commands/update.js'
import { publishCommand } from '../src/commands/publish.js'

describe('CLI options', () => {
  it('exposes --global only on supported subcommands', async () => {
    expect(addCommand.options.some(option => option.long === '--global')).toBe(true)
    expect(updateCommand.options.some(option => option.long === '--global')).toBe(true)
    expect(publishCommand.options.some(option => option.long === '--global')).toBe(false)

    const program = new Command('airig')
      .exitOverride()
      .configureOutput({ writeErr: () => {}, writeOut: () => {} })

    program.addCommand(addCommand)
    program.addCommand(updateCommand)

    await expect(
      program.parseAsync(['node', 'airig', '--global', 'add', 'owner/repo']),
    ).rejects.toMatchObject({ code: 'commander.unknownOption' })
  })
})
