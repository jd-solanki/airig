import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, mkdir, writeFile, symlink } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

vi.mock('@inquirer/prompts', () => ({ checkbox: vi.fn() }))

import { checkbox } from '@inquirer/prompts'
import { runRemove } from '../src/commands/remove.js'
import { readAiJson, writeAiJson, type AiJson } from '../src/lib/ai-json.js'

let tmpDir: string
let originalCwd: string

beforeEach(async () => {
  originalCwd = process.cwd()
  tmpDir = await mkdtemp(path.join(os.tmpdir(), 'airig-remove-test-'))
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

describe('error handling', () => {
  it('throws when the package is not installed', async () => {
    await seedAiJson({ packages: {} })
    await expect(runRemove('unknown/pkg')).rejects.toThrow('not installed')
  })
})

describe('remote package (owner/repo)', () => {
  async function setupRemote() {
    await makeFile('.ai/skills/tdd/SKILL.md')
    await makeFile('.ai/skills/coding/SKILL.md')
    await makeSymlink('.ai/skills/tdd', '.agents/skills/tdd')
    await makeSymlink('.ai/skills/coding', '.agents/skills/coding')

    await seedAiJson({
      packages: {
        'owner/repo': { version: '1.0.0', linked: ['skills/tdd', 'skills/coding'] },
      },
    })
  }

  it('removes selected remote symlinks and .ai source files', async () => {
    await setupRemote()
    vi.mocked(checkbox).mockResolvedValue([
      { packageKey: 'owner/repo', artifact: 'skills/tdd' },
    ])

    await runRemove('owner/repo')

    expect(existsSync('.agents/skills/tdd')).toBe(false)
    expect(existsSync('.agents/skills/coding')).toBe(true)
    expect(existsSync('.ai/skills/tdd')).toBe(false)
    expect(existsSync('.ai/skills/coding')).toBe(true)
    const aiJson = await readAiJson()
    expect(aiJson.packages['owner/repo']).toEqual({
      version: '1.0.0',
      linked: ['skills/coding'],
    })
    expect(aiJson).not.toHaveProperty('ownership')
  })

  it('cleans up package entry when linked list is empty', async () => {
    await seedAiJson({ packages: { 'owner/repo': { version: '1.0.0', linked: [] } } })

    await runRemove('owner/repo')

    const aiJson = await readAiJson()
    expect(aiJson.packages['owner/repo']).toBeUndefined()
  })

  it('reverse-maps codex commands into .codex/prompts target paths', async () => {
    await makeFile('.ai/.codex/commands/foo.md')
    await makeSymlink('.ai/.codex/commands/foo.md', '.codex/prompts/foo.md')
    await seedAiJson({
      packages: {
        'owner/repo': { version: '1.0.0', linked: ['.codex/commands/foo.md'] },
      },
    })
    vi.mocked(checkbox).mockResolvedValue([
      { packageKey: 'owner/repo', artifact: '.codex/commands/foo.md' },
    ])

    await runRemove('owner/repo')

    expect(existsSync('.codex/prompts/foo.md')).toBe(false)
    expect(existsSync('.ai/.codex/commands/foo.md')).toBe(false)
    const aiJson = await readAiJson()
    expect(aiJson.packages['owner/repo']).toBeUndefined()
  })
})

describe('local package (.)', () => {
  async function setupLocal() {
    await makeFile('.ai/skills/coding/SKILL.md')
    await makeFile('.ai/.claude/agents/reviewer.md')
    await makeSymlink('.ai/skills/coding', '.agents/skills/coding')
    await makeSymlink('.ai/.claude/agents/reviewer.md', '.claude/agents/reviewer.md')

    await seedAiJson({
      packages: {
        '.': { version: '*', linked: ['skills/coding', '.claude/agents/reviewer.md'] },
      },
    })
  }

  it('removes selected local symlinks but leaves .ai/ source files intact', async () => {
    await setupLocal()
    vi.mocked(checkbox).mockResolvedValue([
      { packageKey: '.', artifact: 'skills/coding' },
    ])

    await runRemove('.')

    expect(existsSync('.agents/skills/coding')).toBe(false)
    expect(existsSync('.claude/agents/reviewer.md')).toBe(true)
    expect(existsSync('.ai/skills/coding/SKILL.md')).toBe(true)
    expect(existsSync('.ai/.claude/agents/reviewer.md')).toBe(true)

    const aiJson = await readAiJson()
    expect(aiJson.packages['.']).toEqual({
      version: '*',
      linked: ['.claude/agents/reviewer.md'],
    })
  })
})
