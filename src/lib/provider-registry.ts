import { readdir } from 'node:fs/promises'
import { join, relative } from 'node:path'

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

const SKILLS_RULE: SymlinkRule = {
  source: '.ai/skills',
  target: '.agents/skills',
}

export function rulesFor(providers: string[]): SymlinkRule[] {
  return [...providers.flatMap(p => PROVIDER_REGISTRY[p].rules), SKILLS_RULE]
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
  const artifacts: string[] = []
  for (const rule of rulesFor(providers)) {
    const relSource = rule.source.startsWith('.ai/') ? rule.source.slice('.ai/'.length) : rule.source
    try {
      const entries = await readdir(join(rootDir, relSource))
      for (const e of entries) artifacts.push(`${relSource}/${e}`)
    } catch { /* dir absent */ }
  }
  return artifacts
}
