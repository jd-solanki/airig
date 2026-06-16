import { Command } from 'commander'
import { execSync } from 'node:child_process'
import { readFile, rm } from 'node:fs/promises'
import path from 'node:path'
import { parseEnv } from 'node:util'
import { create as createZip } from '../lib/zip'
import { createOctokit, getImmutableReleasesStatus, publishRelease } from '../lib/github'

function resolveTag(tagArg: string | undefined): string {
  if (tagArg) return tagArg
  try {
    return execSync('git describe --tags --abbrev=0', { encoding: 'utf8' }).trim()
  } catch {
    console.error('✖ No tag found. Pass a tag argument or create a git tag first.')
    process.exit(1)
  }
}

// Handles HTTPS (https://host/owner/repo) and SSH (git@host:owner/repo) including custom SSH aliases
export function parseRemoteUrl(remote: string): { owner: string; repo: string } | null {
  const match = remote.match(/[:/]([^/:]+)\/([^/]+?)(?:\.git)?$/)
  if (!match) return null
  return { owner: match[1], repo: match[2] }
}

function resolveOwnerRepo(): { owner: string; repo: string } {
  let remote: string
  try {
    remote = execSync('git remote get-url origin', { encoding: 'utf8' }).trim()
  } catch {
    console.error('✖ Could not read git remote origin. Is this a git repository with a remote?')
    process.exit(1)
  }

  const parsed = parseRemoteUrl(remote)
  if (!parsed) {
    console.error(`✖ Could not parse owner/repo from remote: ${remote}`)
    process.exit(1)
  }

  return parsed
}

export function createPublishZip(zipPath = path.join(process.cwd(), 'ai.zip')): Promise<void> {
  return createZip('.ai', zipPath)
}

function isNodeErrorWithCode(err: unknown, code: string): boolean {
  return err instanceof Error && 'code' in err && err.code === code
}

export async function loadPublishGithubTokenFromCwd(): Promise<string | undefined> {
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN

  try {
    const envFile = await readFile(path.join(process.cwd(), '.env'), 'utf8')
    const token = parseEnv(envFile).GITHUB_TOKEN
    if (token) process.env.GITHUB_TOKEN = token
    return token
  } catch (err) {
    if (isNodeErrorWithCode(err, 'ENOENT')) return undefined
    throw err
  }
}

export const publishCommand = new Command('publish')
  .description('Publish project .ai artifacts as an immutable ai.zip release')
  .argument('[tag]', 'Git tag to release (defaults to latest local tag)')
  .action(async (tagArg: string | undefined) => {
    try {
      const token = await loadPublishGithubTokenFromCwd()
      if (!token) {
        console.error('✖ GITHUB_TOKEN is not set. Add it to .env in this directory or export it before running publish.')
        console.error('  GITHUB_TOKEN=ghp_...')
        process.exit(1)
      }

      const tag = resolveTag(tagArg)
      const { owner, repo } = resolveOwnerRepo()

      const octokit = createOctokit(token)

      // Setup Releases must be immutable so users can trust ai.zip won't be swapped after publishing.
      const immutable = await getImmutableReleasesStatus(owner, repo, octokit)
      if (!immutable.enabled) {
        console.error(`✖ Immutable releases are not enabled for ${owner}/${repo}.`)
        console.error(`  Enable it at: https://github.com/${owner}/${repo}/settings`)
        console.error('  Docs: https://docs.github.com/en/repositories/releasing-projects-on-github/managing-releases-in-a-repository')
        process.exit(1)
      }

      const zipPath = path.join(process.cwd(), 'ai.zip')
      await createPublishZip(zipPath)

      const url = await publishRelease({ owner, repo, tag, assetPath: zipPath, octokit })
      await rm(zipPath, { force: true })

      console.log(`✔ Published: ${url}`)
    } catch (err) {
      console.error(`✖ ${err instanceof Error ? err.message : String(err)}`)
      process.exit(1)
    }
  })
