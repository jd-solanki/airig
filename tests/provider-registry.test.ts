import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {
  listArtifacts,
  PROVIDER_REGISTRY,
  rulesFor,
  targetPathsForArtifact,
} from '../src/lib/provider-registry'

let tmpDir: string
let originalCwd: string

beforeEach(async () => {
  originalCwd = process.cwd()
  tmpDir = await mkdtemp(path.join(os.tmpdir(), 'airig-provider-registry-test-'))
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

const SUPPORTED_PROVIDERS = [
  'claude',
  'codex',
  'pi',
  'opencode',
  'cursor',
  'copilot',
  'windsurf',
  'antigravity',
  'amp',
  'zed',
  'cline',
  'kiro',
]

const GENERIC_AGENT_RULES = [
  { source: '.ai/AGENTS.md', target: 'AGENTS.md' },
  { source: '.ai/skills', target: '.agents/skills' },
]

describe('PROVIDER_REGISTRY', () => {
  it('has the supported providers', () => {
    expect(Object.keys(PROVIDER_REGISTRY)).toEqual(SUPPORTED_PROVIDERS)
  })

  it('claude has claude instructions, agents, commands, hooks, and skills rules', () => {
    const { rules } = PROVIDER_REGISTRY.claude
    expect(rules).toEqual([
      { source: '.ai/CLAUDE.md', target: 'CLAUDE.md' },
      { source: '.ai/.claude/agents', target: '.claude/agents' },
      { source: '.ai/.claude/commands', target: '.claude/commands' },
      { source: '.ai/.claude/hooks', target: '.claude/hooks' },
      { source: '.ai/skills', target: '.claude/skills' },
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

  it('uses generic instructions and skills for providers that support both', () => {
    for (const provider of [
      'pi',
      'opencode',
      'cursor',
      'copilot',
      'windsurf',
      'antigravity',
      'amp',
      'zed',
    ]) {
      expect(PROVIDER_REGISTRY[provider].rules).toEqual(GENERIC_AGENT_RULES)
    }
  })

  it('uses provider-specific skill targets only when generic skills are not supported', () => {
    expect(PROVIDER_REGISTRY.cline.rules).toEqual([
      { source: '.ai/AGENTS.md', target: 'AGENTS.md' },
      { source: '.ai/skills', target: '.cline/skills' },
    ])
    expect(PROVIDER_REGISTRY.kiro.rules).toEqual([
      { source: '.ai/AGENTS.md', target: 'AGENTS.md' },
      { source: '.ai/skills', target: '.kiro/skills' },
    ])
  })
})

describe('rulesFor', () => {
  it('returns no rules for an empty provider list', () => {
    expect(rulesFor([])).toHaveLength(0)
  })

  it('includes all claude rules including the claude skills rule', () => {
    const rules = rulesFor(['claude'])
    expect(rules).toHaveLength(5) // CLAUDE.md + agents + commands + hooks + skills
    expect(rules[0].source).toBe('.ai/CLAUDE.md')
    expect(rules[rules.length - 1]).toEqual({ source: '.ai/skills', target: '.claude/skills' })
  })

  it('includes all provider rules when all providers are given', () => {
    const rules = rulesFor(Object.keys(PROVIDER_REGISTRY))
    // claude(5) + codex(4) + generic providers(16) + cline(2) + kiro(2)
    expect(rules).toHaveLength(29)
  })
})

describe('targetPathsForArtifact', () => {
  it('maps project instruction files to root file targets', () => {
    expect(targetPathsForArtifact('AGENTS.md', ['codex'])).toEqual(['AGENTS.md'])
    expect(targetPathsForArtifact('CLAUDE.md', ['claude'])).toEqual(['CLAUDE.md'])
  })

  it('deduplicates concrete targets shared by selected providers', () => {
    expect(targetPathsForArtifact('AGENTS.md', ['codex', 'codex'])).toEqual(['AGENTS.md'])
    expect(targetPathsForArtifact('AGENTS.md', ['pi', 'amp', 'zed'])).toEqual(['AGENTS.md'])
    expect(targetPathsForArtifact('skills/tdd', ['codex', 'pi', 'amp'])).toEqual([
      '.agents/skills/tdd',
    ])
  })

  it('continues mapping directory children into provider target directories', () => {
    expect(targetPathsForArtifact('.codex/commands/review.md', ['codex'])).toEqual([
      '.codex/prompts/review.md',
    ])
    expect(targetPathsForArtifact('skills/tdd', ['cline', 'kiro'])).toEqual([
      '.cline/skills/tdd',
      '.kiro/skills/tdd',
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

  it('lists shared generic artifacts only once for generic providers', async () => {
    await makeFile('.ai/AGENTS.md')
    await makeFile('.ai/skills/tdd/SKILL.md')

    await expect(listArtifacts('.ai', ['pi', 'amp'])).resolves.toEqual([
      'AGENTS.md',
      'skills/tdd',
    ])
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
