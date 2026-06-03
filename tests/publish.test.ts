import { describe, it, expect } from 'vitest'
import { parseRemoteUrl } from '../src/commands/publish.js'

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
