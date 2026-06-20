import { Octokit } from '@octokit/rest'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { diagnostics } from '../diagnostics'

// ── User path (unauthenticated) ──────────────────────────────────────────

export interface ResolvedRelease {
  tag: string
  assetDownloadUrl: string
  immutable: boolean
}

export async function fetchReleaseInfo(
  owner: string,
  repo: string,
  tag: string | undefined,
  octokit: Octokit,
): Promise<ResolvedRelease> {
  let releaseTag: string
  let immutable: boolean
  let assets: Array<{ name: string; browser_download_url: string }>

  if (tag) {
    const { data } = await octokit.repos.getReleaseByTag({ owner, repo, tag })
    releaseTag = data.tag_name
    immutable = (data as unknown as { immutable?: boolean }).immutable === true
    assets = data.assets
  } else {
    const { data } = await octokit.repos.getLatestRelease({ owner, repo })
    releaseTag = data.tag_name
    immutable = (data as unknown as { immutable?: boolean }).immutable === true
    assets = data.assets
  }

  const asset = assets.find(a => a.name === 'ai.zip')
  if (!asset) {
    const ref = tag ?? 'latest'
    throw diagnostics.AIRIG_R0011({ ref, owner, repo })
  }

  return { tag: releaseTag, assetDownloadUrl: asset.browser_download_url, immutable }
}

export async function downloadAsset(url: string): Promise<Buffer> {
  const response = await fetch(url)
  if (!response.ok) {
    throw diagnostics.AIRIG_R0012({ status: response.status, statusText: response.statusText })
  }
  return Buffer.from(await response.arrayBuffer())
}

export function createOctokit(token: string): Octokit {
  return new Octokit({ auth: token })
}

export async function getImmutableReleasesStatus(
  owner: string,
  repo: string,
  octokit: Octokit,
): Promise<{ enabled: boolean; enforced_by_owner: boolean }> {
  try {
    const { data } = await octokit.request('GET /repos/{owner}/{repo}/immutable-releases', { owner, repo })
    return data as { enabled: boolean; enforced_by_owner: boolean }
  } catch (err: unknown) {
    if (err && typeof err === 'object' && 'status' in err) {
      const status = (err as { status: number }).status
      // 404 means the feature has never been configured — treat as disabled
      if (status === 404) return { enabled: false, enforced_by_owner: false }
      // The /immutable-releases endpoint requires auth even on public repos
      if (status === 401) {
        throw diagnostics.AIRIG_R0013({ cause: err })
      }
    }
    throw err
  }
}

interface OctokitError {
  status: number
  response?: {
    data?: {
      message?: string
      errors?: Array<{ resource?: string; code?: string; field?: string }>
    }
  }
}

function isOctokitError(err: unknown): err is OctokitError {
  return err != null && typeof err === 'object' && 'status' in err
}

type PublishStep = 'create-release' | 'upload-asset' | 'publish-release'

function interpretError(err: unknown, step: PublishStep, ctx: { owner: string; repo: string; tag: string }): Error {
  if (!isOctokitError(err)) {
    return err instanceof Error ? err : new Error(String(err))
  }

  const { status } = err
  const firstValidationError = err.response?.data?.errors?.[0]

  if (status === 401) {
    return diagnostics.AIRIG_R0014({ cause: err })
  }

  if (status === 403) {
    return diagnostics.AIRIG_R0015({ owner: ctx.owner, repo: ctx.repo, cause: err })
  }

  if (status === 404 && step === 'create-release') {
    return diagnostics.AIRIG_R0016({ owner: ctx.owner, repo: ctx.repo, cause: err })
  }

  if (status === 422 && firstValidationError?.code === 'already_exists' && firstValidationError?.field === 'tag_name') {
    return diagnostics.AIRIG_R0017({ owner: ctx.owner, repo: ctx.repo, tag: ctx.tag, cause: err })
  }

  if (status === 422 && step === 'upload-asset' && firstValidationError?.code === 'already_exists') {
    return diagnostics.AIRIG_R0018({ owner: ctx.owner, repo: ctx.repo, cause: err })
  }

  const apiMessage = err.response?.data?.message ?? String(err)
  return diagnostics.AIRIG_R0019({ status, message: apiMessage, cause: err })
}

async function deleteDraft(octokit: Octokit, owner: string, repo: string, releaseId: number): Promise<void> {
  // Best-effort — swallow errors so the caller's original error is not masked
  await octokit.repos.deleteRelease({ owner, repo, release_id: releaseId }).catch(() => {})
}

export async function publishRelease(opts: {
  owner: string
  repo: string
  tag: string
  assetPath: string
  octokit: Octokit
}): Promise<string> {
  const { owner, repo, tag, assetPath, octokit } = opts
  const ctx = { owner, repo, tag }

  let draftId: number

  try {
    const { data: draft } = await octokit.repos.createRelease({
      owner, repo, tag_name: tag, draft: true,
    })
    draftId = draft.id
  } catch (err) {
    throw interpretError(err, 'create-release', ctx)
  }

  try {
    const assetData = await readFile(assetPath)
    await octokit.repos.uploadReleaseAsset({
      owner, repo, release_id: draftId, name: path.basename(assetPath),
      data: assetData as unknown as string,
    })
  } catch (err) {
    await deleteDraft(octokit, owner, repo, draftId)
    throw interpretError(err, 'upload-asset', ctx)
  }

  try {
    const { data: published } = await octokit.repos.updateRelease({
      owner, repo, release_id: draftId, draft: false,
    })
    return published.html_url
  } catch (err) {
    await deleteDraft(octokit, owner, repo, draftId)
    throw interpretError(err, 'publish-release', ctx)
  }
}
