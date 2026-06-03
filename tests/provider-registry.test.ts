import { describe, it, expect } from 'vitest'
import { PROVIDER_REGISTRY, rulesFor } from '../src/lib/provider-registry.js'

describe('PROVIDER_REGISTRY', () => {
  it('has claude and codex providers', () => {
    expect(Object.keys(PROVIDER_REGISTRY)).toEqual(['claude', 'codex'])
  })

  it('claude has agents and commands rules', () => {
    const { rules } = PROVIDER_REGISTRY.claude
    expect(rules).toHaveLength(2)
    expect(rules[0].source).toBe('.ai/.claude/agents')
    expect(rules[0].target).toBe('.claude/agents')
    expect(rules[1].source).toBe('.ai/.claude/commands')
    expect(rules[1].target).toBe('.claude/commands')
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
    expect(rules).toHaveLength(3) // 2 claude rules + skills
    expect(rules[0].source).toBe('.ai/.claude/agents')
    expect(rules[rules.length - 1].source).toBe('.ai/skills')
  })

  it('includes all provider rules when all providers are given', () => {
    const rules = rulesFor(Object.keys(PROVIDER_REGISTRY))
    // claude(2) + codex(2) + skills(1)
    expect(rules).toHaveLength(5)
  })
})
