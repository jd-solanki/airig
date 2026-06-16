import { describe, expect, it } from 'vitest'
import { Command } from 'commander'
import { addCommand } from '../src/commands/add'
import { updateCommand } from '../src/commands/update'
import { removeCommand } from '../src/commands/remove'
import { publishCommand } from '../src/commands/publish'

describe('CLI options', () => {
  it('exposes --global only on supported subcommands', async () => {
    expect(addCommand.options.some(option => option.long === '--global')).toBe(true)
    expect(updateCommand.options.some(option => option.long === '--global')).toBe(true)
    expect(removeCommand.options.some(option => option.long === '--global')).toBe(true)
    expect(publishCommand.options.some(option => option.long === '--global')).toBe(false)

    const program = new Command('airig')
      .exitOverride()
      .configureOutput({ writeErr: () => {}, writeOut: () => {} })

    program.addCommand(addCommand)
    program.addCommand(updateCommand)
    program.addCommand(removeCommand)

    await expect(
      program.parseAsync(['node', 'airig', '--global', 'add', 'owner/repo']),
    ).rejects.toMatchObject({ code: 'commander.unknownOption' })
  })
})
