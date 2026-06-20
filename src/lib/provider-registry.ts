import { lstat, readdir } from 'node:fs/promises'
import { join, relative } from 'node:path'

export interface SymlinkRule {
  source: string
  target: string
}

export interface ProviderEntry {
  name: string
  rules: SymlinkRule[]
}

const AGENTS_INSTRUCTION_RULE: SymlinkRule = { source: '.ai/AGENTS.md', target: 'AGENTS.md' }
const GENERIC_SKILLS_RULE: SymlinkRule = { source: '.ai/skills', target: '.agents/skills' }
const GENERIC_AGENT_RULES: SymlinkRule[] = [
  AGENTS_INSTRUCTION_RULE,
  GENERIC_SKILLS_RULE,
]
const GENERIC_AGENT_PROVIDER_NAMES = [
  'pi',
  'opencode',
  'cursor',
  'copilot',
  'windsurf',
  'antigravity',
  'amp',
  'zed',
]
const GENERIC_AGENT_PROVIDER_ENTRIES = Object.fromEntries(
  GENERIC_AGENT_PROVIDER_NAMES.map(name => [name, { name, rules: GENERIC_AGENT_RULES }]),
)

export const PROVIDER_REGISTRY: Record<string, ProviderEntry> = {
  claude: {
    name: 'claude',
    rules: [
      { source: '.ai/CLAUDE.md', target: 'CLAUDE.md' },
      { source: '.ai/.claude/agents', target: '.claude/agents' },
      { source: '.ai/.claude/commands', target: '.claude/commands' },
      { source: '.ai/.claude/hooks', target: '.claude/hooks' },
      { source: '.ai/skills', target: '.claude/skills' },
    ],
  },
  codex: {
    name: 'codex',
    rules: [
      AGENTS_INSTRUCTION_RULE,
      { source: '.ai/.codex/agents', target: '.codex/agents' },
      { source: '.ai/.codex/commands', target: '.codex/prompts' },
      GENERIC_SKILLS_RULE,
    ],
  },
  ...GENERIC_AGENT_PROVIDER_ENTRIES,
  cline: {
    name: 'cline',
    rules: [
      AGENTS_INSTRUCTION_RULE,
      { source: '.ai/skills', target: '.cline/skills' },
    ],
  },
  kiro: {
    name: 'kiro',
    rules: [
      AGENTS_INSTRUCTION_RULE,
      { source: '.ai/skills', target: '.kiro/skills' },
    ],
  },
}

export function rulesFor(providers: string[]): SymlinkRule[] {
  return providers.flatMap(p => PROVIDER_REGISTRY[p].rules)
}

export function targetPathsForArtifact(
  artifact: string,
  providers = Object.keys(PROVIDER_REGISTRY),
): string[] {
  const targets = new Set<string>()

  for (const rule of rulesFor(providers)) {
    const relSource = rule.source.startsWith('.ai/') ? rule.source.slice('.ai/'.length) : rule.source
    if (artifact === relSource) {
      targets.add(rule.target)
    } else if (artifact.startsWith(relSource + '/')) {
      targets.add(join(rule.target, artifact.slice(relSource.length + 1)))
    }
  }

  return [...targets]
}

export function artifactForTarget(targetPath: string): string | undefined {
  for (const rule of rulesFor(Object.keys(PROVIDER_REGISTRY))) {
    const relSource = rule.source.startsWith('.ai/') ? rule.source.slice('.ai/'.length) : rule.source
    if (targetPath === rule.target) {
      return relSource
    }
    if (targetPath.startsWith(rule.target + '/')) {
      return relSource + '/' + relative(rule.target, targetPath)
    }
  }
  return undefined
}

export async function listArtifacts(rootDir: string, providers = Object.keys(PROVIDER_REGISTRY)): Promise<string[]> {
  const artifacts = new Set<string>()
  for (const rule of rulesFor(providers)) {
    const relSource = rule.source.startsWith('.ai/') ? rule.source.slice('.ai/'.length) : rule.source
    const sourcePath = join(rootDir, relSource)
    let sourceStat: Awaited<ReturnType<typeof lstat>>
    try {
      sourceStat = await lstat(sourcePath)
    } catch {
      continue
    }

    if (!sourceStat.isDirectory()) {
      artifacts.add(relSource)
      continue
    }

    const entries = await readdir(sourcePath)
    for (const e of entries) artifacts.add(`${relSource}/${e}`)
  }
  return [...artifacts]
}
