import { lstat, readdir } from 'node:fs/promises'
import { basename, join, relative } from 'node:path'
import { resolveSkills } from './skill-resolver'

export interface SymlinkRule {
  source: string
  target: string
  /**
   * When true, children of this directory source are exposed flat under the
   * target: a source child at any depth links to `<target>/<leaf-name>`, not
   * `<target>/<full-source-path>`. Used for skills, so a catalog layout
   * (`skills/<category>/<name>`) still lands at `<target>/<name>` where coding
   * agents can discover it. See the Skill Resolver.
   */
  flatten?: boolean
}

export interface ProviderEntry {
  name: string
  rules: SymlinkRule[]
}

const AGENTS_INSTRUCTION_RULE: SymlinkRule = { source: '.ai/AGENTS.md', target: 'AGENTS.md' }
const GENERIC_SKILLS_RULE: SymlinkRule = { source: '.ai/skills', target: '.agents/skills', flatten: true }
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
      { source: '.ai/skills', target: '.claude/skills', flatten: true },
    ],
  },
  codex: {
    name: 'codex',
    rules: [
      AGENTS_INSTRUCTION_RULE,
      GENERIC_SKILLS_RULE,
      { source: '.ai/.codex/agents', target: '.codex/agents' },
    ],
  },
  ...GENERIC_AGENT_PROVIDER_ENTRIES,
  cline: {
    name: 'cline',
    rules: [
      AGENTS_INSTRUCTION_RULE,
      { source: '.ai/skills', target: '.cline/skills', flatten: true },
    ],
  },
  kiro: {
    name: 'kiro',
    rules: [
      AGENTS_INSTRUCTION_RULE,
      { source: '.ai/skills', target: '.kiro/skills', flatten: true },
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
      const childRel = artifact.slice(relSource.length + 1)
      // A flatten rule exposes every child at its leaf name, collapsing any
      // catalog nesting so `skills/coding/clean-code` targets `skills/clean-code`.
      targets.add(join(rule.target, rule.flatten ? basename(childRel) : childRel))
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

    // A flatten rule (skills) is discovered by the Skill Resolver so catalog
    // layouts surface each leaf Skill by its real source path; other directory
    // sources list their immediate children as before.
    if (rule.flatten) {
      for (const skill of await resolveSkills(sourcePath)) {
        artifacts.add(`${relSource}/${skill.sourceRelPath}`)
      }
      continue
    }

    const entries = await readdir(sourcePath)
    for (const e of entries) artifacts.add(`${relSource}/${e}`)
  }
  return [...artifacts]
}
