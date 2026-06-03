import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, mkdir, writeFile, symlink, lstat } from 'node:fs/promises'
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

// ─── error handling ──────────────────────────────────────────────────────────

describe('error handling', () => {
  it('throws when the package is not installed', async () => {
    await seedAiJson({ packages: {}, ownership: {} })
    await expect(runRemove('unknown/pkg')).rejects.toThrow('not installed')
  })
})

// ─── remote package ───────────────────────────────────────────────────────────

describe('remote package (owner/repo)', () => {
  async function setupRemote() {
    await makeFile('.ai/skills/tdd/SKILL.md')
    await makeFile('.ai/skills/coding/SKILL.md')
    await makeSymlink('.ai/skills/tdd', '.agents/skills/tdd')
    await makeSymlink('.ai/skills/coding', '.agents/skills/coding')

    await seedAiJson({
      packages: { 'owner/repo': { version: '1.0.0' } },
      ownership: {
        '.agents/skills/tdd': 'owner/repo@1.0.0',
        '.agents/skills/coding': 'owner/repo@1.0.0',
      },
    })
  }

  it('does nothing when user keeps all artifacts (unchecks nothing)', async () => {
    await setupRemote()
    // checkbox returns both targets = user kept all = nothing to remove
    vi.mocked(checkbox).mockResolvedValue(['.agents/skills/tdd', '.agents/skills/coding'])

    await runRemove('owner/repo')

    expect(existsSync('.agents/skills/tdd')).toBe(true)
    expect(existsSync('.agents/skills/coding')).toBe(true)
    const aiJson = await readAiJson()
    expect(aiJson.packages['owner/repo']).toBeDefined()
  })

  it('fully removes all symlinks, .ai/ files, and package entry', async () => {
    await setupRemote()
    // checkbox returns [] = user unchecked all = remove everything
    vi.mocked(checkbox).mockResolvedValue([])

    await runRemove('owner/repo')

    expect(existsSync('.agents/skills/tdd')).toBe(false)
    expect(existsSync('.agents/skills/coding')).toBe(false)
    expect(existsSync('.ai/skills/tdd')).toBe(false)
    expect(existsSync('.ai/skills/coding')).toBe(false)
    const aiJson = await readAiJson()
    expect(aiJson.packages['owner/repo']).toBeUndefined()
    expect(aiJson.ownership['.agents/skills/tdd']).toBeUndefined()
    expect(aiJson.ownership['.agents/skills/coding']).toBeUndefined()
  })

  it('partially removes selected artifacts and updates exclude list', async () => {
    await setupRemote()
    // checkbox returns [tdd] = user kept tdd, unchecked coding = remove coding only
    vi.mocked(checkbox).mockResolvedValue(['.agents/skills/tdd'])

    await runRemove('owner/repo')

    expect(existsSync('.agents/skills/tdd')).toBe(true)
    expect(existsSync('.agents/skills/coding')).toBe(false)
    expect(existsSync('.ai/skills/tdd')).toBe(true)
    expect(existsSync('.ai/skills/coding')).toBe(false)

    const aiJson = await readAiJson()
    expect(aiJson.packages['owner/repo']).toBeDefined()
    expect(aiJson.packages['owner/repo'].exclude).toContain('skills/coding')
    expect(aiJson.ownership['.agents/skills/tdd']).toBe('owner/repo@1.0.0')
    expect(aiJson.ownership['.agents/skills/coding']).toBeUndefined()
  })

  it('cleans up package entry when ownership map is already empty', async () => {
    await seedAiJson({ packages: { 'owner/repo': { version: '1.0.0' } }, ownership: {} })

    await runRemove('owner/repo')

    const aiJson = await readAiJson()
    expect(aiJson.packages['owner/repo']).toBeUndefined()
  })

  it('reverse-maps codex prompts target to .codex/commands artifact path in exclude', async () => {
    await makeFile('.ai/.codex/commands/foo.md')
    await makeSymlink('.ai/.codex/commands/foo.md', '.codex/prompts/foo.md')
    await seedAiJson({
      packages: { 'owner/repo': { version: '1.0.0' } },
      ownership: { '.codex/prompts/foo.md': 'owner/repo@1.0.0' },
    })
    // keep nothing = remove foo.md
    vi.mocked(checkbox).mockResolvedValue([])

    await runRemove('owner/repo')

    expect(existsSync('.codex/prompts/foo.md')).toBe(false)
    expect(existsSync('.ai/.codex/commands/foo.md')).toBe(false)
  })
})

// ─── local package (.) ────────────────────────────────────────────────────────

describe('local package (.)', () => {
  async function setupLocal() {
    await makeFile('.ai/skills/coding/SKILL.md')
    await makeFile('.ai/.claude/agents/reviewer.md')
    await makeSymlink('.ai/skills/coding', '.agents/skills/coding')
    await makeSymlink('.ai/.claude/agents/reviewer.md', '.claude/agents/reviewer.md')

    await seedAiJson({
      packages: { '.': { version: '*' } },
      ownership: {
        '.agents/skills/coding': '.ai/skills/coding',
        '.claude/agents/reviewer.md': '.ai/.claude/agents/reviewer.md',
      },
    })
  }

  it('removes symlinks but leaves .ai/ source files intact on full removal', async () => {
    await setupLocal()
    vi.mocked(checkbox).mockResolvedValue([])

    await runRemove('.')

    expect(existsSync('.agents/skills/coding')).toBe(false)
    expect(existsSync('.claude/agents/reviewer.md')).toBe(false)
    expect(existsSync('.ai/skills/coding/SKILL.md')).toBe(true)
    expect(existsSync('.ai/.claude/agents/reviewer.md')).toBe(true)

    const aiJson = await readAiJson()
    expect(aiJson.packages['.']).toBeUndefined()
  })

  it('partially removes symlinks and updates exclude, keeps .ai/ files', async () => {
    await setupLocal()
    // keep reviewer, uncheck coding = remove coding symlink only
    vi.mocked(checkbox).mockResolvedValue(['.claude/agents/reviewer.md'])

    await runRemove('.')

    expect(existsSync('.agents/skills/coding')).toBe(false)
    expect(existsSync('.claude/agents/reviewer.md')).toBe(true)
    expect(existsSync('.ai/skills/coding/SKILL.md')).toBe(true)

    const aiJson = await readAiJson()
    expect(aiJson.packages['.']).toBeDefined()
    expect(aiJson.packages['.'].exclude).toContain('skills/coding')
    expect(aiJson.ownership['.claude/agents/reviewer.md']).toBeDefined()
    expect(aiJson.ownership['.agents/skills/coding']).toBeUndefined()
  })
})
