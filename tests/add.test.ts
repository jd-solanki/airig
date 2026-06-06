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
  tmpDir = await mkdtemp(path.join(os.tmpdir(), 'ohmyai-add-test-'))
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
  it('downloads the full immutable release, creates an empty manifest entry, then invokes link', async () => {
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

      if (message === 'Select providers to link:') {
        const raw = JSON.parse(await readFile('.ai/ai.json', 'utf-8'))
        expect(raw.packages['owner/repo']).toEqual({ version: 'v1.2.3', linked: [] })
        return ['claude']
      }

      if (message === 'Select files to link:') {
        return ['skills/tdd']
      }

      throw new Error(`Unexpected prompt: ${message}`)
    })

    await runAdd('owner/repo')

    expect(fetchReleaseInfo).toHaveBeenCalledWith('owner', 'repo', undefined, expect.any(Object))
    expect(downloadAsset).toHaveBeenCalledWith('https://example.test/ai.zip')
    expect(promptMessages).toEqual(['Select providers to link:', 'Select files to link:'])

    expect(existsSync('.ai/skills/tdd/SKILL.md')).toBe(true)
    expect(existsSync('.ai/skills/unused/SKILL.md')).toBe(true)
    expect(existsSync('.ai/.claude/agents/reviewer.md')).toBe(true)
    expect(existsSync('.ai/.codex/commands/later.md')).toBe(true)
    expect(existsSync('.ai/AGENTS.md')).toBe(true)

    const claudeStats = await lstat('.ai/CLAUDE.md')
    expect(claudeStats.isSymbolicLink()).toBe(true)
    expect(await readlink('.ai/CLAUDE.md')).toBe('AGENTS.md')

    expect(existsSync('.agents/skills/tdd')).toBe(true)
    expect(existsSync('.agents/skills/unused')).toBe(false)

    const aiJson = await readAiJson()
    expect(aiJson.packages['owner/repo']).toEqual({
      version: 'v1.2.3',
      linked: ['skills/tdd'],
    })
  })

  it('errors before downloading when the release is already installed', async () => {
    await writeAiJson({
      packages: {
        'owner/repo': { version: 'v1.2.3', linked: [] },
      },
    })

    await expect(runAdd('owner/repo@v2.0.0')).rejects.toThrow(
      'Use ohmyai link to change active artifacts, ohmyai update to change versions, or ohmyai remove first.',
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
