import { Command } from 'commander'
import { execSync } from 'node:child_process'
import { readFile, rm } from 'node:fs/promises'
import path from 'node:path'
import { parseEnv } from 'node:util'
import { create as createZip } from '../lib/zip'
import { createOctokit, getImmutableReleasesStatus, publishRelease } from '../lib/github'
import { diagnostics } from '../diagnostics'

function resolveTag(tagArg: string | undefined): string {
  if (tagArg) return tagArg
  try {
    return execSync('git describe --tags --abbrev=0', { encoding: 'utf8' }).trim()
  } catch {
    throw diagnostics.AIRIG_C0009()
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
    throw diagnostics.AIRIG_C0010()
  }

  const parsed = parseRemoteUrl(remote)
  if (!parsed) {
    throw diagnostics.AIRIG_C0011({ remote })
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
    const token = await loadPublishGithubTokenFromCwd()
    if (!token) {
      throw diagnostics.AIRIG_C0012()
    }

    const tag = resolveTag(tagArg)
    const { owner, repo } = resolveOwnerRepo()

    const octokit = createOctokit(token)

    // Setup Releases must be immutable so users can trust ai.zip won't be swapped after publishing.
    const immutable = await getImmutableReleasesStatus(owner, repo, octokit)
    if (!immutable.enabled) {
      throw diagnostics.AIRIG_R0021({ owner, repo })
    }

    const zipPath = path.join(process.cwd(), 'ai.zip')
    await createPublishZip(zipPath)

    const url = await publishRelease({ owner, repo, tag, assetPath: zipPath, octokit })
    await rm(zipPath, { force: true })

    console.log(`✔ Published: ${url}`)
  })
