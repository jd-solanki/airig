import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, mkdir, writeFile, symlink } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

vi.mock('@inquirer/prompts', () => ({ checkbox: vi.fn() }))

import { checkbox } from '@inquirer/prompts'
import { runLink } from '../src/commands/link.js'
import { readAiJson, writeAiJson, type AiJson } from '../src/lib/ai-json.js'

let tmpDir: string
let originalCwd: string

beforeEach(async () => {
  originalCwd = process.cwd()
  tmpDir = await mkdtemp(path.join(os.tmpdir(), 'ohmyai-link-test-'))
  process.chdir(tmpDir)
  vi.resetAllMocks()
})

afterEach(async () => {
  process.chdir(originalCwd)
  await rm(tmpDir, { recursive: true, force: true })
})

async function makeFile(filePath: string, content = 'test') {
  await mkdir(path.dirname(filePath), { recursive: true })
  await writeFile(filePath, content)
}

async function makeSymlink(sourcePath: string, linkPath: string) {
  await mkdir(path.dirname(linkPath), { recursive: true })
  await symlink(path.resolve(sourcePath), linkPath)
}

async function seedAiJson(data: AiJson) {
  await writeAiJson(data)
}

describe('runLink', () => {
  it('asks for providers before artifacts and uses source artifact labels as choices', async () => {
    await makeFile('.ai/.claude/agents/reviewer.md')
    const calls: unknown[] = []
    vi.mocked(checkbox).mockImplementation(async (prompt: unknown) => {
      calls.push(prompt)
      const message = (prompt as { message: string }).message
      if (message.includes('providers')) return ['claude']
      return ['.claude/agents/reviewer.md']
    })

    await runLink(undefined, { singleLineSummary: true })

    expect(calls).toHaveLength(2)
    expect((calls[0] as { message: string }).message).toBe('Select providers to link:')
    expect((calls[1] as { message: string }).message).toBe('Select files to link:')
    expect((calls[1] as { choices: Array<{ value: string, name: string }> }).choices).toEqual([
      {
        value: '.claude/agents/reviewer.md',
        name: '.claude/agents/reviewer.md',
        checked: true,
      },
    ])
  })

  it('shows claude project instruction files alongside provider artifacts', async () => {
    await makeFile('.ai/AGENTS.md')
    await makeFile('.ai/CLAUDE.md')
    await makeFile('.ai/.claude/agents/reviewer.md')
    vi.mocked(checkbox).mockResolvedValue(['CLAUDE.md'])

    await runLink('claude', { singleLineSummary: true })

    expect((vi.mocked(checkbox).mock.calls[0][0] as {
      choices: Array<{ value: string, name: string, checked: boolean }>
    }).choices).toEqual([
      { value: 'CLAUDE.md', name: 'CLAUDE.md', checked: true },
      { value: '.claude/agents/reviewer.md', name: '.claude/agents/reviewer.md', checked: true },
    ])
    expect(existsSync('AGENTS.md')).toBe(false)
    expect(existsSync('CLAUDE.md')).toBe(true)
    expect(existsSync('.claude/agents/reviewer.md')).toBe(false)
  })

  it('unlinks deselected artifacts, keeps source files, and updates linked labels', async () => {
    await makeFile('.ai/.claude/agents/keep.md')
    await makeFile('.ai/.claude/agents/remove.md')
    await makeSymlink('.ai/.claude/agents/keep.md', '.claude/agents/keep.md')
    await makeSymlink('.ai/.claude/agents/remove.md', '.claude/agents/remove.md')
    await seedAiJson({
      packages: {
        '.': { version: '*', linked: ['.claude/agents/keep.md', '.claude/agents/remove.md'] },
      },
    })
    vi.mocked(checkbox).mockResolvedValue(['.claude/agents/keep.md'])

    await runLink('claude', { singleLineSummary: true })

    expect(existsSync('.claude/agents/keep.md')).toBe(true)
    expect(existsSync('.claude/agents/remove.md')).toBe(false)
    expect(existsSync('.ai/.claude/agents/remove.md')).toBe(true)

    const aiJson = await readAiJson()
    expect(aiJson.packages['.']).toEqual({
      version: '*',
      linked: ['.claude/agents/keep.md'],
    })
  })

  it('updates the requested remote package linked list', async () => {
    await makeFile('.ai/skills/tdd/SKILL.md')
    await seedAiJson({
      packages: {
        'owner/repo': { version: '1.0.0', linked: [] },
      },
    })
    vi.mocked(checkbox).mockResolvedValue(['skills/tdd'])

    await runLink('claude', { singleLineSummary: true, packageKey: 'owner/repo' })

    expect(existsSync('.agents/skills/tdd')).toBe(true)
    const aiJson = await readAiJson()
    expect(aiJson.packages).toEqual({
      'owner/repo': { version: '1.0.0', linked: ['skills/tdd'] },
    })
  })

  it('blocks remote package conflicts before writes', async () => {
    await makeFile('.ai/skills/tdd/SKILL.md')
    await seedAiJson({
      packages: {
        'owner/one': { version: '1.0.0', linked: ['skills/tdd'] },
        'owner/two': { version: '2.0.0', linked: [] },
      },
    })
    vi.mocked(checkbox).mockResolvedValue(['skills/tdd'])

    await expect(runLink('claude', {
      singleLineSummary: true,
      packageKey: 'owner/two',
    })).rejects.toThrow('Conflicts detected')

    expect(existsSync('.agents/skills/tdd')).toBe(false)
    const aiJson = await readAiJson()
    expect(aiJson.packages['owner/two'].linked).toEqual([])
  })
})
