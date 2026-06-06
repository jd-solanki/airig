import { describe, it, expect } from 'vitest'
import { mkdtemp, mkdir, writeFile, rm, symlink, lstat, readlink } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import extractZip from 'extract-zip'
import { createPublishZip, parseRemoteUrl } from '../src/commands/publish.js'

describe('parseRemoteUrl', () => {
  it('parses standard HTTPS remote', () => {
    expect(parseRemoteUrl('https://github.com/owner/repo.git')).toEqual({ owner: 'owner', repo: 'repo' })
  })

  it('parses standard SSH remote', () => {
    expect(parseRemoteUrl('git@github.com:owner/repo.git')).toEqual({ owner: 'owner', repo: 'repo' })
  })

  it('parses SSH remote with custom host alias', () => {
    expect(parseRemoteUrl('git@github-personal:jd-solanki/skills.git')).toEqual({ owner: 'jd-solanki', repo: 'skills' })
  })

  it('parses HTTPS remote without .git suffix', () => {
    expect(parseRemoteUrl('https://github.com/owner/repo')).toEqual({ owner: 'owner', repo: 'repo' })
  })

  it('parses SSH remote without .git suffix', () => {
    expect(parseRemoteUrl('git@github.com:owner/repo')).toEqual({ owner: 'owner', repo: 'repo' })
  })

  it('returns null for an unrecognisable remote', () => {
    expect(parseRemoteUrl('not-a-git-remote')).toBeNull()
  })
})

describe('createPublishZip', () => {
  it('packages only project setup artifacts for release', async () => {
    const originalCwd = process.cwd()
    const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'ohmyai-publish-test-'))

    try {
      process.chdir(tmpDir)
      await mkdir(path.join('.ai', 'skills'), { recursive: true })
      await mkdir('.ai.global', { recursive: true })
      await writeFile(path.join('.ai', 'ai.json'), '{}')
      await writeFile(path.join('.ai', 'AGENTS.md'), '# Shared')
      await symlink('AGENTS.md', path.join('.ai', 'CLAUDE.md'))
      await writeFile(path.join('.ai', 'skills', 'tdd.md'), '# TDD')
      await writeFile(path.join('.ai.global', 'global.md'), '# global')

      const zipPath = path.join(tmpDir, 'ai.zip')
      await createPublishZip(zipPath)

      const extractDir = path.join(tmpDir, 'extracted')
      await mkdir(extractDir, { recursive: true })
      await extractZip(zipPath, { dir: extractDir })

      expect(existsSync(path.join(extractDir, '.ai', 'ai.json'))).toBe(false)
      expect(existsSync(path.join(extractDir, '.ai.global', 'global.md'))).toBe(false)
      expect(existsSync(path.join(extractDir, '.ai', 'AGENTS.md'))).toBe(true)
      expect(existsSync(path.join(extractDir, '.ai', 'skills', 'tdd.md'))).toBe(true)

      const claudePath = path.join(extractDir, '.ai', 'CLAUDE.md')
      const stats = await lstat(claudePath)
      expect(stats.isSymbolicLink()).toBe(true)
      expect(await readlink(claudePath)).toBe('AGENTS.md')
    } finally {
      process.chdir(originalCwd)
      await rm(tmpDir, { recursive: true, force: true })
    }
  })
})
