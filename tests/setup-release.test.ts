import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { create } from '../src/lib/zip'
import { withExtractedReleaseAi } from '../src/lib/setup-release'

let tmpDir: string

beforeEach(async () => {
  tmpDir = await mkdtemp(path.join(os.tmpdir(), 'airig-setup-release-test-'))
})

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true })
})

async function makeSkill(aiDir: string, relPath: string) {
  const dir = path.join(aiDir, 'skills', relPath)
  await mkdir(dir, { recursive: true })
  await writeFile(path.join(dir, 'SKILL.md'), `# ${relPath}`)
}

async function zipOf(aiDir: string): Promise<Buffer> {
  const zipPath = path.join(tmpDir, 'ai.zip')
  await create(aiDir, zipPath)
  return readFile(zipPath)
}

describe('withExtractedReleaseAi skill flattening', () => {
  it('flattens a catalog layout to a clean flat skills dir with no nested residue', async () => {
    const aiDir = path.join(tmpDir, 'release', '.ai')
    // A catalog category whose leaf name collides with the category name — the
    // case the old in-place flatten merged into and left nested residue.
    await makeSkill(aiDir, 'coding/clean-code')
    await makeSkill(aiDir, 'coding/coding')
    await makeSkill(aiDir, 'coding/comment-code')
    await makeSkill(aiDir, 'tdd')

    const buffer = await zipOf(aiDir)
    const names = await withExtractedReleaseAi(buffer, 'airig-flatten-test-', async extractedAiDir => {
      const skillsDir = path.join(extractedAiDir, 'skills')
      const entries = await readdir(skillsDir, { withFileTypes: true })
      // No residual category directory survives.
      expect(existsSync(path.join(skillsDir, 'coding', 'clean-code'))).toBe(false)
      // Every top-level entry is a real skill (has SKILL.md).
      for (const entry of entries) {
        expect(existsSync(path.join(skillsDir, entry.name, 'SKILL.md'))).toBe(true)
      }
      return entries.map(e => e.name).sort()
    })

    expect(names).toEqual(['clean-code', 'coding', 'comment-code', 'tdd'])
  })
})
