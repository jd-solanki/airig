import { describe, it, expect } from 'vitest'
import { parseSkillsRef } from '../src/lib/package-ref'

describe('parseSkillsRef', () => {
  it('parses a bare owner/repo shorthand', () => {
    expect(parseSkillsRef('owner/repo')).toEqual({
      owner: 'owner', repo: 'repo', ref: undefined, skillPath: undefined,
    })
  })

  it('parses a ref via @', () => {
    expect(parseSkillsRef('owner/repo@main')).toEqual({
      owner: 'owner', repo: 'repo', ref: 'main', skillPath: undefined,
    })
  })

  it('parses a direct skill path', () => {
    expect(parseSkillsRef('owner/repo/coding/clean-code')).toEqual({
      owner: 'owner', repo: 'repo', ref: undefined, skillPath: 'coding/clean-code',
    })
  })

  it('parses a direct skill path with a ref', () => {
    expect(parseSkillsRef('owner/repo/tdd@v2')).toEqual({
      owner: 'owner', repo: 'repo', ref: 'v2', skillPath: 'tdd',
    })
  })

  it('parses a full https GitHub URL', () => {
    expect(parseSkillsRef('https://github.com/anthropics/skills')).toEqual({
      owner: 'anthropics', repo: 'skills', ref: undefined, skillPath: undefined,
    })
  })

  it('strips a .git suffix and a trailing slash from a URL', () => {
    expect(parseSkillsRef('https://github.com/anthropics/skills.git/')).toEqual({
      owner: 'anthropics', repo: 'skills', ref: undefined, skillPath: undefined,
    })
  })

  it('reads the ref from a /tree/<ref> URL', () => {
    expect(parseSkillsRef('https://github.com/anthropics/skills/tree/next')).toEqual({
      owner: 'anthropics', repo: 'skills', ref: 'next', skillPath: undefined,
    })
  })

  it('reads a single-skill subpath from a /tree/<ref>/<path> URL', () => {
    expect(parseSkillsRef('https://github.com/anthropics/skills/tree/main/skills/tdd')).toEqual({
      owner: 'anthropics', repo: 'skills', ref: 'main', skillPath: 'skills/tdd',
    })
  })

  it('accepts a github.com URL without a protocol and an explicit @ref', () => {
    expect(parseSkillsRef('github.com/anthropics/skills@abc123')).toEqual({
      owner: 'anthropics', repo: 'skills', ref: 'abc123', skillPath: undefined,
    })
  })

  it('rejects a reference without a repo', () => {
    expect(() => parseSkillsRef('owner')).toThrow()
    expect(() => parseSkillsRef('https://github.com/owner')).toThrow()
  })
})
