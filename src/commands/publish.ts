import { Command } from 'commander'
import { execSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import path from 'node:path'
import { create as createZip } from '../lib/zip.js'
import { createOctokit, getImmutableReleasesStatus, publishRelease } from '../lib/github.js'

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

export const publishCommand = new Command('publish')
  .description('Create an immutable GitHub release with ai.zip')
  .argument('[tag]', 'Git tag to release (defaults to latest local tag)')
  .action(async (tagArg: string | undefined) => {
    const token = process.env.GITHUB_TOKEN
    if (!token) {
      console.error('✖ GITHUB_TOKEN is not set. Export it before running publish.')
      console.error('  export GITHUB_TOKEN=ghp_...')
      process.exit(1)
    }

    const tag = resolveTag(tagArg)
    const { owner, repo } = resolveOwnerRepo()

    try {
      const octokit = createOctokit(token)

      const immutable = await getImmutableReleasesStatus(owner, repo, octokit)
      if (!immutable.enabled) {
        console.error(`✖ Immutable releases are not enabled for ${owner}/${repo}.`)
        console.error(`  Enable it at: https://github.com/${owner}/${repo}/settings`)
        console.error('  Docs: https://docs.github.com/en/repositories/releasing-projects-on-github/managing-releases-in-a-repository')
        process.exit(1)
      }

      const zipPath = path.join(process.cwd(), 'ai.zip')
      const extraDirs = existsSync('.ai.global') ? ['.ai.global'] : []
      await createZip('.ai', zipPath, extraDirs)

      const url = await publishRelease({ owner, repo, tag, assetPath: zipPath, octokit })
      await rm(zipPath, { force: true })

      console.log(`✔ Published: ${url}`)
    } catch (err) {
      console.error(`✖ ${err instanceof Error ? err.message : String(err)}`)
      process.exit(1)
    }
  })
