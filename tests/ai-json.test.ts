import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {
  readAiJson,
  writeAiJson,
  addPackage,
  removePackage,
  addOwnership,
  removeOwnership,
  type AiJson,
} from '../src/lib/ai-json.js'

let tmpDir: string
let originalCwd: string

beforeEach(async () => {
  originalCwd = process.cwd()
  tmpDir = await mkdtemp(path.join(os.tmpdir(), 'ohmyai-aijson-test-'))
  process.chdir(tmpDir)
})

afterEach(async () => {
  process.chdir(originalCwd)
  await rm(tmpDir, { recursive: true, force: true })
})

describe('readAiJson', () => {
  it('returns empty defaults when file does not exist', async () => {
    const data = await readAiJson()
    expect(data).toEqual({ packages: {}, ownership: {} })
  })

  it('reads and parses a valid file', async () => {
    const content: AiJson = {
      packages: { '.': { version: '*' } },
      ownership: { '.claude/agents/foo.md': '.ai/.claude/agents/foo.md' },
    }
    await writeAiJson(content)

    const data = await readAiJson()
    expect(data).toEqual(content)
  })

  it('throws when file is malformed', async () => {
    await mkdir('.ai', { recursive: true })
    await writeFile('.ai/ai.json', '{ "bad": true }')

    await expect(readAiJson()).rejects.toThrow('malformed')
  })
})

describe('writeAiJson', () => {
  it('creates the .ai directory and file when they do not exist', async () => {
    await writeAiJson({ packages: {}, ownership: {} })

    const data = await readAiJson()
    expect(data).toEqual({ packages: {}, ownership: {} })
  })

  it('writes pretty-printed JSON with a trailing newline', async () => {
    await writeAiJson({ packages: {}, ownership: {} })
    const raw = await (await import('node:fs/promises')).readFile('.ai/ai.json', 'utf-8')
    expect(raw.endsWith('\n')).toBe(true)
    expect(() => JSON.parse(raw)).not.toThrow()
  })
})

describe('addPackage / removePackage', () => {
  it('addPackage inserts a package entry', () => {
    const data: AiJson = { packages: {}, ownership: {} }
    addPackage(data, 'owner/repo', { version: '1.0.0' })
    expect(data.packages['owner/repo']).toEqual({ version: '1.0.0' })
  })

  it('addPackage stores the exclude list', () => {
    const data: AiJson = { packages: {}, ownership: {} }
    addPackage(data, 'owner/repo', { version: '1.0.0', exclude: ['skills/python-pro'] })
    expect(data.packages['owner/repo'].exclude).toEqual(['skills/python-pro'])
  })

  it('addPackage overwrites an existing entry', () => {
    const data: AiJson = { packages: { 'owner/repo': { version: '0.9.0' } }, ownership: {} }
    addPackage(data, 'owner/repo', { version: '1.0.0' })
    expect(data.packages['owner/repo'].version).toBe('1.0.0')
  })

  it('removePackage deletes a package entry', () => {
    const data: AiJson = { packages: { 'owner/repo': { version: '1.0.0' } }, ownership: {} }
    removePackage(data, 'owner/repo')
    expect(data.packages['owner/repo']).toBeUndefined()
  })

  it('removePackage on a non-existent key is a no-op', () => {
    const data: AiJson = { packages: {}, ownership: {} }
    expect(() => removePackage(data, 'unknown/pkg')).not.toThrow()
  })
})

describe('addOwnership / removeOwnership', () => {
  it('addOwnership inserts an ownership entry', () => {
    const data: AiJson = { packages: {}, ownership: {} }
    addOwnership(data, '.claude/agents/foo.md', 'owner/repo@1.0.0')
    expect(data.ownership['.claude/agents/foo.md']).toBe('owner/repo@1.0.0')
  })

  it('addOwnership overwrites an existing entry', () => {
    const data: AiJson = { packages: {}, ownership: { '.claude/agents/foo.md': 'old/pkg@0.1.0' } }
    addOwnership(data, '.claude/agents/foo.md', 'new/pkg@1.0.0')
    expect(data.ownership['.claude/agents/foo.md']).toBe('new/pkg@1.0.0')
  })

  it('removeOwnership deletes an ownership entry', () => {
    const data: AiJson = { packages: {}, ownership: { '.claude/agents/foo.md': 'owner/repo@1.0.0' } }
    removeOwnership(data, '.claude/agents/foo.md')
    expect(data.ownership['.claude/agents/foo.md']).toBeUndefined()
  })

  it('removeOwnership on a non-existent key is a no-op', () => {
    const data: AiJson = { packages: {}, ownership: {} }
    expect(() => removeOwnership(data, 'unknown')).not.toThrow()
  })
})
