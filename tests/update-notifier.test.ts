import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { isVersionGreater, maybeNotifyForUpdate } from '../src/lib/update-notifier.js'

let tmpDir: string

beforeEach(async () => {
  tmpDir = await mkdtemp(path.join(os.tmpdir(), 'airig-update-notifier-test-'))
})

afterEach(async () => {
  vi.restoreAllMocks()
  await rm(tmpDir, { recursive: true, force: true })
})

async function writeJson(filePath: string, data: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true })
  await writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`)
}

function ttyStderr() {
  return {
    isTTY: true,
    write: vi.fn(),
  }
}

describe('maybeNotifyForUpdate', () => {
  it('prints a cached global update notice and marks the daily check before spawning a background refresh', async () => {
    const packageJsonPath = path.join(tmpDir, 'global', 'lib', 'node_modules', '@airig', 'cli', 'package.json')
    const stateDir = path.join(tmpDir, 'state')
    await writeJson(packageJsonPath, { name: '@airig/cli', version: '0.0.1' })
    await writeJson(path.join(stateDir, 'update-notifier.json'), {
      lastUpdateCheck: 'Sun, 07 Jun 2026 09:00:00 GMT',
      latestVersion: '0.0.3',
    })

    const stderr = ttyStderr()
    const spawnUpdateCheck = vi.fn()

    maybeNotifyForUpdate({
      now: new Date('2026-06-08T10:00:00Z'),
      packageJsonPath,
      stateDir,
      stderr,
      env: {},
      cwd: tmpDir,
      spawnUpdateCheck,
    })

    expect(spawnUpdateCheck).toHaveBeenCalledWith(path.join(stateDir, 'update-notifier.json'))
    expect(stderr.write).toHaveBeenCalledWith(expect.stringContaining('A new airig version is available: 0.0.1 -> 0.0.3.'))
    expect(stderr.write).toHaveBeenCalledWith(expect.stringContaining('Please upgrade to the latest version.'))

    const state = JSON.parse(await readFile(path.join(stateDir, 'update-notifier.json'), 'utf8')) as {
      lastUpdateCheck?: string
      latestVersion?: string
      lastNotifiedAt?: string
    }
    expect(state).toEqual({
      lastUpdateCheck: 'Mon, 08 Jun 2026 10:00:00 GMT',
      latestVersion: '0.0.3',
      lastNotifiedAt: 'Mon, 08 Jun 2026 10:00:00 GMT',
    })
  })

  it('does not spawn a background refresh when the daily check is not due', async () => {
    const packageJsonPath = path.join(tmpDir, 'global', 'lib', 'node_modules', '@airig', 'cli', 'package.json')
    const stateDir = path.join(tmpDir, 'state')
    await writeJson(packageJsonPath, { name: '@airig/cli', version: '0.0.1' })
    await writeJson(path.join(stateDir, 'update-notifier.json'), {
      lastUpdateCheck: 'Mon, 08 Jun 2026 09:00:00 GMT',
      latestVersion: '0.0.3',
    })

    const spawnUpdateCheck = vi.fn()

    maybeNotifyForUpdate({
      now: new Date('2026-06-08T10:00:00Z'),
      packageJsonPath,
      stateDir,
      stderr: ttyStderr(),
      env: {},
      cwd: tmpDir,
      spawnUpdateCheck,
    })

    expect(spawnUpdateCheck).not.toHaveBeenCalled()
  })

  it('skips project-local installs', async () => {
    const projectRoot = path.join(tmpDir, 'project')
    const packageJsonPath = path.join(
      projectRoot,
      'node_modules',
      '.pnpm',
      '@airig+cli@0.0.1',
      'node_modules',
      '@airig',
      'cli',
      'package.json',
    )
    await writeJson(path.join(projectRoot, 'package.json'), {
      devDependencies: { '@airig/cli': '0.0.1' },
    })
    await writeJson(packageJsonPath, { name: '@airig/cli', version: '0.0.1' })

    const stderr = ttyStderr()
    const spawnUpdateCheck = vi.fn()

    maybeNotifyForUpdate({
      packageJsonPath,
      stateDir: path.join(tmpDir, 'state'),
      stderr,
      env: {},
      cwd: projectRoot,
      spawnUpdateCheck,
    })

    expect(spawnUpdateCheck).not.toHaveBeenCalled()
    expect(stderr.write).not.toHaveBeenCalled()
  })

  it('skips one-off npx installs', async () => {
    const packageJsonPath = path.join(tmpDir, '.npm', '_npx', '123', 'node_modules', '@airig', 'cli', 'package.json')
    await writeJson(packageJsonPath, { name: '@airig/cli', version: '0.0.1' })

    const stderr = ttyStderr()
    const spawnUpdateCheck = vi.fn()

    maybeNotifyForUpdate({
      packageJsonPath,
      stateDir: path.join(tmpDir, 'state'),
      stderr,
      env: {},
      cwd: tmpDir,
      spawnUpdateCheck,
    })

    expect(spawnUpdateCheck).not.toHaveBeenCalled()
    expect(stderr.write).not.toHaveBeenCalled()
  })

  it('skips notifications in non-interactive and automated environments', async () => {
    const packageJsonPath = path.join(tmpDir, 'global', 'lib', 'node_modules', '@airig', 'cli', 'package.json')
    await writeJson(packageJsonPath, { name: '@airig/cli', version: '0.0.1' })

    const spawnUpdateCheck = vi.fn()

    maybeNotifyForUpdate({
      packageJsonPath,
      stateDir: path.join(tmpDir, 'state'),
      stderr: { isTTY: false, write: vi.fn() },
      env: {},
      spawnUpdateCheck,
    })
    maybeNotifyForUpdate({
      packageJsonPath,
      stateDir: path.join(tmpDir, 'state'),
      stderr: ttyStderr(),
      env: { CI: 'true' },
      spawnUpdateCheck,
    })

    expect(spawnUpdateCheck).not.toHaveBeenCalled()
  })
})

describe('isVersionGreater', () => {
  it('compares semver releases and prereleases', () => {
    expect(isVersionGreater('0.0.2', '0.0.1')).toBe(true)
    expect(isVersionGreater('1.0.0', '1.0.0-beta.1')).toBe(true)
    expect(isVersionGreater('1.0.0-beta.1', '1.0.0')).toBe(false)
    expect(isVersionGreater('1.0.0', '1.0.0')).toBe(false)
  })
})
