import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, mkdir, writeFile, lstat, symlink, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  deriveTargetOwnership,
  linkLocalFiles,
  linkPackageArtifacts,
  linkProviders,
  unlinkFiles,
} from '../src/lib/linker.js'
import { readAiJson, type AiJson } from '../src/lib/ai-json.js'

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

  it('is idempotent when running twice', async () => {
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

  it('writes "." package entry with a positive linked list', async () => {
    await makeFile('.ai/.claude/agents/agent.md')

    await linkProviders(['claude'])

    const aiJson = await readAiJson()
    expect(aiJson).toEqual({
      packages: { '.': { version: '*', linked: ['.claude/agents/agent.md'] } },
    })
  })
})

describe('linkLocalFiles', () => {
  it('only links selected local artifacts and persists them in linked', async () => {
    await makeFile('.ai/.claude/agents/agent.md')
    await makeFile('.ai/.claude/agents/scratch.md')
    const aiJson: AiJson = { packages: { '.': { version: '*', linked: [] } } }

    const result = await linkLocalFiles(aiJson, ['claude'], new Set(['.ai/.claude/agents/agent.md']))

    expect(result.linked).toEqual(['.claude/agents/agent.md'])
    expect(existsSync('.claude/agents/agent.md')).toBe(true)
    expect(existsSync('.claude/agents/scratch.md')).toBe(false)
    expect(aiJson.packages['.'].linked).toEqual(['.claude/agents/agent.md'])
  })
})

describe('linkPackageArtifacts', () => {
  it('links only the selected remote package artifacts', async () => {
    await makeFile('.ai/.claude/agents/agent.md')
    await makeFile('.ai/.claude/agents/scratch.md')

    const result = await linkPackageArtifacts(['claude'], ['.claude/agents/agent.md'])

    expect(result.linked).toEqual(['.claude/agents/agent.md'])
    expect(existsSync('.claude/agents/agent.md')).toBe(true)
    expect(existsSync('.claude/agents/scratch.md')).toBe(false)
  })
})

describe('deriveTargetOwnership', () => {
  it('expands linked artifacts into concrete target ownership', () => {
    const ownership = deriveTargetOwnership({
      packages: {
        '.': { version: '*', linked: ['skills/local'] },
        'owner/repo': { version: '1.0.0', linked: ['.codex/commands/review.md'] },
      },
    })

    expect(ownership.get('.agents/skills/local')).toEqual([{
      packageKey: '.',
      version: '*',
      artifact: 'skills/local',
      targetPath: '.agents/skills/local',
    }])
    expect(ownership.get('.codex/prompts/review.md')).toEqual([{
      packageKey: 'owner/repo',
      version: '1.0.0',
      artifact: '.codex/commands/review.md',
      targetPath: '.codex/prompts/review.md',
    }])
  })

  it('exposes remote package conflicts through the derived target index', () => {
    const ownership = deriveTargetOwnership({
      packages: {
        'owner/one': { version: '1.0.0', linked: ['skills/tdd'] },
        'owner/two': { version: '2.0.0', linked: ['skills/tdd'] },
      },
    })

    expect(ownership.get('.agents/skills/tdd')?.map(owner => owner.packageKey)).toEqual([
      'owner/one',
      'owner/two',
    ])
  })
})

describe('unlinkFiles', () => {
  it('removes a file symlink', async () => {
    await makeFile('.ai/.claude/agents/agent.md')
    await mkdir('.claude/agents', { recursive: true })
    await symlink(path.resolve('.ai/.claude/agents/agent.md'), '.claude/agents/agent.md')

    await unlinkFiles(['.claude/agents/agent.md'])

    expect(existsSync('.claude/agents/agent.md')).toBe(false)
  })

  it('removes a directory symlink', async () => {
    await makeFile('.ai/skills/tdd/SKILL.md')
    await mkdir('.agents/skills', { recursive: true })
    await symlink(path.resolve('.ai/skills/tdd'), '.agents/skills/tdd')

    await unlinkFiles(['.agents/skills/tdd'])

    expect(existsSync('.agents/skills/tdd')).toBe(false)
    expect(existsSync('.ai/skills/tdd/SKILL.md')).toBe(true)
  })

  it('is idempotent when a symlink is already gone', async () => {
    await expect(unlinkFiles(['.claude/agents/nonexistent.md'])).resolves.not.toThrow()
  })

  it('does not remove real files', async () => {
    await makeFile('.claude/agents/real.md', 'not a symlink')

    await unlinkFiles(['.claude/agents/real.md'])

    expect(existsSync('.claude/agents/real.md')).toBe(true)
  })
})
