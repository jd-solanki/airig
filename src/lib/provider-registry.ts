export interface SymlinkRule {
  source: string
  target: string
}

export interface ProviderEntry {
  name: string
  rules: SymlinkRule[]
}

export const PROVIDER_REGISTRY: Record<string, ProviderEntry> = {
  claude: {
    name: 'claude',
    rules: [
      { source: '.ai/.claude/agents', target: '.claude/agents' },
      { source: '.ai/.claude/commands', target: '.claude/commands' },
    ],
  },
  codex: {
    name: 'codex',
    rules: [
      { source: '.ai/.codex/agents', target: '.codex/agents' },
      { source: '.ai/.codex/commands', target: '.codex/prompts' },
    ],
  },
}

export const SKILLS_RULE: SymlinkRule = {
  source: '.ai/skills',
  target: '.agents/skills',
}
