import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, mkdir, writeFile, lstat, readlink, symlink, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  deriveTargetOwnership,
  findRemotePackageConflicts,
  linkLocalFiles,
  linkPackageArtifacts,
  linkProviders,
  reconcilePackageLinks,
  unlinkFiles,
} from '../src/lib/linker.js'
import { readAiJson, type AiJson } from '../src/lib/ai-json.js'

let tmpDir: string
let originalCwd: string

beforeEach(async () => {
  originalCwd = process.cwd()
  tmpDir = await mkdtemp(path.join(os.tmpdir(), 'airig-test-'))
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

  it('reports a target conflict without writing linked state when a real file exists at target', async () => {
    await makeFile('.ai/.claude/agents/agent.md')
    await makeFile('.claude/agents/agent.md', 'real file')

    await expect(linkProviders(['claude'])).rejects.toThrow('target paths are already occupied')

    const aiJson = await readAiJson()
    expect(aiJson.packages['.']).toBeUndefined()
  })

  it('reports a target conflict without writing linked state when symlink points to wrong source', async () => {
    await makeFile('.ai/.claude/agents/agent.md')
    await mkdir('.claude/agents', { recursive: true })
    await symlink('/dev/null', '.claude/agents/agent.md')

    await expect(linkProviders(['claude'])).rejects.toThrow('target paths are already occupied')

    const aiJson = await readAiJson()
    expect(aiJson.packages['.']).toBeUndefined()
  })

  it('links skills to the provider-specific skills target', async () => {
    await makeFile('.ai/skills/tdd/SKILL.md')

    await linkProviders(['claude'])

    const stat = await lstat('.claude/skills/tdd')
    expect(stat.isSymbolicLink()).toBe(true)
  })

  it('links skills to both provider targets when claude and codex are selected', async () => {
    await makeFile('.ai/skills/tdd/SKILL.md')

    await linkProviders(['claude', 'codex'])

    expect((await lstat('.claude/skills/tdd')).isSymbolicLink()).toBe(true)
    expect((await lstat('.agents/skills/tdd')).isSymbolicLink()).toBe(true)
  })

  it('links claude project instruction files to root targets', async () => {
    await makeFile('.ai/AGENTS.md')
    await makeFile('.ai/CLAUDE.md')

    const result = await linkProviders(['claude'])

    expect(result.linked).toEqual(['CLAUDE.md'])
    expect(existsSync('AGENTS.md')).toBe(false)
    expect((await lstat('CLAUDE.md')).isSymbolicLink()).toBe(true)
  })

  it('links a symlinked CLAUDE.md source without synthesizing a real file', async () => {
    await makeFile('.ai/AGENTS.md')
    await symlink('AGENTS.md', '.ai/CLAUDE.md')

    await linkProviders(['claude'])

    expect((await lstat('CLAUDE.md')).isSymbolicLink()).toBe(true)
    expect(await readlink('CLAUDE.md')).toBe('.ai/CLAUDE.md')
    expect((await lstat('.ai/CLAUDE.md')).isSymbolicLink()).toBe(true)
  })

  it('does not link AGENTS.md through the claude provider', async () => {
    await makeFile('.ai/AGENTS.md')

    const result = await linkProviders(['claude'])

    expect(result.linked).toEqual([])
    expect(existsSync('AGENTS.md')).toBe(false)
    expect(existsSync('CLAUDE.md')).toBe(false)
    expect(existsSync('.ai/CLAUDE.md')).toBe(false)
  })

  it('links AGENTS.md through the codex provider', async () => {
    await makeFile('.ai/AGENTS.md')

    const result = await linkProviders(['codex'])

    expect(result.linked).toEqual(['AGENTS.md'])
    expect(result.skipped).toHaveLength(0)
    expect((await lstat('AGENTS.md')).isSymbolicLink()).toBe(true)
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

    const result = await linkLocalFiles(aiJson, ['claude'], new Set(['.claude/agents/agent.md']))

    expect(result.linked).toEqual(['.claude/agents/agent.md'])
    expect(existsSync('.claude/agents/agent.md')).toBe(true)
    expect(existsSync('.claude/agents/scratch.md')).toBe(false)
    expect(aiJson.packages['.'].linked).toEqual(['.claude/agents/agent.md'])
  })
})

describe('reconcilePackageLinks', () => {
  it('unlinks newly unchecked artifacts without deleting .ai sources', async () => {
    await makeFile('.ai/.claude/agents/keep.md')
    await makeFile('.ai/.claude/agents/remove.md')
    await mkdir('.claude/agents', { recursive: true })
    await symlink(path.resolve('.ai/.claude/agents/keep.md'), '.claude/agents/keep.md')
    await symlink(path.resolve('.ai/.claude/agents/remove.md'), '.claude/agents/remove.md')
    const aiJson: AiJson = {
      packages: {
        '.': { version: '*', linked: ['.claude/agents/keep.md', '.claude/agents/remove.md'] },
      },
    }

    const result = await reconcilePackageLinks(
      aiJson,
      '.',
      ['claude'],
      ['.claude/agents/keep.md'],
      ['.claude/agents/keep.md', '.claude/agents/remove.md'],
    )

    expect(result.unlinked).toEqual(['.claude/agents/remove.md'])
    expect(existsSync('.claude/agents/remove.md')).toBe(false)
    expect(existsSync('.ai/.claude/agents/remove.md')).toBe(true)
    expect(aiJson.packages['.'].linked).toEqual(['.claude/agents/keep.md'])
  })

  it('blocks remote package conflicts before writing links', async () => {
    await makeFile('.ai/skills/tdd/SKILL.md')
    const aiJson: AiJson = {
      packages: {
        'owner/one': { version: '1.0.0', linked: ['skills/tdd'] },
        'owner/two': { version: '2.0.0', linked: [] },
      },
    }

    await expect(reconcilePackageLinks(
      aiJson,
      'owner/two',
      ['claude'],
      ['skills/tdd'],
      ['skills/tdd'],
    )).rejects.toThrow('Conflicts detected')
    expect(existsSync('.claude/skills/tdd')).toBe(false)
    expect(aiJson.packages['owner/two'].linked).toEqual([])
  })

  it('blocks target conflicts before mutating package linked state', async () => {
    await makeFile('.ai/skills/tdd/SKILL.md')
    await makeFile('.claude/skills/tdd', 'real file')
    const aiJson: AiJson = {
      packages: {
        'owner/repo': { version: '1.0.0', linked: [] },
      },
    }

    await expect(reconcilePackageLinks(
      aiJson,
      'owner/repo',
      ['claude'],
      ['skills/tdd'],
      ['skills/tdd'],
    )).rejects.toThrow('target paths are already occupied')

    expect(aiJson.packages['owner/repo'].linked).toEqual([])
  })

  it('removes local ownership when a remote package takes over a local link', async () => {
    await makeFile('.ai/skills/tdd/SKILL.md')
    const aiJson: AiJson = {
      packages: {
        '.': { version: '*', linked: ['skills/tdd'] },
        'owner/repo': { version: '1.0.0', linked: [] },
      },
    }

    const result = await reconcilePackageLinks(
      aiJson,
      'owner/repo',
      ['claude'],
      ['skills/tdd'],
      ['skills/tdd'],
    )

    expect(result.localOverrides).toEqual(['.claude/skills/tdd'])
    expect(aiJson.packages['.'].linked).toEqual([])
    expect(aiJson.packages['owner/repo'].linked).toEqual(['skills/tdd'])
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

    expect(ownership.get('.claude/skills/local')).toEqual([{
      packageKey: '.',
      version: '*',
      artifact: 'skills/local',
      targetPath: '.claude/skills/local',
    }])
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

describe('findRemotePackageConflicts', () => {
  it('ignores local ownership for remote takeovers', () => {
    const conflicts = findRemotePackageConflicts({
      packages: {
        '.': { version: '*', linked: ['skills/tdd'] },
        'owner/repo': { version: '1.0.0', linked: [] },
      },
    }, 'owner/repo', ['claude'], ['skills/tdd'])

    expect(conflicts).toHaveLength(0)
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
