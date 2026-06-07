import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, mkdir, writeFile, readFile, symlink, lstat, readlink } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

vi.mock('@inquirer/prompts', () => ({ checkbox: vi.fn() }))
vi.mock('../src/lib/github.js', () => ({
  fetchReleaseInfo: vi.fn(),
  downloadAsset: vi.fn(),
}))

import { checkbox } from '@inquirer/prompts'
import { runAdd } from '../src/commands/add.js'
import { readAiJson, writeAiJson } from '../src/lib/ai-json.js'
import { create } from '../src/lib/zip.js'
import { fetchReleaseInfo, downloadAsset } from '../src/lib/github.js'

let tmpDir: string
let originalCwd: string

beforeEach(async () => {
  originalCwd = process.cwd()
  tmpDir = await mkdtemp(path.join(os.tmpdir(), 'airig-add-test-'))
  process.chdir(tmpDir)
  vi.resetAllMocks()
  vi.spyOn(console, 'log').mockImplementation(() => {})
})

afterEach(async () => {
  vi.restoreAllMocks()
  process.chdir(originalCwd)
  await rm(tmpDir, { recursive: true, force: true })
})

async function makeFile(filePath: string, content = 'test') {
  await mkdir(path.dirname(filePath), { recursive: true })
  await writeFile(filePath, content)
}

async function makeReleaseZip(): Promise<Buffer> {
  const aiDir = path.join(tmpDir, 'release', '.ai')
  await makeFile(path.join(aiDir, 'skills', 'tdd', 'SKILL.md'), '# TDD')
  await makeFile(path.join(aiDir, 'skills', 'unused', 'SKILL.md'), '# Unused')
  await makeFile(path.join(aiDir, '.claude', 'agents', 'reviewer.md'), '# Reviewer')
  await makeFile(path.join(aiDir, '.codex', 'commands', 'later.md'), '# Later')
  await makeFile(path.join(aiDir, 'AGENTS.md'), '# Shared instructions')
  await symlink('AGENTS.md', path.join(aiDir, 'CLAUDE.md'))

  const zipPath = path.join(tmpDir, 'ai.zip')
  await create(aiDir, zipPath)
  return readFile(zipPath)
}

describe('runAdd', () => {
  it('selects remote release files before writing only active artifacts', async () => {
    const zipBuffer = await makeReleaseZip()
    vi.mocked(fetchReleaseInfo).mockResolvedValue({
      tag: 'v1.2.3',
      assetDownloadUrl: 'https://example.test/ai.zip',
      immutable: true,
    })
    vi.mocked(downloadAsset).mockResolvedValue(zipBuffer)

    const promptMessages: string[] = []
    vi.mocked(checkbox).mockImplementation(async prompt => {
      const message = (prompt as { message: string }).message
      promptMessages.push(message)

      if (message === 'Select providers to add:') {
        expect(existsSync('.ai')).toBe(false)
        return ['claude']
      }

      if (message === 'Select files to add:') {
        return ['skills/tdd']
      }

      throw new Error(`Unexpected prompt: ${message}`)
    })

    await runAdd('owner/repo')

    expect(fetchReleaseInfo).toHaveBeenCalledWith('owner', 'repo', undefined, expect.any(Object))
    expect(downloadAsset).toHaveBeenCalledWith('https://example.test/ai.zip')
    expect(promptMessages).toEqual(['Select providers to add:', 'Select files to add:'])

    expect(existsSync('.ai/skills/tdd/SKILL.md')).toBe(true)
    expect(existsSync('.ai/skills/unused/SKILL.md')).toBe(false)
    expect(existsSync('.ai/.claude/agents/reviewer.md')).toBe(false)
    expect(existsSync('.ai/.codex/commands/later.md')).toBe(false)
    expect(existsSync('.ai/AGENTS.md')).toBe(false)

    expect(existsSync('.agents/skills/tdd')).toBe(true)
    expect(existsSync('.agents/skills/unused')).toBe(false)

    const aiJson = await readAiJson()
    expect(aiJson.packages['owner/repo']).toEqual({
      version: 'v1.2.3',
      linked: ['skills/tdd'],
    })
  })

  it('preserves setup symlink dependencies for selected artifacts', async () => {
    const zipBuffer = await makeReleaseZip()
    vi.mocked(fetchReleaseInfo).mockResolvedValue({
      tag: 'v1.2.3',
      assetDownloadUrl: 'https://example.test/ai.zip',
      immutable: true,
    })
    vi.mocked(downloadAsset).mockResolvedValue(zipBuffer)

    vi.mocked(checkbox).mockImplementation(async prompt => {
      const message = (prompt as { message: string }).message
      if (message === 'Select providers to add:') return ['claude']
      if (message === 'Select files to add:') return ['CLAUDE.md']
      throw new Error(`Unexpected prompt: ${message}`)
    })

    await runAdd('owner/repo')

    const claudeStats = await lstat('.ai/CLAUDE.md')
    expect(claudeStats.isSymbolicLink()).toBe(true)
    expect(await readlink('.ai/CLAUDE.md')).toBe('AGENTS.md')
    expect(existsSync('.ai/AGENTS.md')).toBe(true)
    expect((await lstat('CLAUDE.md')).isSymbolicLink()).toBe(true)
  })

  it('uses add to select more files from the currently pinned installed version', async () => {
    await makeFile('.ai/skills/tdd/SKILL.md', '# TDD')
    await writeAiJson({
      packages: {
        'owner/repo': { version: 'v1.2.3', linked: ['skills/tdd'] },
      },
    })
    const zipBuffer = await makeReleaseZip()
    vi.mocked(fetchReleaseInfo).mockResolvedValue({
      tag: 'v1.2.3',
      assetDownloadUrl: 'https://example.test/ai.zip',
      immutable: true,
    })
    vi.mocked(downloadAsset).mockResolvedValue(zipBuffer)

    vi.mocked(checkbox).mockImplementation(async prompt => {
      const message = (prompt as { message: string }).message
      if (message === 'Select providers to add:') return ['claude']
      if (message === 'Select files to add:') return ['skills/unused']
      throw new Error(`Unexpected prompt: ${message}`)
    })

    await runAdd('owner/repo')

    expect(fetchReleaseInfo).toHaveBeenCalledWith('owner', 'repo', 'v1.2.3', expect.any(Object))
    expect(existsSync('.ai/skills/tdd/SKILL.md')).toBe(true)
    expect(existsSync('.ai/skills/unused/SKILL.md')).toBe(true)
    const aiJson = await readAiJson()
    expect(aiJson.packages['owner/repo']).toEqual({
      version: 'v1.2.3',
      linked: ['skills/tdd', 'skills/unused'],
    })
  })

  it('reports target conflicts before writing selected release files into .ai', async () => {
    const zipBuffer = await makeReleaseZip()
    vi.mocked(fetchReleaseInfo).mockResolvedValue({
      tag: 'v1.2.3',
      assetDownloadUrl: 'https://example.test/ai.zip',
      immutable: true,
    })
    vi.mocked(downloadAsset).mockResolvedValue(zipBuffer)
    await makeFile('.agents/skills/tdd', 'real file')

    vi.mocked(checkbox).mockImplementation(async prompt => {
      const message = (prompt as { message: string }).message
      if (message === 'Select providers to add:') return ['claude']
      if (message === 'Select files to add:') return ['skills/tdd']
      throw new Error(`Unexpected prompt: ${message}`)
    })

    await expect(runAdd('owner/repo')).rejects.toThrow('target paths are already occupied')

    expect(existsSync('.ai/skills/tdd/SKILL.md')).toBe(false)
    const aiJson = await readAiJson()
    expect(aiJson.packages['owner/repo']).toBeUndefined()
  })

  it('reports symlink dependency source conflicts before writing selected release files', async () => {
    const zipBuffer = await makeReleaseZip()
    vi.mocked(fetchReleaseInfo).mockResolvedValue({
      tag: 'v1.2.3',
      assetDownloadUrl: 'https://example.test/ai.zip',
      immutable: true,
    })
    vi.mocked(downloadAsset).mockResolvedValue(zipBuffer)
    await makeFile('.ai/AGENTS.md', '# existing')

    vi.mocked(checkbox).mockImplementation(async prompt => {
      const message = (prompt as { message: string }).message
      if (message === 'Select providers to add:') return ['claude']
      if (message === 'Select files to add:') return ['CLAUDE.md']
      throw new Error(`Unexpected prompt: ${message}`)
    })

    await expect(runAdd('owner/repo')).rejects.toThrow('would overwrite existing .ai source files')

    expect(await readFile('.ai/AGENTS.md', 'utf-8')).toBe('# existing')
    expect(existsSync('.ai/CLAUDE.md')).toBe(false)
    const aiJson = await readAiJson()
    expect(aiJson.packages['owner/repo']).toBeUndefined()
  })

  it('errors before downloading when an installed package is added at a different version', async () => {
    await writeAiJson({
      packages: {
        'owner/repo': { version: 'v1.2.3', linked: [] },
      },
    })

    await expect(runAdd('owner/repo@v2.0.0')).rejects.toThrow(
      'Use airig update <owner/repo>@<version> to move versions.',
    )

    expect(fetchReleaseInfo).not.toHaveBeenCalled()
    expect(downloadAsset).not.toHaveBeenCalled()
    expect(checkbox).not.toHaveBeenCalled()
  })

  it('verifies immutable release state before writing downloaded content', async () => {
    vi.mocked(fetchReleaseInfo).mockResolvedValue({
      tag: 'v1.2.3',
      assetDownloadUrl: 'https://example.test/ai.zip',
      immutable: false,
    })

    await expect(runAdd('owner/repo@v1.2.3')).rejects.toThrow(
      'release v1.2.3 of owner/repo is not immutable',
    )

    expect(downloadAsset).not.toHaveBeenCalled()
    expect(existsSync('.ai')).toBe(false)
  })
})
