import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {
  listArtifacts,
  PROVIDER_REGISTRY,
  rulesFor,
  targetPathsForArtifact,
} from '../src/lib/provider-registry.js'

let tmpDir: string
let originalCwd: string

beforeEach(async () => {
  originalCwd = process.cwd()
  tmpDir = await mkdtemp(path.join(os.tmpdir(), 'ohmyai-provider-registry-test-'))
  process.chdir(tmpDir)
})

afterEach(async () => {
  process.chdir(originalCwd)
  await rm(tmpDir, { recursive: true, force: true })
})

async function makeFile(filePath: string, content = 'test') {
  await mkdir(path.dirname(filePath), { recursive: true })
  await writeFile(filePath, content)
}

describe('PROVIDER_REGISTRY', () => {
  it('has claude and codex providers', () => {
    expect(Object.keys(PROVIDER_REGISTRY)).toEqual(['claude', 'codex'])
  })

  it('claude has claude instructions, agents, and commands rules', () => {
    const { rules } = PROVIDER_REGISTRY.claude
    expect(rules).toEqual([
      { source: '.ai/CLAUDE.md', target: 'CLAUDE.md' },
      { source: '.ai/.claude/agents', target: '.claude/agents' },
      { source: '.ai/.claude/commands', target: '.claude/commands' },
    ])
  })

  it('codex declares AGENTS.md as a project instruction rule', () => {
    expect(PROVIDER_REGISTRY.codex.rules[0]).toEqual({
      source: '.ai/AGENTS.md',
      target: 'AGENTS.md',
    })
  })

  it('codex commands map to .codex/prompts', () => {
    const commandsRule = PROVIDER_REGISTRY.codex.rules.find(r => r.source.includes('commands'))
    expect(commandsRule?.target).toBe('.codex/prompts')
  })
})

describe('rulesFor', () => {
  it('always includes the skills rule regardless of providers', () => {
    const rules = rulesFor([])
    expect(rules).toHaveLength(1)
    expect(rules[0].source).toBe('.ai/skills')
    expect(rules[0].target).toBe('.agents/skills')
  })

  it('includes provider rules followed by the skills rule', () => {
    const rules = rulesFor(['claude'])
    expect(rules).toHaveLength(4) // 3 claude rules + skills
    expect(rules[0].source).toBe('.ai/CLAUDE.md')
    expect(rules[rules.length - 1].source).toBe('.ai/skills')
  })

  it('includes all provider rules when all providers are given', () => {
    const rules = rulesFor(Object.keys(PROVIDER_REGISTRY))
    // claude(3) + codex(3) + skills(1)
    expect(rules).toHaveLength(7)
  })
})

describe('targetPathsForArtifact', () => {
  it('maps project instruction files to root file targets', () => {
    expect(targetPathsForArtifact('AGENTS.md', ['codex'])).toEqual(['AGENTS.md'])
    expect(targetPathsForArtifact('CLAUDE.md', ['claude'])).toEqual(['CLAUDE.md'])
  })

  it('deduplicates concrete targets shared by selected providers', () => {
    expect(targetPathsForArtifact('AGENTS.md', ['codex', 'codex'])).toEqual(['AGENTS.md'])
  })

  it('continues mapping directory children into provider target directories', () => {
    expect(targetPathsForArtifact('.codex/commands/review.md', ['codex'])).toEqual([
      '.codex/prompts/review.md',
    ])
  })
})

describe('listArtifacts', () => {
  it('lists claude project instruction files as source artifact labels', async () => {
    await makeFile('.ai/AGENTS.md')
    await makeFile('.ai/CLAUDE.md')

    await expect(listArtifacts('.ai', ['claude'])).resolves.toEqual(['CLAUDE.md'])
  })

  it('lists a symlinked CLAUDE.md without materializing it', async () => {
    await makeFile('.ai/AGENTS.md')
    await symlink('AGENTS.md', '.ai/CLAUDE.md')

    await expect(listArtifacts('.ai', ['claude'])).resolves.toEqual(['CLAUDE.md'])
  })

  it('does not expose AGENTS.md through the claude provider', async () => {
    await makeFile('.ai/AGENTS.md')

    await expect(listArtifacts('.ai', ['claude'])).resolves.toEqual([])
  })

  it('lists codex project instruction files as source artifact labels', async () => {
    await makeFile('.ai/AGENTS.md')

    await expect(listArtifacts('.ai', ['codex'])).resolves.toEqual(['AGENTS.md'])
  })

  it('lists both provider-specific project instruction files when both providers are selected', async () => {
    await makeFile('.ai/AGENTS.md')
    await makeFile('.ai/CLAUDE.md')

    await expect(listArtifacts('.ai', ['claude', 'codex'])).resolves.toEqual([
      'CLAUDE.md',
      'AGENTS.md',
    ])
  })
})
