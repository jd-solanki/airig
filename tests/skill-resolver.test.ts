import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { resolveSkills } from '../src/lib/skill-resolver'

let tmpDir: string

beforeEach(async () => {
  tmpDir = await mkdtemp(path.join(os.tmpdir(), 'airig-skill-resolver-test-'))
})

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true })
})

async function makeSkill(relPath: string) {
  const dir = path.join(tmpDir, relPath)
  await mkdir(dir, { recursive: true })
  await writeFile(path.join(dir, 'SKILL.md'), '# skill')
}

describe('resolveSkills', () => {
  it('returns an empty list for a missing container', async () => {
    await expect(resolveSkills(path.join(tmpDir, 'nope'))).resolves.toEqual([])
  })

  it('resolves a flat skill with no group', async () => {
    await makeSkill('tdd')

    await expect(resolveSkills(tmpDir)).resolves.toEqual([
      { name: 'tdd', sourceRelPath: 'tdd' },
    ])
  })

  it('flattens a catalog layout to the leaf name and records the category as group', async () => {
    await makeSkill('coding/clean-code')
    await makeSkill('coding/comment-code')

    await expect(resolveSkills(tmpDir)).resolves.toEqual([
      { name: 'clean-code', sourceRelPath: 'coding/clean-code', group: 'coding' },
      { name: 'comment-code', sourceRelPath: 'coding/comment-code', group: 'coding' },
    ])
  })

  it('does not descend into a skill directory that has nested folders', async () => {
    await makeSkill('tdd')
    await mkdir(path.join(tmpDir, 'tdd', 'references'), { recursive: true })
    await writeFile(path.join(tmpDir, 'tdd', 'references', 'x.md'), 'ref')

    const resolved = await resolveSkills(tmpDir)
    expect(resolved).toEqual([{ name: 'tdd', sourceRelPath: 'tdd' }])
  })

  it('handles a leaf whose name equals its category', async () => {
    await makeSkill('coding/coding')
    await makeSkill('coding/clean-code')

    await expect(resolveSkills(tmpDir)).resolves.toEqual([
      { name: 'clean-code', sourceRelPath: 'coding/clean-code', group: 'coding' },
      { name: 'coding', sourceRelPath: 'coding/coding', group: 'coding' },
    ])
  })

  it('mixes flat and catalog skills', async () => {
    await makeSkill('tdd')
    await makeSkill('python/fastapi')

    await expect(resolveSkills(tmpDir)).resolves.toEqual([
      { name: 'fastapi', sourceRelPath: 'python/fastapi', group: 'python' },
      { name: 'tdd', sourceRelPath: 'tdd' },
    ])
  })

  it('throws on a leaf-name collision across categories', async () => {
    await makeSkill('python/utils')
    await makeSkill('js/utils')

    await expect(resolveSkills(tmpDir)).rejects.toThrow(/collision.*utils/s)
  })
})
