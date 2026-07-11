import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, mkdir, writeFile, readFile, readlink, symlink } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

vi.mock('@inquirer/prompts', async importActual => ({
  ...(await importActual<typeof import('@inquirer/prompts')>()),
  checkbox: vi.fn(),
}))
vi.mock('../src/lib/github', () => ({
  resolveCommitSha: vi.fn(),
  downloadRepoZipball: vi.fn(),
  fetchReleaseInfo: vi.fn(),
  downloadAsset: vi.fn(),
}))

import { checkbox } from '@inquirer/prompts'
import { runSkillsAdd, runSkillsUpdate, runSkillsRemove } from '../src/commands/skills'
import { runAdd } from '../src/commands/add'
import { runUpdate } from '../src/commands/update'
import { readAiJson, writeAiJson } from '../src/lib/ai-json'
import { create } from '../src/lib/zip'
import { resolveCommitSha, downloadRepoZipball } from '../src/lib/github'

const SHA_A = 'a'.repeat(40)
const SHA_B = 'b'.repeat(40)

let tmpDir: string
let originalCwd: string
let globalRoot: string

beforeEach(async () => {
  originalCwd = process.cwd()
  tmpDir = await mkdtemp(path.join(os.tmpdir(), 'airig-skills-test-'))
  globalRoot = path.join(tmpDir, 'home', '.ai')
  process.chdir(tmpDir)
  vi.resetAllMocks()
  vi.spyOn(os, 'homedir').mockReturnValue(path.join(tmpDir, 'home'))
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

/**
 * Build a GitHub-style repo zipball: a single top-level `<repo>-<sha>` directory
 * wrapping the given files, matching what `downloadZipballArchive` returns.
 */
async function makeRepoZip(topDirName: string, files: Record<string, string>): Promise<Buffer> {
  const root = path.join(tmpDir, 'repo-src', topDirName)
  for (const [rel, content] of Object.entries(files)) {
    await makeFile(path.join(root, rel), content)
  }
  const zipPath = path.join(tmpDir, `${topDirName}.zip`)
  await create(root, zipPath)
  return readFile(zipPath)
}

function answerPrompts(answers: Record<string, string[]>): void {
  vi.mocked(checkbox).mockImplementation(async prompt => {
    const message = (prompt as { message: string }).message
    if (message in answers) return answers[message]
    throw new Error(`Unexpected prompt: ${message}`)
  })
}

function globalAiJsonPath(): string {
  return path.join(globalRoot, 'ai.json')
}

describe('runSkillsAdd', () => {
  it('installs a selected skill flat and pins the commit SHA with a skills-repo source', async () => {
    const zip = await makeRepoZip('skills-abcdef', {
      'skills/tdd/SKILL.md': '# TDD',
      'skills/unused/SKILL.md': '# Unused',
    })
    vi.mocked(resolveCommitSha).mockResolvedValue(SHA_A)
    vi.mocked(downloadRepoZipball).mockResolvedValue(zip)
    answerPrompts({
      'Select providers to add:': ['claude'],
      'Select skills to add:': ['tdd'],
    })

    await runSkillsAdd('owner/skills')

    expect(resolveCommitSha).toHaveBeenCalledWith('owner', 'skills', undefined, expect.any(Object))
    expect(existsSync('.ai/skills/tdd/SKILL.md')).toBe(true)
    expect(existsSync('.ai/skills/unused/SKILL.md')).toBe(false)
    expect(existsSync('.claude/skills/tdd')).toBe(true)
    expect(await readlink('.claude/skills/tdd')).toBe('../../.ai/skills/tdd')

    const aiJson = await readAiJson()
    expect(aiJson.packages['owner/skills']).toEqual({
      source: 'skills-repo',
      version: SHA_A,
      linked: ['skills/tdd'],
    })
  })

  it('flattens a catalog skill and offers it under its source-category group', async () => {
    const zip = await makeRepoZip('skills-abcdef', {
      'skills/coding/clean-code/SKILL.md': '# Clean Code',
    })
    vi.mocked(resolveCommitSha).mockResolvedValue(SHA_A)
    vi.mocked(downloadRepoZipball).mockResolvedValue(zip)

    let skillChoices: unknown
    vi.mocked(checkbox).mockImplementation(async prompt => {
      const message = (prompt as { message: string }).message
      if (message === 'Select providers to add:') return ['claude']
      if (message === 'Select skills to add:') {
        skillChoices = (prompt as { choices: unknown }).choices
        return ['clean-code']
      }
      throw new Error(`Unexpected prompt: ${message}`)
    })

    await runSkillsAdd('owner/skills')

    // Grouped under a `coding` separator, but installed flat.
    expect(JSON.stringify(skillChoices)).toContain('coding')
    expect(existsSync('.ai/skills/clean-code/SKILL.md')).toBe(true)
    expect(existsSync('.claude/skills/clean-code')).toBe(true)
    const aiJson = await readAiJson()
    expect(aiJson.packages['owner/skills'].linked).toEqual(['skills/clean-code'])
  })

  it('installs a single skill by direct path without a skill prompt', async () => {
    const zip = await makeRepoZip('skills-abcdef', {
      'skills/tdd/SKILL.md': '# TDD',
      'skills/diagnose/SKILL.md': '# Diagnose',
    })
    vi.mocked(resolveCommitSha).mockResolvedValue(SHA_A)
    vi.mocked(downloadRepoZipball).mockResolvedValue(zip)
    answerPrompts({ 'Select providers to add:': ['claude'] })

    await runSkillsAdd('owner/skills/tdd')

    expect(existsSync('.ai/skills/tdd/SKILL.md')).toBe(true)
    expect(existsSync('.ai/skills/diagnose/SKILL.md')).toBe(false)
    const aiJson = await readAiJson()
    expect(aiJson.packages['owner/skills'].linked).toEqual(['skills/tdd'])
  })

  it('resolves a direct path that includes the source category', async () => {
    const zip = await makeRepoZip('skills-abcdef', {
      'skills/coding/clean-code/SKILL.md': '# Clean Code',
    })
    vi.mocked(resolveCommitSha).mockResolvedValue(SHA_A)
    vi.mocked(downloadRepoZipball).mockResolvedValue(zip)
    answerPrompts({ 'Select providers to add:': ['claude'] })

    await runSkillsAdd('owner/skills/coding/clean-code')

    expect(existsSync('.ai/skills/clean-code/SKILL.md')).toBe(true)
    const aiJson = await readAiJson()
    expect(aiJson.packages['owner/skills'].linked).toEqual(['skills/clean-code'])
  })

  it('errors when a direct-path skill does not exist', async () => {
    const zip = await makeRepoZip('skills-abcdef', { 'skills/tdd/SKILL.md': '# TDD' })
    vi.mocked(resolveCommitSha).mockResolvedValue(SHA_A)
    vi.mocked(downloadRepoZipball).mockResolvedValue(zip)
    answerPrompts({ 'Select providers to add:': ['claude'] })

    await expect(runSkillsAdd('owner/skills/missing')).rejects.toThrow('Skill "missing" was not found')
  })

  it('adds more skills to an installed repo without moving the pinned SHA', async () => {
    await makeFile('.ai/skills/tdd/SKILL.md', '# TDD')
    await writeAiJson({
      packages: {
        'owner/skills': { source: 'skills-repo', version: SHA_A, linked: ['skills/tdd'] },
      },
    })
    const zip = await makeRepoZip('skills-abcdef', {
      'skills/tdd/SKILL.md': '# TDD',
      'skills/diagnose/SKILL.md': '# Diagnose',
    })
    vi.mocked(downloadRepoZipball).mockResolvedValue(zip)
    answerPrompts({
      'Select providers to add:': ['claude'],
      'Select skills to add:': ['diagnose'],
    })

    await runSkillsAdd('owner/skills')

    // No ref passed on an installed repo → no re-resolution, stays on the pin.
    expect(resolveCommitSha).not.toHaveBeenCalled()
    expect(downloadRepoZipball).toHaveBeenCalledWith('owner', 'skills', SHA_A, expect.any(Object))
    const aiJson = await readAiJson()
    expect(aiJson.packages['owner/skills'].linked).toEqual(['skills/tdd', 'skills/diagnose'])
    expect(aiJson.packages['owner/skills'].version).toBe(SHA_A)
  })

  it('rejects adding at a ref that resolves to a different commit than the pin', async () => {
    await writeAiJson({
      packages: {
        'owner/skills': { source: 'skills-repo', version: SHA_A, linked: ['skills/tdd'] },
      },
    })
    vi.mocked(resolveCommitSha).mockResolvedValue(SHA_B)

    await expect(runSkillsAdd('owner/skills@main')).rejects.toThrow('already installed at')
    expect(downloadRepoZipball).not.toHaveBeenCalled()
  })

  it('installs from a full GitHub URL', async () => {
    const zip = await makeRepoZip('skills-abcdef', { 'skills/tdd/SKILL.md': '# TDD' })
    vi.mocked(resolveCommitSha).mockResolvedValue(SHA_A)
    vi.mocked(downloadRepoZipball).mockResolvedValue(zip)
    answerPrompts({
      'Select providers to add:': ['claude'],
      'Select skills to add:': ['tdd'],
    })

    await runSkillsAdd('https://github.com/anthropics/skills')

    expect(resolveCommitSha).toHaveBeenCalledWith('anthropics', 'skills', undefined, expect.any(Object))
    expect(existsSync('.ai/skills/tdd/SKILL.md')).toBe(true)
    const aiJson = await readAiJson()
    expect(aiJson.packages['anthropics/skills']).toEqual({
      source: 'skills-repo', version: SHA_A, linked: ['skills/tdd'],
    })
  })

  it('adds specific skills non-interactively via --skill', async () => {
    const zip = await makeRepoZip('skills-abcdef', {
      'skills/tdd/SKILL.md': '# TDD',
      'skills/diagnose/SKILL.md': '# Diagnose',
      'skills/unused/SKILL.md': '# Unused',
    })
    vi.mocked(resolveCommitSha).mockResolvedValue(SHA_A)
    vi.mocked(downloadRepoZipball).mockResolvedValue(zip)
    // Only the providers prompt should appear — never a skill-selection prompt.
    answerPrompts({ 'Select providers to add:': ['claude'] })

    await runSkillsAdd('owner/skills', { skill: ['tdd', 'diagnose'] })

    expect(existsSync('.ai/skills/tdd/SKILL.md')).toBe(true)
    expect(existsSync('.ai/skills/diagnose/SKILL.md')).toBe(true)
    expect(existsSync('.ai/skills/unused/SKILL.md')).toBe(false)
    const aiJson = await readAiJson()
    expect(aiJson.packages['owner/skills'].linked).toEqual(['skills/tdd', 'skills/diagnose'])
  })

  it('installs into the global setup root with --global', async () => {
    const zip = await makeRepoZip('skills-abcdef', { 'skills/tdd/SKILL.md': '# TDD' })
    vi.mocked(resolveCommitSha).mockResolvedValue(SHA_A)
    vi.mocked(downloadRepoZipball).mockResolvedValue(zip)
    answerPrompts({
      'Select providers to add:': ['claude'],
      'Select skills to add:': ['tdd'],
    })

    await runSkillsAdd('owner/skills', { global: true })

    expect(existsSync(path.join(globalRoot, 'skills/tdd/SKILL.md'))).toBe(true)
    expect(existsSync(path.join(globalRoot, '.claude/skills/tdd'))).toBe(true)
    expect(await readlink(path.join(globalRoot, '.claude/skills/tdd'))).toBe('../../skills/tdd')
    expect(existsSync('.ai')).toBe(false)

    const aiJson = await readAiJson(globalAiJsonPath())
    expect(aiJson.packages['owner/skills']).toEqual({
      source: 'skills-repo', version: SHA_A, linked: ['skills/tdd'],
    })
  })

  it('reports target conflicts before writing any skill sources', async () => {
    const zip = await makeRepoZip('skills-abcdef', { 'skills/tdd/SKILL.md': '# TDD' })
    vi.mocked(resolveCommitSha).mockResolvedValue(SHA_A)
    vi.mocked(downloadRepoZipball).mockResolvedValue(zip)
    await makeFile('.claude/skills/tdd', 'real file')
    answerPrompts({
      'Select providers to add:': ['claude'],
      'Select skills to add:': ['tdd'],
    })

    await expect(runSkillsAdd('owner/skills')).rejects.toThrow('target paths are already occupied')
    expect(existsSync('.ai/skills/tdd/SKILL.md')).toBe(false)
    expect((await readAiJson()).packages['owner/skills']).toBeUndefined()
  })
})

describe('runSkillsUpdate', () => {
  it('moves the pin to a new commit, refreshes survivors, and prunes deleted skills', async () => {
    await makeFile('.ai/skills/tdd/SKILL.md', '# TDD old')
    await makeFile('.ai/skills/gone/SKILL.md', '# Gone')
    await mkdir('.claude/skills', { recursive: true })
    await symlink('../../.ai/skills/tdd', '.claude/skills/tdd')
    await symlink('../../.ai/skills/gone', '.claude/skills/gone')
    await writeAiJson({
      packages: {
        'owner/skills': { source: 'skills-repo', version: SHA_A, linked: ['skills/tdd', 'skills/gone'] },
      },
    })
    const zip = await makeRepoZip('skills-bbbbbb', { 'skills/tdd/SKILL.md': '# TDD new' })
    vi.mocked(resolveCommitSha).mockResolvedValue(SHA_B)
    vi.mocked(downloadRepoZipball).mockResolvedValue(zip)

    await runSkillsUpdate('owner/skills')

    expect(resolveCommitSha).toHaveBeenCalledWith('owner', 'skills', undefined, expect.any(Object))
    expect(await readFile('.ai/skills/tdd/SKILL.md', 'utf-8')).toBe('# TDD new')
    expect(existsSync('.ai/skills/gone')).toBe(false)
    expect(existsSync('.claude/skills/gone')).toBe(false)
    expect(existsSync('.claude/skills/tdd')).toBe(true)
    const aiJson = await readAiJson()
    expect(aiJson.packages['owner/skills']).toEqual({
      source: 'skills-repo',
      version: SHA_B,
      linked: ['skills/tdd'],
    })
  })

  it('updates a globally installed skills repo', async () => {
    await makeFile(path.join(globalRoot, 'skills/tdd/SKILL.md'), '# TDD old')
    await mkdir(path.join(globalRoot, '.claude/skills'), { recursive: true })
    await symlink('../../skills/tdd', path.join(globalRoot, '.claude/skills/tdd'))
    await writeAiJson({
      packages: {
        'owner/skills': { source: 'skills-repo', version: SHA_A, linked: ['skills/tdd'] },
      },
    }, globalAiJsonPath())
    const zip = await makeRepoZip('skills-bbbbbb', { 'skills/tdd/SKILL.md': '# TDD new' })
    vi.mocked(resolveCommitSha).mockResolvedValue(SHA_B)
    vi.mocked(downloadRepoZipball).mockResolvedValue(zip)

    await runSkillsUpdate('owner/skills', { global: true })

    expect(await readFile(path.join(globalRoot, 'skills/tdd/SKILL.md'), 'utf-8')).toBe('# TDD new')
    expect(existsSync(path.join(globalRoot, '.claude/skills/tdd'))).toBe(true)
    const aiJson = await readAiJson(globalAiJsonPath())
    expect(aiJson.packages['owner/skills'].version).toBe(SHA_B)
  })
})

describe('runSkillsRemove', () => {
  it('interactively removes an installed skills-repo package', async () => {
    await makeFile('.ai/skills/tdd/SKILL.md', '# TDD')
    await mkdir('.claude/skills', { recursive: true })
    await symlink('../../.ai/skills/tdd', '.claude/skills/tdd')
    await writeAiJson({
      packages: {
        'owner/skills': { source: 'skills-repo', version: SHA_A, linked: ['skills/tdd'] },
      },
    })
    vi.mocked(checkbox).mockResolvedValue([{ packageKey: 'owner/skills', artifact: 'skills/tdd' }])

    await runSkillsRemove('owner/skills')

    expect(existsSync('.claude/skills/tdd')).toBe(false)
    expect(existsSync('.ai/skills/tdd')).toBe(false)
    expect((await readAiJson()).packages['owner/skills']).toBeUndefined()
  })
})

describe('source-kind mutual refusal', () => {
  it('skills add refuses a Setup Release entry', async () => {
    await writeAiJson({
      packages: { 'owner/setup': { version: 'v1.0.0', linked: ['skills/tdd'] } },
    })

    await expect(runSkillsAdd('owner/setup')).rejects.toThrow('is not a Skills Repo')
    expect(resolveCommitSha).not.toHaveBeenCalled()
  })

  it('core add refuses a Skills Repo entry', async () => {
    await writeAiJson({
      packages: { 'owner/skills': { source: 'skills-repo', version: SHA_A, linked: ['skills/tdd'] } },
    })

    await expect(runAdd('owner/skills')).rejects.toThrow('is a Skills Repo and cannot be managed')
  })

  it('core update refuses a Skills Repo entry', async () => {
    await writeAiJson({
      packages: { 'owner/skills': { source: 'skills-repo', version: SHA_A, linked: ['skills/tdd'] } },
    })

    await expect(runUpdate('owner/skills@v1.0.0')).rejects.toThrow('is a Skills Repo and cannot be managed')
  })
})
