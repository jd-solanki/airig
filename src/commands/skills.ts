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
import { findRemotePackageConflicts, reconcilePackageLinks } from '../lib/linker'
import { PROVIDER_REGISTRY, targetPathsForArtifact } from '../lib/provider-registry'
import {
  assertNoTargetConflicts,
  targetPointsToSource,
  targetSourcePairs,
} from '../lib/target-links'
import { runRemove } from './remove'
import { diagnostics } from '../diagnostics'

const SKILLS_PREFIX = 'skills/'
const SOURCE_ROOT = '.ai'
const TARGET_ROOT = '.'

// ── add ──────────────────────────────────────────────────────────────────

export async function runSkillsAdd(pkg: string): Promise<void> {
  const { owner, repo, ref, skillPath } = parseSkillsRef(pkg)
  const packageKey = `${owner}/${repo}`
  const aiJson = await readAiJson()
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

    const providers = await promptProviders()
    if (providers.length === 0) {
      console.log('No providers selected.')
      return
    }

    const selectedSkills = skillPath
      ? selectDirectPathSkill(discovered, skillPath, installedNames, packageKey)
      : await promptSkillSelection(available, currentLinked.length === 0, packageKey)
    if (selectedSkills.length === 0) return

    const selectedLabels = selectedSkills.map(skill => labelForSkill(skill.name))

    assertNoRemoteConflicts(aiJson, packageKey, providers, selectedLabels)
    assertNoSkillSourceConflicts(packageKey, currentLinked, selectedLabels)
    await assertNoSkillTargetConflicts(selectedLabels, providers)

    await copyRepoSkillsToLocal(repoRoot, selectedSkills, SOURCE_ROOT)

    if (!existingEntry) {
      addPackage(aiJson, packageKey, { source: 'skills-repo', version: sha, linked: [] })
    }
    const selected = [...new Set([...currentLinked, ...selectedLabels])]
    await reconcilePackageLinks(aiJson, packageKey, providers, selected, selected)
    await writeAiJson(aiJson)

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

function selectDirectPathSkill(
  discovered: ResolvedSkill[],
  skillPath: string,
  installedNames: Set<string>,
  packageKey: string,
): ResolvedSkill[] {
  // Accept the leaf name (`clean-code`), the full source path
  // (`skills/coding/clean-code`), or any suffix of it (`coding/clean-code`), so a
  // direct path works whether or not the User includes the scan-container prefix.
  const match = discovered.find(skill =>
    skill.name === skillPath ||
    skill.sourceRelPath === skillPath ||
    skill.sourceRelPath.endsWith(`/${skillPath}`),
  )
  if (!match) throw diagnostics.AIRIG_R0026({ skill: skillPath, packageKey })
  if (installedNames.has(match.name)) {
    console.log(`Skill "${match.name}" is already installed.`)
    return []
  }
  return [match]
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

export async function runSkillsUpdate(pkg: string): Promise<void> {
  const { owner, repo, ref } = parseSkillsRef(pkg)
  const packageKey = `${owner}/${repo}`
  const aiJson = await readAiJson()
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

    const providers = await activeSkillProviders(previousLinked)
    const survivors = discovered.filter(skill => survivingLabels.includes(labelForSkill(skill.name)))

    await copyRepoSkillsToLocal(repoRoot, survivors, SOURCE_ROOT)

    entry.version = newSha
    // Reconciling with the previous linked list as scope unlinks the targets of
    // skills deleted upstream while relinking the survivors that remain.
    await reconcilePackageLinks(aiJson, packageKey, providers, survivingLabels, previousLinked)

    for (const label of deletedLabels) {
      await rm(path.join(SOURCE_ROOT, label), { recursive: true, force: true })
    }
    await writeAiJson(aiJson)

    console.log(
      `\nUpdated ${packageKey} from ${shortSha(previousSha)} to ${shortSha(newSha)} ` +
      `(${survivingLabels.length} refreshed, ${deletedLabels.length} pruned).`,
    )
  })
}

async function activeSkillProviders(labels: string[]): Promise<string[]> {
  const active: string[] = []
  for (const provider of Object.keys(PROVIDER_REGISTRY)) {
    if (await providerHasLiveSkillLink(provider, labels)) active.push(provider)
  }
  return active
}

async function providerHasLiveSkillLink(provider: string, labels: string[]): Promise<boolean> {
  for (const label of labels) {
    for (const targetPath of targetPathsForArtifact(label, [provider])) {
      if (await targetPointsToSource(path.join(TARGET_ROOT, targetPath), path.join(SOURCE_ROOT, label))) {
        return true
      }
    }
  }
  return false
}

// ── remove ───────────────────────────────────────────────────────────────

export async function runSkillsRemove(pkg: string): Promise<void> {
  const aiJson = await readAiJson()
  const entry = aiJson.packages[pkg]
  if (entry) assertSkillsRepoEntry(entry, pkg)
  await runRemove(pkg)
}

// ── shared ─────────────────────────────────────────────────────────────────

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

function assertNoSkillSourceConflicts(packageKey: string, currentLinked: string[], labels: string[]): void {
  const conflicts = labels.filter(label => !currentLinked.includes(label) && existsSync(path.join(SOURCE_ROOT, label)))
  if (conflicts.length === 0) return

  throw diagnostics.AIRIG_R0004({
    packageKey,
    files: conflicts.map(label => `  ${path.join(SOURCE_ROOT, label)}`).join('\n'),
  })
}

async function assertNoSkillTargetConflicts(labels: string[], providers: string[]): Promise<void> {
  await assertNoTargetConflicts(
    targetSourcePairs(SOURCE_ROOT, TARGET_ROOT, providers, labels),
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

export const skillsCommand = new Command('skills')
  .description('Install and manage Skills directly from a bare skills-CLI repository')

skillsCommand
  .command('add')
  .description('Add Skills from a Skills Repo, pinned to an exact commit SHA')
  .argument('<package>', 'Skills Repo to add, e.g. owner/repo, owner/repo@ref, or owner/repo/skill')
  .action(runSkillsAdd)

skillsCommand
  .command('update')
  .description('Move an installed Skills Repo to a new commit and refresh its Skills')
  .argument('<package>', 'Skills Repo to update, e.g. owner/repo or owner/repo@ref')
  .action(runSkillsUpdate)

skillsCommand
  .command('remove')
  .description('Interactively remove installed Skills from a Skills Repo')
  .argument('<package>', 'Skills Repo to remove from, e.g. owner/repo')
  .action(runSkillsRemove)
