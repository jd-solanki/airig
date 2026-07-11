import { Command } from 'commander'
import { Octokit } from '@octokit/rest'
import { checkbox } from '@inquirer/prompts'
import { existsSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import path from 'node:path'
import {
  readAiJson,
  writeAiJson,
  addPackage,
  packageSource,
  type AiJson,
  type PackageEntry,
} from '../lib/ai-json'
import { resolveCommitSha, downloadRepoZipball } from '../lib/github'
import { parseSkillsRef } from '../lib/package-ref'
import { resolveSkillsRepo, type ResolvedSkill } from '../lib/skill-resolver'
import { withExtractedRepoZip, copyRepoSkillsToLocal } from '../lib/skills-repo'
import { buildSkillSelectionChoices } from '../lib/skill-selection'
import { findRemotePackageConflicts, unlinkFiles } from '../lib/linker'
import { PROVIDER_REGISTRY, targetPathsForArtifact } from '../lib/provider-registry'
import {
  assertNoTargetConflicts,
  createRelativeSymlinkIfMissing,
  targetPointsToSource,
  targetSourcePairs,
} from '../lib/target-links'
import { resolveSetupScope, type SetupScope } from '../lib/setup-scope'
import { runRemove } from './remove'
import { diagnostics } from '../diagnostics'

const SKILLS_PREFIX = 'skills/'

interface SkillsAddOptions {
  global?: boolean
  /** Non-interactive skill selectors, repeatable via `--skill`. */
  skill?: string[]
}

interface SkillsScopeOptions {
  global?: boolean
}

// ── add ──────────────────────────────────────────────────────────────────

export async function runSkillsAdd(pkg: string, options: SkillsAddOptions = {}): Promise<void> {
  const scope = resolveSetupScope(options)
  const { owner, repo, ref, skillPath } = parseSkillsRef(pkg)
  const packageKey = `${owner}/${repo}`
  const aiJson = await readAiJson(scope.aiJsonPath)
  const existingEntry = aiJson.packages[packageKey]

  if (existingEntry) assertSkillsRepoEntry(existingEntry, packageKey)

  const octokit = githubClient()
  const sha = await resolveInstallSha(owner, repo, ref, existingEntry, packageKey, octokit)

  console.log(`  Downloading ${packageKey}@${shortSha(sha)}...`)
  const zipBuffer = await downloadRepoZipball(owner, repo, sha, octokit)

  await withExtractedRepoZip(zipBuffer, 'airig-skills-add-', async repoRoot => {
    const discovered = await resolveSkillsRepo(repoRoot, repo)
    if (discovered.length === 0) {
      console.log(`No skills found in ${packageKey}.`)
      return
    }

    const currentLinked = existingEntry?.linked ?? []
    const installedNames = new Set(currentLinked.map(skillNameFromLabel))
    const available = discovered.filter(skill => !installedNames.has(skill.name))
    const selectors = skillSelectors(skillPath, options.skill)

    const providers = await promptProviders()
    if (providers.length === 0) {
      console.log('No providers selected.')
      return
    }

    const selectedSkills = selectors.length > 0
      ? selectSkillsBySelectors(discovered, selectors, installedNames, packageKey)
      : await promptSkillSelection(available, currentLinked.length === 0, packageKey)
    if (selectedSkills.length === 0) return

    const selectedLabels = selectedSkills.map(skill => labelForSkill(skill.name))

    assertNoRemoteConflicts(aiJson, packageKey, providers, selectedLabels)
    assertNoSkillSourceConflicts(packageKey, currentLinked, selectedLabels, scope)
    await assertNoSkillTargetConflicts(selectedLabels, providers, scope)

    await copyRepoSkillsToLocal(repoRoot, selectedSkills, scope.sourceRoot)

    if (!existingEntry) {
      addPackage(aiJson, packageKey, { source: 'skills-repo', version: sha, linked: [] })
    }
    const selected = [...new Set([...currentLinked, ...selectedLabels])]
    await linkSkills(providers, selected, scope, 'skills add')
    aiJson.packages[packageKey].linked = selected
    await writeAiJson(aiJson, scope.aiJsonPath)

    console.log(`\nAdded ${selectedLabels.length} skill(s) from ${packageKey}@${shortSha(sha)}.`)
  })
}

/**
 * The commit SHA to install. A fresh install resolves the requested ref (or the
 * default branch HEAD). An already-installed repo stays on its pinned SHA so the
 * User can add more skills without moving versions; passing an explicit ref that
 * resolves to a different commit is an error that points to `skills update`.
 */
async function resolveInstallSha(
  owner: string,
  repo: string,
  ref: string | undefined,
  existingEntry: PackageEntry | undefined,
  packageKey: string,
  octokit: Octokit,
): Promise<string> {
  if (!existingEntry) return resolveCommitSha(owner, repo, ref, octokit)

  if (ref) {
    const requestedSha = await resolveCommitSha(owner, repo, ref, octokit)
    if (requestedSha !== existingEntry.version) {
      throw diagnostics.AIRIG_R0027({
        packageKey,
        installedSha: shortSha(existingEntry.version),
        requestedSha: shortSha(requestedSha),
      })
    }
  }
  return existingEntry.version
}

/** Explicit selectors from the positional direct path plus every `--skill`. */
function skillSelectors(skillPath: string | undefined, skillFlags: string[] | undefined): string[] {
  return [...(skillPath ? [skillPath] : []), ...(skillFlags ?? [])]
}

/**
 * Resolve each explicit selector against a discovered Skill by leaf name
 * (`clean-code`), full source path (`skills/coding/clean-code`), or any suffix
 * of it (`coding/clean-code`), so a selector works with or without the
 * scan-container prefix. Unknown selectors error; already-installed ones are
 * skipped with a note.
 */
function selectSkillsBySelectors(
  discovered: ResolvedSkill[],
  selectors: string[],
  installedNames: Set<string>,
  packageKey: string,
): ResolvedSkill[] {
  const matched = new Map<string, ResolvedSkill>()

  for (const selector of selectors) {
    const skill = discovered.find(candidate =>
      candidate.name === selector ||
      candidate.sourceRelPath === selector ||
      candidate.sourceRelPath.endsWith(`/${selector}`),
    )
    if (!skill) throw diagnostics.AIRIG_R0026({ skill: selector, packageKey })
    if (installedNames.has(skill.name)) {
      console.log(`Skill "${skill.name}" is already installed.`)
      continue
    }
    matched.set(skill.name, skill)
  }

  return [...matched.values()]
}

async function promptSkillSelection(
  available: ResolvedSkill[],
  checkedByDefault: boolean,
  packageKey: string,
): Promise<ResolvedSkill[]> {
  if (available.length === 0) {
    console.log(`No new skills found for ${packageKey}.`)
    return []
  }

  const selectedNames = await checkbox({
    message: 'Select skills to add:',
    choices: buildSkillSelectionChoices(available, checkedByDefault),
  })
  if (selectedNames.length === 0) {
    console.log('No skills selected.')
    return []
  }

  const selectedSet = new Set(selectedNames)
  return available.filter(skill => selectedSet.has(skill.name))
}

// ── update ─────────────────────────────────────────────────────────────────

export async function runSkillsUpdate(pkg: string, options: SkillsScopeOptions = {}): Promise<void> {
  const scope = resolveSetupScope(options)
  const { owner, repo, ref } = parseSkillsRef(pkg)
  const packageKey = `${owner}/${repo}`
  const aiJson = await readAiJson(scope.aiJsonPath)
  const entry = aiJson.packages[packageKey]

  if (!entry) {
    throw diagnostics.AIRIG_R0001({ packageKey, hint: 'Install it first with: airig skills add <owner/repo>' })
  }
  assertSkillsRepoEntry(entry, packageKey)

  const octokit = githubClient()
  const newSha = await resolveCommitSha(owner, repo, ref, octokit)
  const previousSha = entry.version

  console.log(`  Downloading ${packageKey}@${shortSha(newSha)}...`)
  const zipBuffer = await downloadRepoZipball(owner, repo, newSha, octokit)

  await withExtractedRepoZip(zipBuffer, 'airig-skills-update-', async repoRoot => {
    const discovered = await resolveSkillsRepo(repoRoot, repo)
    const discoveredNames = new Set(discovered.map(skill => skill.name))
    const previousLinked = [...entry.linked]
    const survivingLabels = previousLinked.filter(label => discoveredNames.has(skillNameFromLabel(label)))
    const deletedLabels = previousLinked.filter(label => !discoveredNames.has(skillNameFromLabel(label)))
    const survivors = discovered.filter(skill => survivingLabels.includes(labelForSkill(skill.name)))

    const providers = await activeSkillProviders(previousLinked, scope)

    await copyRepoSkillsToLocal(repoRoot, survivors, scope.sourceRoot)
    await unlinkDeletedSkills(deletedLabels, providers, scope)
    await linkSkills(providers, survivingLabels, scope, 'skills update')

    entry.version = newSha
    entry.linked = survivingLabels
    await writeAiJson(aiJson, scope.aiJsonPath)

    console.log(
      `\nUpdated ${packageKey} from ${shortSha(previousSha)} to ${shortSha(newSha)} ` +
      `(${survivingLabels.length} refreshed, ${deletedLabels.length} pruned).`,
    )
  })
}

/** Remove a deleted Skill's source and unlink every provider target it held. */
async function unlinkDeletedSkills(
  deletedLabels: string[],
  providers: string[],
  scope: SetupScope,
): Promise<void> {
  for (const label of deletedLabels) {
    const targets = targetPathsForArtifact(label, providers).map(target => path.join(scope.targetRoot, target))
    await unlinkFiles(targets)
    await rm(path.join(scope.sourceRoot, label), { recursive: true, force: true })
  }
}

async function activeSkillProviders(labels: string[], scope: SetupScope): Promise<string[]> {
  const active: string[] = []
  for (const provider of Object.keys(PROVIDER_REGISTRY)) {
    if (await providerHasLiveSkillLink(provider, labels, scope)) active.push(provider)
  }
  return active
}

async function providerHasLiveSkillLink(provider: string, labels: string[], scope: SetupScope): Promise<boolean> {
  for (const label of labels) {
    for (const targetPath of targetPathsForArtifact(label, [provider])) {
      if (await targetPointsToSource(path.join(scope.targetRoot, targetPath), path.join(scope.sourceRoot, label))) {
        return true
      }
    }
  }
  return false
}

// ── remove ───────────────────────────────────────────────────────────────

export async function runSkillsRemove(pkg: string, options: SkillsScopeOptions = {}): Promise<void> {
  const scope = resolveSetupScope(options)
  const aiJson = await readAiJson(scope.aiJsonPath)
  const entry = aiJson.packages[pkg]
  if (entry) assertSkillsRepoEntry(entry, pkg)
  await runRemove(pkg, options)
}

// ── shared ─────────────────────────────────────────────────────────────────

/**
 * Create the provider symlinks for the selected Skill labels, checking target
 * conflicts first. Symlinks that already point to the source are left untouched,
 * so re-adding is idempotent.
 */
async function linkSkills(
  providers: string[],
  labels: string[],
  scope: SetupScope,
  retryCommand: string,
): Promise<void> {
  const pairs = targetSourcePairs(scope.sourceRoot, scope.targetRoot, providers, labels)
  await assertNoTargetConflicts(pairs, retryCommand)
  for (const [targetPath, sourcePath] of pairs) {
    await createRelativeSymlinkIfMissing(sourcePath, targetPath)
  }
}

function assertSkillsRepoEntry(entry: PackageEntry, packageKey: string): void {
  if (packageSource(entry) !== 'skills-repo') {
    throw diagnostics.AIRIG_R0025({ packageKey })
  }
}

function assertNoRemoteConflicts(
  aiJson: AiJson,
  packageKey: string,
  providers: string[],
  labels: string[],
): void {
  const conflicts = findRemotePackageConflicts(aiJson, packageKey, providers, labels)
  if (conflicts.length === 0) return

  throw diagnostics.AIRIG_R0005({
    conflicts: conflicts
      .map(({ targetPath, owner }) => `  ${targetPath}  (owned by ${owner.packageKey}@${owner.version})`)
      .join('\n'),
    command: 'airig remove',
  })
}

function assertNoSkillSourceConflicts(
  packageKey: string,
  currentLinked: string[],
  labels: string[],
  scope: SetupScope,
): void {
  const conflicts = labels.filter(label =>
    !currentLinked.includes(label) && existsSync(path.join(scope.sourceRoot, label)))
  if (conflicts.length === 0) return

  throw diagnostics.AIRIG_R0004({
    packageKey,
    files: conflicts.map(label => `  ${path.join(scope.sourcePrefix, label)}`).join('\n'),
  })
}

async function assertNoSkillTargetConflicts(labels: string[], providers: string[], scope: SetupScope): Promise<void> {
  await assertNoTargetConflicts(
    targetSourcePairs(scope.sourceRoot, scope.targetRoot, providers, labels),
    'skills add',
  )
}

async function promptProviders(): Promise<string[]> {
  return checkbox({
    message: 'Select providers to add:',
    choices: Object.keys(PROVIDER_REGISTRY).map(provider => ({ value: provider, name: provider })),
  })
}

function githubClient(): Octokit {
  return new Octokit({ auth: process.env.GITHUB_TOKEN })
}

function labelForSkill(name: string): string {
  return `${SKILLS_PREFIX}${name}`
}

function skillNameFromLabel(label: string): string {
  return label.slice(SKILLS_PREFIX.length)
}

function shortSha(sha: string): string {
  return sha.slice(0, 7)
}

function collectSkill(value: string, previous: string[]): string[] {
  return [...previous, value]
}

export const skillsCommand = new Command('skills')
  .description('Install and manage Skills directly from a bare skills-CLI repository')

skillsCommand
  .command('add')
  .description('Add Skills from a Skills Repo, pinned to an exact commit SHA')
  .argument('<package>', 'Skills Repo to add: owner/repo[@ref], owner/repo/skill, or a GitHub URL')
  .option('--global', 'Install into the user Global AI Setup at ~/.ai')
  .option('--skill <name>', 'Add a specific skill by name (repeatable)', collectSkill, [])
  .action(runSkillsAdd)

skillsCommand
  .command('update')
  .description('Move an installed Skills Repo to a new commit and refresh its Skills')
  .argument('<package>', 'Skills Repo to update, e.g. owner/repo or owner/repo@ref')
  .option('--global', 'Update an installed Skills Repo in the user Global AI Setup at ~/.ai')
  .action(runSkillsUpdate)

skillsCommand
  .command('remove')
  .description('Interactively remove installed Skills from a Skills Repo')
  .argument('<package>', 'Skills Repo to remove from, e.g. owner/repo')
  .option('--global', 'Remove from the user Global AI Setup at ~/.ai')
  .action(runSkillsRemove)
