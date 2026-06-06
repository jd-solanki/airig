import { vi, beforeEach, afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile, lstat } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'

vi.mock('../src/lib/github.js', () => ({
  fetchReleaseInfo: vi.fn(),
  downloadAsset: vi.fn(),
}))

import { runUpdate } from '../src/commands/update.js'
import { readAiJson, writeAiJson, type AiJson } from '../src/lib/ai-json.js'
import { create } from '../src/lib/zip.js'
import { fetchReleaseInfo, downloadAsset } from '../src/lib/github.js'

let tmpDir: string
let originalCwd: string

beforeEach(async () => {
  originalCwd = process.cwd()
  tmpDir = await mkdtemp(path.join(os.tmpdir(), 'ohmyai-update-test-'))
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

async function makeSymlink(sourcePath: string, linkPath: string) {
  await mkdir(path.dirname(linkPath), { recursive: true })
  await symlink(path.resolve(sourcePath), linkPath)
}

async function seedAiJson(data: AiJson) {
  await writeAiJson(data)
}

async function makeReleaseZip(files: Record<string, string>): Promise<Buffer> {
  const aiDir = path.join(tmpDir, `release-${randomUUID()}`, '.ai')
  for (const [filePath, content] of Object.entries(files)) {
    await makeFile(path.join(aiDir, filePath), content)
  }

  const zipPath = path.join(tmpDir, `${randomUUID()}.zip`)
  await create(aiDir, zipPath)
  return readFile(zipPath)
}

describe('runUpdate', () => {
  it('requires an explicit owner/repo@version reference', async () => {
    await seedAiJson({
      packages: {
        'owner/repo': { version: 'v1.0.0', linked: [] },
      },
    })

    await expect(runUpdate('owner/repo')).rejects.toThrow('Expected exact version')

    expect(fetchReleaseInfo).not.toHaveBeenCalled()
    expect(downloadAsset).not.toHaveBeenCalled()
  })

  it('verifies immutable release state before writing downloaded content', async () => {
    await makeFile('.ai/skills/tdd/SKILL.md', '# old')
    await seedAiJson({
      packages: {
        'owner/repo': { version: 'v1.0.0', linked: ['skills/tdd'] },
      },
    })
    vi.mocked(fetchReleaseInfo).mockResolvedValue({
      tag: 'v2.0.0',
      assetDownloadUrl: 'https://example.test/ai.zip',
      immutable: false,
    })

    await expect(runUpdate('owner/repo@v2.0.0')).rejects.toThrow('is not immutable')

    expect(downloadAsset).not.toHaveBeenCalled()
    expect(await readFile('.ai/skills/tdd/SKILL.md', 'utf-8')).toBe('# old')
  })

  it('updates release content, preserves linked artifacts, prunes deleted linked artifacts, and leaves new artifacts unlinked', async () => {
    await makeFile('.ai/skills/tdd/SKILL.md', '# old tdd')
    await makeFile('.ai/skills/removed/SKILL.md', '# removed')
    await makeSymlink('.ai/skills/removed', '.agents/skills/removed')
    await seedAiJson({
      packages: {
        'owner/repo': { version: 'v1.0.0', linked: ['skills/tdd', 'skills/removed'] },
      },
    })
    const zipBuffer = await makeReleaseZip({
      'skills/tdd/SKILL.md': '# new tdd',
      'skills/new/SKILL.md': '# new upstream',
    })
    vi.mocked(fetchReleaseInfo).mockResolvedValue({
      tag: 'v2.0.0',
      assetDownloadUrl: 'https://example.test/ai.zip',
      immutable: true,
    })
    vi.mocked(downloadAsset).mockResolvedValue(zipBuffer)

    await runUpdate('owner/repo@v2.0.0')

    expect(fetchReleaseInfo).toHaveBeenCalledWith('owner', 'repo', 'v2.0.0', expect.any(Object))
    expect(downloadAsset).toHaveBeenCalledWith('https://example.test/ai.zip')
    expect(await readFile('.ai/skills/tdd/SKILL.md', 'utf-8')).toBe('# new tdd')
    expect(existsSync('.ai/skills/new/SKILL.md')).toBe(true)
    expect(existsSync('.ai/skills/removed')).toBe(false)
    expect((await lstat('.agents/skills/tdd')).isSymbolicLink()).toBe(true)
    expect(existsSync('.agents/skills/removed')).toBe(false)

    const aiJson = await readAiJson()
    expect(aiJson.packages['owner/repo']).toEqual({
      version: 'v2.0.0',
      linked: ['skills/tdd'],
    })
  })

  it('errors when the package is not installed', async () => {
    await seedAiJson({ packages: {} })

    await expect(runUpdate('owner/repo@v2.0.0')).rejects.toThrow('is not installed')

    expect(fetchReleaseInfo).not.toHaveBeenCalled()
    expect(downloadAsset).not.toHaveBeenCalled()
  })
})
