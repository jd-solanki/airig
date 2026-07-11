import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { resolveSkills, resolveSkillsRepo } from '../src/lib/skill-resolver'

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

describe('resolveSkillsRepo', () => {
  it('returns an empty list for a repo with no discoverable skills', async () => {
    await expect(resolveSkillsRepo(tmpDir, 'repo')).resolves.toEqual([])
  })

  it('treats a repo-root SKILL.md as a single skill named after the repo', async () => {
    await writeFile(path.join(tmpDir, 'SKILL.md'), '# root skill')

    await expect(resolveSkillsRepo(tmpDir, 'my-skill')).resolves.toEqual([
      { name: 'my-skill', sourceRelPath: '.' },
    ])
  })

  it('discovers flat and catalog skills under skills/', async () => {
    await makeSkill('skills/tdd')
    await makeSkill('skills/coding/clean-code')

    await expect(resolveSkillsRepo(tmpDir, 'repo')).resolves.toEqual([
      { name: 'clean-code', sourceRelPath: 'skills/coding/clean-code', group: 'coding' },
      { name: 'tdd', sourceRelPath: 'skills/tdd' },
    ])
  })

  it('scans the .curated/.experimental/.system buckets as transparent containers', async () => {
    await makeSkill('skills/.curated/diagnose')
    await makeSkill('skills/.experimental/wip')
    await makeSkill('skills/.system/internal')

    // Sorted by sourceRelPath: .curated < .experimental < .system.
    await expect(resolveSkillsRepo(tmpDir, 'repo')).resolves.toEqual([
      { name: 'diagnose', sourceRelPath: 'skills/.curated/diagnose' },
      { name: 'wip', sourceRelPath: 'skills/.experimental/wip' },
      { name: 'internal', sourceRelPath: 'skills/.system/internal' },
    ])
  })

  it('does not double-count bucket skills as categories of skills/', async () => {
    await makeSkill('skills/.curated/diagnose')

    const resolved = await resolveSkillsRepo(tmpDir, 'repo')
    // The skill surfaces once, from the .curated container — never also as a
    // `.curated`-grouped catalog skill of the plain skills/ scan.
    expect(resolved).toEqual([
      { name: 'diagnose', sourceRelPath: 'skills/.curated/diagnose' },
    ])
  })

  it('discovers agent-specific skill containers', async () => {
    await makeSkill('.agents/skills/from-agents')
    await makeSkill('.aider-desk/skills/from-aider')

    await expect(resolveSkillsRepo(tmpDir, 'repo')).resolves.toEqual([
      { name: 'from-agents', sourceRelPath: '.agents/skills/from-agents' },
      { name: 'from-aider', sourceRelPath: '.aider-desk/skills/from-aider' },
    ])
  })

  it('errors on a leaf-name collision across containers', async () => {
    await makeSkill('skills/shared')
    await makeSkill('.agents/skills/shared')

    await expect(resolveSkillsRepo(tmpDir, 'repo')).rejects.toThrow(/collision.*shared/s)
  })
})
