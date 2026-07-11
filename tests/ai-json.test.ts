import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, mkdir, writeFile, readFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {
  readAiJson,
  writeAiJson,
  addPackage,
  removePackage,
  setLinked,
  addLinked,
  removeLinked,
  type AiJson,
} from '../src/lib/ai-json'

let tmpDir: string
let originalCwd: string

beforeEach(async () => {
  originalCwd = process.cwd()
  tmpDir = await mkdtemp(path.join(os.tmpdir(), 'airig-aijson-test-'))
  process.chdir(tmpDir)
})

afterEach(async () => {
  process.chdir(originalCwd)
  await rm(tmpDir, { recursive: true, force: true })
})

describe('readAiJson', () => {
  it('returns empty package defaults when file does not exist', async () => {
    const data = await readAiJson()
    expect(data).toEqual({ packages: {} })
  })

  it('reads positive linked lists for remote and local packages', async () => {
    const content: AiJson = {
      packages: {
        '.': { version: '*', linked: ['skills/local'] },
        'owner/repo': { version: '1.0.0', linked: ['skills/tdd', '.claude/agents/reviewer.md'] },
      },
    }
    await writeAiJson(content)

    const data = await readAiJson()
    expect(data).toEqual(content)
  })

  it('defaults missing linked lists to empty arrays', async () => {
    await mkdir('.ai', { recursive: true })
    await writeFile('.ai/ai.json', JSON.stringify({
      packages: { 'owner/repo': { version: '1.0.0' } },
    }))

    const data = await readAiJson()
    expect(data.packages['owner/repo']).toEqual({ version: '1.0.0', linked: [] })
  })

  it('does not require or preserve a stored ownership map', async () => {
    await mkdir('.ai', { recursive: true })
    await writeFile('.ai/ai.json', JSON.stringify({
      packages: { 'owner/repo': { version: '1.0.0', linked: ['skills/tdd'] } },
      ownership: { '.agents/skills/tdd': 'owner/repo@1.0.0' },
    }))

    const data = await readAiJson()
    await writeAiJson(data)

    const raw = JSON.parse(await readFile('.ai/ai.json', 'utf-8'))
    expect(raw).toEqual({
      packages: { 'owner/repo': { version: '1.0.0', linked: ['skills/tdd'] } },
    })
  })

  it('throws when file is malformed', async () => {
    await mkdir('.ai', { recursive: true })
    await writeFile('.ai/ai.json', '{ "bad": true }')

    await expect(readAiJson()).rejects.toThrow('malformed')
  })

  it('includes the manifest path when JSON cannot be parsed', async () => {
    await mkdir('.ai', { recursive: true })
    await writeFile('.ai/ai.json', '{')

    await expect(readAiJson()).rejects.toThrow('.ai/ai.json is malformed: expected valid JSON')
  })

  it('validates linked as a string array', async () => {
    await mkdir('.ai', { recursive: true })
    await writeFile('.ai/ai.json', JSON.stringify({
      packages: { 'owner/repo': { version: '1.0.0', linked: [42] } },
    }))

    await expect(readAiJson()).rejects.toThrow('linked must be a string array')
  })

  it('validates the local package sentinel version', async () => {
    await mkdir('.ai', { recursive: true })
    await writeFile('.ai/ai.json', JSON.stringify({
      packages: { '.': { version: '1.0.0', linked: [] } },
    }))

    await expect(readAiJson()).rejects.toThrow('local package "." must use version "*"')
  })

  it('allows wildcard versions for non-dot local source roots', async () => {
    await mkdir('.ai', { recursive: true })
    await writeFile('.ai/ai.json', JSON.stringify({
      packages: { '../setup-repo': { version: '*', linked: [] } },
    }))

    await expect(readAiJson()).resolves.toEqual({
      packages: { '../setup-repo': { version: '*', linked: [] } },
    })
  })

  it('reads and preserves a skills-repo source pinned to a commit SHA', async () => {
    const sha = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0'
    const content: AiJson = {
      packages: {
        'vercel-labs/skills': { source: 'skills-repo', version: sha, linked: ['skills/find-skills'] },
      },
    }
    await writeAiJson(content)

    const data = await readAiJson()
    expect(data).toEqual(content)
    const raw = JSON.parse(await readFile('.ai/ai.json', 'utf-8'))
    expect(raw.packages['vercel-labs/skills'].source).toBe('skills-repo')
  })

  it('does not add a source field to release or local entries', async () => {
    await writeAiJson({
      packages: {
        '.': { version: '*', linked: [] },
        'owner/repo': { version: '1.0.0', linked: [] },
      },
    })

    const raw = JSON.parse(await readFile('.ai/ai.json', 'utf-8'))
    expect(raw.packages['.']).not.toHaveProperty('source')
    expect(raw.packages['owner/repo']).not.toHaveProperty('source')
  })

  it('rejects an unknown source value', async () => {
    await mkdir('.ai', { recursive: true })
    await writeFile('.ai/ai.json', JSON.stringify({
      packages: { 'owner/repo': { source: 'registry', version: '1.0.0', linked: [] } },
    }))

    await expect(readAiJson()).rejects.toThrow('source')
  })
})

describe('writeAiJson', () => {
  it('creates the .ai directory and file when they do not exist', async () => {
    await writeAiJson({ packages: {} })

    const data = await readAiJson()
    expect(data).toEqual({ packages: {} })
  })

  it('writes pretty-printed JSON with a trailing newline', async () => {
    await writeAiJson({ packages: {} })
    const raw = await readFile('.ai/ai.json', 'utf-8')
    expect(raw.endsWith('\n')).toBe(true)
    expect(() => JSON.parse(raw)).not.toThrow()
  })
})

describe('package helpers', () => {
  it('addPackage inserts a package entry with linked artifacts', () => {
    const data: AiJson = { packages: {} }
    addPackage(data, 'owner/repo', { version: '1.0.0', linked: ['skills/python-pro'] })
    expect(data.packages['owner/repo']).toEqual({ version: '1.0.0', linked: ['skills/python-pro'] })
  })

  it('removePackage deletes a package entry', () => {
    const data: AiJson = { packages: { 'owner/repo': { version: '1.0.0', linked: [] } } }
    removePackage(data, 'owner/repo')
    expect(data.packages['owner/repo']).toBeUndefined()
  })

  it('removePackage on a non-existent key is a no-op', () => {
    const data: AiJson = { packages: {} }
    expect(() => removePackage(data, 'unknown/pkg')).not.toThrow()
  })
})

describe('linked helpers', () => {
  it('setLinked replaces and deduplicates linked artifacts', () => {
    const data: AiJson = { packages: { 'owner/repo': { version: '1.0.0', linked: ['skills/old'] } } }
    setLinked(data, 'owner/repo', ['skills/tdd', 'skills/tdd'])
    expect(data.packages['owner/repo'].linked).toEqual(['skills/tdd'])
  })

  it('addLinked appends a missing artifact once', () => {
    const data: AiJson = { packages: { 'owner/repo': { version: '1.0.0', linked: [] } } }
    addLinked(data, 'owner/repo', 'skills/tdd')
    addLinked(data, 'owner/repo', 'skills/tdd')
    expect(data.packages['owner/repo'].linked).toEqual(['skills/tdd'])
  })

  it('removeLinked deletes a linked artifact', () => {
    const data: AiJson = { packages: { 'owner/repo': { version: '1.0.0', linked: ['skills/tdd'] } } }
    removeLinked(data, 'owner/repo', 'skills/tdd')
    expect(data.packages['owner/repo'].linked).toEqual([])
  })
})
