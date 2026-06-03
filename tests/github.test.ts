import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { Octokit } from '@octokit/rest'
import {
  publishRelease,
  getImmutableReleasesStatus,
  fetchReleaseInfo,
  downloadAsset,
} from '../src/lib/github.js'

let tmpDir: string

beforeEach(async () => {
  tmpDir = await mkdtemp(path.join(os.tmpdir(), 'ohmyai-github-test-'))
})

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true })
})

function makeMockOctokit(overrides?: Partial<{ createRelease: unknown; uploadReleaseAsset: unknown; updateRelease: unknown }>): Octokit {
  return {
    repos: {
      createRelease: overrides?.createRelease ?? vi.fn().mockResolvedValue({
        data: { id: 42, html_url: 'https://github.com/owner/repo/releases/tag/v1.0.0' },
      }),
      uploadReleaseAsset: overrides?.uploadReleaseAsset ?? vi.fn().mockResolvedValue({ data: {} }),
      updateRelease: overrides?.updateRelease ?? vi.fn().mockResolvedValue({
        data: { id: 42, html_url: 'https://github.com/owner/repo/releases/tag/v1.0.0' },
      }),
    },
  } as unknown as Octokit
}

describe('getImmutableReleasesStatus', () => {
  it('returns enabled:true when the API reports immutable releases are on', async () => {
    const octokit = {
      request: vi.fn().mockResolvedValue({ data: { enabled: true, enforced_by_owner: false } }),
    } as unknown as Octokit

    const result = await getImmutableReleasesStatus('owner', 'repo', octokit)

    expect(result).toEqual({ enabled: true, enforced_by_owner: false })
    expect(octokit.request).toHaveBeenCalledWith(
      'GET /repos/{owner}/{repo}/immutable-releases',
      { owner: 'owner', repo: 'repo' },
    )
  })

  it('returns enabled:true with enforced_by_owner:true when org enforces it', async () => {
    const octokit = {
      request: vi.fn().mockResolvedValue({ data: { enabled: true, enforced_by_owner: true } }),
    } as unknown as Octokit

    const result = await getImmutableReleasesStatus('owner', 'repo', octokit)

    expect(result).toEqual({ enabled: true, enforced_by_owner: true })
  })

  it('returns enabled:false when API returns 404 (feature never configured)', async () => {
    const notFound = Object.assign(new Error('Not Found'), { status: 404 })
    const octokit = {
      request: vi.fn().mockRejectedValue(notFound),
    } as unknown as Octokit

    const result = await getImmutableReleasesStatus('owner', 'repo', octokit)

    expect(result).toEqual({ enabled: false, enforced_by_owner: false })
  })

  it('returns enabled:false when API returns enabled:false', async () => {
    const octokit = {
      request: vi.fn().mockResolvedValue({ data: { enabled: false, enforced_by_owner: false } }),
    } as unknown as Octokit

    const result = await getImmutableReleasesStatus('owner', 'repo', octokit)

    expect(result.enabled).toBe(false)
  })

  it('rethrows non-404 errors', async () => {
    const serverError = Object.assign(new Error('Internal Server Error'), { status: 500 })
    const octokit = {
      request: vi.fn().mockRejectedValue(serverError),
    } as unknown as Octokit

    await expect(getImmutableReleasesStatus('owner', 'repo', octokit)).rejects.toThrow('Internal Server Error')
  })
})

function octokitError(status: number, message: string, errors?: Array<{ resource?: string; code?: string; field?: string }>) {
  return Object.assign(new Error(message), {
    status,
    response: { data: { message, errors } },
  })
}

describe('publishRelease error handling', () => {
  it('throws a friendly message and cleans up the draft when updateRelease fails with already_exists', async () => {
    const assetPath = path.join(tmpDir, 'ai.zip')
    await writeFile(assetPath, 'fake zip')

    const deleteRelease = vi.fn().mockResolvedValue({})
    const octokit = {
      repos: {
        createRelease: vi.fn().mockResolvedValue({ data: { id: 99, html_url: '' } }),
        uploadReleaseAsset: vi.fn().mockResolvedValue({ data: {} }),
        updateRelease: vi.fn().mockRejectedValue(
          octokitError(422, 'Validation Failed', [{ resource: 'Release', code: 'already_exists', field: 'tag_name' }]),
        ),
        deleteRelease,
      },
    } as unknown as Octokit

    await expect(
      publishRelease({ owner: 'owner', repo: 'repo', tag: 'v1.0.0', assetPath, octokit }),
    ).rejects.toThrow('A release for tag v1.0.0 already exists')

    expect(deleteRelease).toHaveBeenCalledWith({ owner: 'owner', repo: 'repo', release_id: 99 })
  })

  it('throws a friendly message on 401 from createRelease', async () => {
    const assetPath = path.join(tmpDir, 'ai.zip')
    await writeFile(assetPath, 'fake zip')

    const octokit = {
      repos: {
        createRelease: vi.fn().mockRejectedValue(octokitError(401, 'Bad credentials')),
      },
    } as unknown as Octokit

    await expect(
      publishRelease({ owner: 'owner', repo: 'repo', tag: 'v1.0.0', assetPath, octokit }),
    ).rejects.toThrow('GITHUB_TOKEN is invalid or expired')
  })

  it('throws a friendly message on 403 from createRelease', async () => {
    const assetPath = path.join(tmpDir, 'ai.zip')
    await writeFile(assetPath, 'fake zip')

    const octokit = {
      repos: {
        createRelease: vi.fn().mockRejectedValue(octokitError(403, 'Resource not accessible by integration')),
      },
    } as unknown as Octokit

    await expect(
      publishRelease({ owner: 'owner', repo: 'repo', tag: 'v1.0.0', assetPath, octokit }),
    ).rejects.toThrow('Token lacks write access to owner/repo')
  })

  it('throws a friendly message on 404 from createRelease', async () => {
    const assetPath = path.join(tmpDir, 'ai.zip')
    await writeFile(assetPath, 'fake zip')

    const octokit = {
      repos: {
        createRelease: vi.fn().mockRejectedValue(octokitError(404, 'Not Found')),
      },
    } as unknown as Octokit

    await expect(
      publishRelease({ owner: 'owner', repo: 'repo', tag: 'v1.0.0', assetPath, octokit }),
    ).rejects.toThrow('Repository owner/repo not found')
  })

  it('cleans up the draft and throws a friendly message when uploadReleaseAsset fails', async () => {
    const assetPath = path.join(tmpDir, 'ai.zip')
    await writeFile(assetPath, 'fake zip')

    const deleteRelease = vi.fn().mockResolvedValue({})
    const octokit = {
      repos: {
        createRelease: vi.fn().mockResolvedValue({ data: { id: 99, html_url: '' } }),
        uploadReleaseAsset: vi.fn().mockRejectedValue(
          octokitError(422, 'Validation Failed', [{ code: 'already_exists' }]),
        ),
        deleteRelease,
      },
    } as unknown as Octokit

    await expect(
      publishRelease({ owner: 'owner', repo: 'repo', tag: 'v1.0.0', assetPath, octokit }),
    ).rejects.toThrow('stale draft release')

    expect(deleteRelease).toHaveBeenCalledWith({ owner: 'owner', repo: 'repo', release_id: 99 })
  })

  it('surfaces a generic message for unexpected API errors', async () => {
    const assetPath = path.join(tmpDir, 'ai.zip')
    await writeFile(assetPath, 'fake zip')

    const octokit = {
      repos: {
        createRelease: vi.fn().mockRejectedValue(octokitError(500, 'Internal Server Error')),
      },
    } as unknown as Octokit

    await expect(
      publishRelease({ owner: 'owner', repo: 'repo', tag: 'v1.0.0', assetPath, octokit }),
    ).rejects.toThrow('GitHub API error (HTTP 500): Internal Server Error')
  })
})

describe('publishRelease', () => {
  it('calls createRelease with draft:true, then uploadReleaseAsset, then updateRelease with draft:false', async () => {
    const assetPath = path.join(tmpDir, 'ai.zip')
    await writeFile(assetPath, 'fake zip')

    const createRelease = vi.fn().mockResolvedValue({ data: { id: 42, html_url: '' } })
    const uploadReleaseAsset = vi.fn().mockResolvedValue({ data: {} })
    const updateRelease = vi.fn().mockResolvedValue({ data: { id: 42, html_url: 'https://github.com/owner/repo/releases/tag/v1.0.0' } })

    const octokit = makeMockOctokit({ createRelease, uploadReleaseAsset, updateRelease })

    await publishRelease({ owner: 'owner', repo: 'repo', tag: 'v1.0.0', assetPath, octokit })

    expect(createRelease).toHaveBeenCalledWith({
      owner: 'owner',
      repo: 'repo',
      tag_name: 'v1.0.0',
      draft: true,
    })
    expect(uploadReleaseAsset).toHaveBeenCalledWith(expect.objectContaining({
      owner: 'owner',
      repo: 'repo',
      release_id: 42,
      name: 'ai.zip',
    }))
    expect(updateRelease).toHaveBeenCalledWith({
      owner: 'owner',
      repo: 'repo',
      release_id: 42,
      draft: false,
    })
  })

  it('sequences calls in order: draft → upload asset → publish', async () => {
    const assetPath = path.join(tmpDir, 'ai.zip')
    await writeFile(assetPath, 'fake zip')

    const callOrder: string[] = []

    const octokit = {
      repos: {
        createRelease: vi.fn().mockImplementation(() => {
          callOrder.push('createRelease')
          return Promise.resolve({ data: { id: 1, html_url: '' } })
        }),
        uploadReleaseAsset: vi.fn().mockImplementation(() => {
          callOrder.push('uploadReleaseAsset')
          return Promise.resolve({ data: {} })
        }),
        updateRelease: vi.fn().mockImplementation(() => {
          callOrder.push('updateRelease')
          return Promise.resolve({ data: { id: 1, html_url: 'https://example.com' } })
        }),
      },
    } as unknown as Octokit

    await publishRelease({ owner: 'o', repo: 'r', tag: 'v1', assetPath, octokit })

    expect(callOrder).toEqual(['createRelease', 'uploadReleaseAsset', 'updateRelease'])
  })

  it('returns the release URL from the published release', async () => {
    const assetPath = path.join(tmpDir, 'ai.zip')
    await writeFile(assetPath, 'fake zip')

    const expectedUrl = 'https://github.com/owner/repo/releases/tag/v2.0.0'
    const octokit = makeMockOctokit({
      updateRelease: vi.fn().mockResolvedValue({ data: { id: 42, html_url: expectedUrl } }),
    })

    const url = await publishRelease({ owner: 'owner', repo: 'repo', tag: 'v2.0.0', assetPath, octokit })

    expect(url).toBe(expectedUrl)
  })
})

// ── Consumer path ─────────────────────────────────────────────────────────────

function makeAsset(name: string, url: string) {
  return { name, browser_download_url: url }
}

describe('fetchReleaseInfo', () => {
  it('resolves the latest release and surfaces the immutable flag', async () => {
    const octokit = {
      repos: {
        getLatestRelease: vi.fn().mockResolvedValue({
          data: { tag_name: 'v1.0.0', immutable: true, assets: [makeAsset('ai.zip', 'https://example.com/ai.zip')] },
        }),
      },
    } as unknown as Octokit

    const result = await fetchReleaseInfo('owner', 'repo', undefined, octokit)

    expect(result).toEqual({ tag: 'v1.0.0', assetDownloadUrl: 'https://example.com/ai.zip', immutable: true })
  })

  it('fetches a specific release when a tag is given', async () => {
    const octokit = {
      repos: {
        getReleaseByTag: vi.fn().mockResolvedValue({
          data: { tag_name: 'v2.0.0', immutable: false, assets: [makeAsset('ai.zip', 'https://example.com/v2/ai.zip')] },
        }),
      },
    } as unknown as Octokit

    const result = await fetchReleaseInfo('owner', 'repo', 'v2.0.0', octokit)

    expect(result).toEqual({ tag: 'v2.0.0', assetDownloadUrl: 'https://example.com/v2/ai.zip', immutable: false })
  })

  it('treats a missing immutable field as false', async () => {
    const octokit = {
      repos: {
        getLatestRelease: vi.fn().mockResolvedValue({
          data: { tag_name: 'v1.0.0', assets: [makeAsset('ai.zip', 'https://example.com/ai.zip')] },
        }),
      },
    } as unknown as Octokit

    const result = await fetchReleaseInfo('owner', 'repo', undefined, octokit)

    expect(result.immutable).toBe(false)
  })

  it('throws when no ai.zip asset is found in the release', async () => {
    const octokit = {
      repos: {
        getLatestRelease: vi.fn().mockResolvedValue({
          data: { tag_name: 'v1.0.0', immutable: true, assets: [makeAsset('other.zip', 'https://example.com/other.zip')] },
        }),
      },
    } as unknown as Octokit

    await expect(fetchReleaseInfo('owner', 'repo', undefined, octokit)).rejects.toThrow('No ai.zip asset found')
  })
})


describe('getImmutableReleasesStatus', () => {
  it('throws a friendly message on 401 — endpoint requires auth even for public repos', async () => {
    const authError = Object.assign(new Error('Requires authentication'), { status: 401 })
    const octokit = {
      request: vi.fn().mockRejectedValue(authError),
    } as unknown as Octokit

    await expect(getImmutableReleasesStatus('owner', 'repo', octokit)).rejects.toThrow('GITHUB_TOKEN')
  })
})

describe('downloadAsset', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns the response body as a Buffer', async () => {
    // Use Uint8Array so the backing ArrayBuffer is not a shared pool slice
    const expected = [102, 97, 107, 101]  // 'fake'
    const ab = new Uint8Array(expected).buffer

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: async () => ab,
    } as unknown as Response))

    const result = await downloadAsset('https://example.com/ai.zip')

    expect(Buffer.isBuffer(result)).toBe(true)
    expect(Array.from(result)).toEqual(expected)
  })

  it('throws on a non-OK HTTP response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      statusText: 'Not Found',
    } as unknown as Response))

    await expect(downloadAsset('https://example.com/ai.zip')).rejects.toThrow('HTTP 404')
  })
})
