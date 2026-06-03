import { describe, it, expect } from 'vitest'
import { PROVIDER_REGISTRY, SKILLS_RULE } from '../src/lib/provider-registry.js'

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

describe('SKILLS_RULE', () => {
  it('maps .ai/skills to .agents/skills', () => {
    expect(SKILLS_RULE.source).toBe('.ai/skills')
    expect(SKILLS_RULE.target).toBe('.agents/skills')
  })
})
