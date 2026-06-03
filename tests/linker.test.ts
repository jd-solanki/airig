import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, mkdir, writeFile, lstat, symlink, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { linkProviders } from '../src/lib/linker.js'
import { readAiJson } from '../src/lib/ai-json.js'

let tmpDir: string
let originalCwd: string

beforeEach(async () => {
  originalCwd = process.cwd()
  tmpDir = await mkdtemp(path.join(os.tmpdir(), 'ohmyai-test-'))
  process.chdir(tmpDir)
})

afterEach(async () => {
  process.chdir(originalCwd)
  await rm(tmpDir, { recursive: true, force: true })
})

async function makeFile(filePath: string, content = 'test') {
  await mkdir(path.dirname(filePath), { recursive: true })
  await writeFile(filePath, content)
}

describe('linkProviders', () => {
  it('creates symlinks for files in source dir', async () => {
    await makeFile('.ai/.claude/agents/agent.md')

    const result = await linkProviders(['claude'])

    expect(result.linked).toEqual(['.claude/agents/agent.md'])
    expect(result.skipped).toHaveLength(0)
    const stat = await lstat('.claude/agents/agent.md')
    expect(stat.isSymbolicLink()).toBe(true)
  })

  it('creates missing target directories', async () => {
    await makeFile('.ai/.claude/agents/agent.md')

    expect(existsSync('.claude/agents')).toBe(false)
    await linkProviders(['claude'])
    expect(existsSync('.claude/agents')).toBe(true)
  })

  it('is idempotent — running twice skips already-correct symlinks', async () => {
    await makeFile('.ai/.claude/agents/agent.md')

    await linkProviders(['claude'])
    const result = await linkProviders(['claude'])

    expect(result.linked).toHaveLength(0)
    expect(result.skipped).toEqual([{ path: '.claude/agents/agent.md', reason: 'already-linked' }])
  })

  it('skips with conflict-real-file reason when a real file exists at target', async () => {
    await makeFile('.ai/.claude/agents/agent.md')
    await makeFile('.claude/agents/agent.md', 'real file')

    const result = await linkProviders(['claude'])

    expect(result.linked).toHaveLength(0)
    expect(result.skipped).toEqual([{ path: '.claude/agents/agent.md', reason: 'conflict-real-file' }])
  })

  it('skips with conflict-wrong-symlink reason when symlink points to wrong source', async () => {
    await makeFile('.ai/.claude/agents/agent.md')
    await mkdir('.claude/agents', { recursive: true })
    await symlink('/dev/null', '.claude/agents/agent.md')

    const result = await linkProviders(['claude'])

    expect(result.linked).toHaveLength(0)
    expect(result.skipped).toEqual([{ path: '.claude/agents/agent.md', reason: 'conflict-wrong-symlink' }])
  })

  it('always links skills regardless of provider selection', async () => {
    await makeFile('.ai/skills/tdd/SKILL.md')

    await linkProviders(['claude'])

    const stat = await lstat('.agents/skills/tdd')
    expect(stat.isSymbolicLink()).toBe(true)
  })

  it('writes ownership entries to ai.json', async () => {
    await makeFile('.ai/.claude/agents/agent.md')

    await linkProviders(['claude'])

    const aiJson = await readAiJson()
    expect(aiJson.ownership['.claude/agents/agent.md']).toBe('.ai/.claude/agents/agent.md')
  })

  it('writes "." package entry to ai.json', async () => {
    await makeFile('.ai/.claude/agents/agent.md')

    await linkProviders(['claude'])

    const aiJson = await readAiJson()
    expect(aiJson.packages['.']).toEqual({ version: '*' })
  })

  it('uses provided ownershipValue instead of source path', async () => {
    await makeFile('.ai/.claude/agents/agent.md')

    await linkProviders(['claude'], 'owner/repo@1.0.0')

    const aiJson = await readAiJson()
    expect(aiJson.ownership['.claude/agents/agent.md']).toBe('owner/repo@1.0.0')
    expect(aiJson.packages['.']).toBeUndefined()
  })

  it('skips files in the exclude list', async () => {
    await makeFile('.ai/.claude/agents/agent.md')
    await makeFile('.ai/.claude/agents/scratch.md')
    await makeFile('.ai/ai.json', JSON.stringify({
      packages: { '.': { version: '*', exclude: ['.claude/agents/scratch.md'] } },
      ownership: {},
    }))

    const result = await linkProviders(['claude'])

    expect(result.linked).toEqual(['.claude/agents/agent.md'])
    expect(result.skipped).toEqual([{ path: '.claude/agents/scratch.md', reason: 'excluded' }])
    expect(existsSync('.claude/agents/agent.md')).toBe(true)
    expect(existsSync('.claude/agents/scratch.md')).toBe(false)
  })
})
