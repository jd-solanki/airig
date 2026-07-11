import { describe, expect, it } from 'vitest'
import { Command } from 'commander'
import { addCommand } from '../src/commands/add'
import { updateCommand } from '../src/commands/update'
import { removeCommand } from '../src/commands/remove'
import { publishCommand } from '../src/commands/publish'
import { skillsCommand } from '../src/commands/skills'

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

  it('exposes skills add/update/remove subcommands, each with --global', () => {
    const subcommands = skillsCommand.commands.map(command => command.name())
    expect(subcommands).toEqual(['add', 'update', 'remove'])

    for (const command of skillsCommand.commands) {
      expect(command.options.some(option => option.long === '--global')).toBe(true)
    }
  })

  it('exposes a repeatable --skill selector only on skills add', () => {
    const add = skillsCommand.commands.find(command => command.name() === 'add')
    const update = skillsCommand.commands.find(command => command.name() === 'update')
    expect(add?.options.some(option => option.long === '--skill')).toBe(true)
    expect(update?.options.some(option => option.long === '--skill')).toBe(false)
  })
})
