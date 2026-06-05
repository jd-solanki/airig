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
  tmpDir = await mkdtemp(path.join(os.tmpdir(), 'ohmyai-remove-test-'))
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

  it('fully removes all symlinks, .ai/ files, and package entry without prompting', async () => {
    await setupRemote()

    await runRemove('owner/repo')

    expect(checkbox).not.toHaveBeenCalled()
    expect(existsSync('.agents/skills/tdd')).toBe(false)
    expect(existsSync('.agents/skills/coding')).toBe(false)
    expect(existsSync('.ai/skills/tdd')).toBe(false)
    expect(existsSync('.ai/skills/coding')).toBe(false)
    const aiJson = await readAiJson()
    expect(aiJson.packages['owner/repo']).toBeUndefined()
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

    await runRemove('owner/repo')

    expect(checkbox).not.toHaveBeenCalled()
    expect(existsSync('.codex/prompts/foo.md')).toBe(false)
    expect(existsSync('.ai/.codex/commands/foo.md')).toBe(false)
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

  it('removes symlinks but leaves .ai/ source files intact without prompting', async () => {
    await setupLocal()

    await runRemove('.')

    expect(checkbox).not.toHaveBeenCalled()
    expect(existsSync('.agents/skills/coding')).toBe(false)
    expect(existsSync('.claude/agents/reviewer.md')).toBe(false)
    expect(existsSync('.ai/skills/coding/SKILL.md')).toBe(true)
    expect(existsSync('.ai/.claude/agents/reviewer.md')).toBe(true)

    const aiJson = await readAiJson()
    expect(aiJson.packages['.']).toBeUndefined()
  })
})
