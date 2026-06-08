import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { spawn } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const PACKAGE_NAME = '@airig/cli'
const UPDATE_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000
const UPDATE_NOTIFICATION_INTERVAL_MS = 24 * 60 * 60 * 1000
const REGISTRY_LATEST_URL = 'https://registry.npmjs.org/@airig%2fcli/latest'

interface UpdateState {
  lastUpdateCheck?: string
  latestVersion?: string
  lastNotifiedAt?: string
}

export interface NotifyForUpdateOptions {
  now?: Date
  packageJsonPath?: string
  stateDir?: string
  stderr?: Pick<typeof process.stderr, 'isTTY' | 'write'>
  env?: NodeJS.ProcessEnv
  cwd?: string
  spawnUpdateCheck?: (statePath: string) => void
}

export function maybeNotifyForUpdate(options: NotifyForUpdateOptions = {}): void {
  const env = options.env ?? process.env
  const stderr = options.stderr ?? process.stderr
  if (shouldSkipUpdateNotifier(env, stderr)) return

  const packageJsonPath = options.packageJsonPath ?? findOwnPackageJsonPath()
  const packageRoot = path.dirname(packageJsonPath)
  if (!isGlobalInstall(packageRoot, options.cwd ?? process.cwd())) return

  const now = options.now ?? new Date()
  const currentVersion = readPackageVersion(packageJsonPath)
  const statePath = path.join(options.stateDir ?? defaultStateDir(env), 'update-notifier.json')
  let state = readUpdateState(statePath)

  if (isUpdateCheckDue(state, now)) {
    state = { ...state, lastUpdateCheck: now.toUTCString() }
    writeUpdateState(statePath, state)
    ;(options.spawnUpdateCheck ?? spawnUpdateCheck)(statePath)
  }

  if (!state.latestVersion || !isVersionGreater(state.latestVersion, currentVersion)) return
  if (!isNotificationDue(state, now)) return

  stderr.write(formatUpdateMessage({
    currentVersion,
    latestVersion: state.latestVersion,
  }))

  writeUpdateState(statePath, { ...state, lastNotifiedAt: now.toUTCString() })
}

function shouldSkipUpdateNotifier(env: NodeJS.ProcessEnv, stderr: Pick<typeof process.stderr, 'isTTY'>): boolean {
  return Boolean(
    env.NO_UPDATE_NOTIFIER ||
    env.AIRIG_NO_UPDATE_NOTIFIER ||
    env.CI ||
    env.NODE_ENV === 'test' ||
    !stderr.isTTY,
  )
}

function readPackageVersion(packageJsonPath: string): string {
  const parsed = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as { version?: string }

  if (!parsed.version) {
    throw new Error(`Could not read ${PACKAGE_NAME} version from ${packageJsonPath}`)
  }

  return parsed.version
}

function defaultStateDir(env: NodeJS.ProcessEnv): string {
  if (env.AIRIG_STATE_DIR) return env.AIRIG_STATE_DIR
  if (env.XDG_STATE_HOME) return path.join(env.XDG_STATE_HOME, 'airig')
  return path.join(os.homedir(), '.local', 'state', 'airig')
}

function readUpdateState(statePath: string): UpdateState {
  try {
    return JSON.parse(readFileSync(statePath, 'utf8')) as UpdateState
  } catch {
    return {}
  }
}

function writeUpdateState(statePath: string, state: UpdateState): void {
  mkdirSync(path.dirname(statePath), { recursive: true })
  writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`)
}

function isUpdateCheckDue(state: UpdateState, now: Date): boolean {
  return isIntervalDue(state.lastUpdateCheck, now, UPDATE_CHECK_INTERVAL_MS)
}

function isNotificationDue(state: UpdateState, now: Date): boolean {
  return isIntervalDue(state.lastNotifiedAt, now, UPDATE_NOTIFICATION_INTERVAL_MS)
}

function isIntervalDue(previous: string | undefined, now: Date, intervalMs: number): boolean {
  if (!previous) return true
  const previousTime = new Date(previous).valueOf()
  if (Number.isNaN(previousTime)) return true
  return now.valueOf() - previousTime >= intervalMs
}

function spawnUpdateCheck(statePath: string): void {
  const child = spawn(process.execPath, ['--input-type=module', '--eval', UPDATE_CHECK_SCRIPT], {
    detached: true,
    stdio: 'ignore',
    env: {
      ...process.env,
      AIRIG_UPDATE_STATE_PATH: statePath,
      AIRIG_UPDATE_REGISTRY_URL: REGISTRY_LATEST_URL,
    },
  })
  child.unref()
}

const UPDATE_CHECK_SCRIPT = `
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

const statePath = process.env.AIRIG_UPDATE_STATE_PATH
const registryUrl = process.env.AIRIG_UPDATE_REGISTRY_URL
const now = new Date().toUTCString()

async function readState() {
  try {
    return JSON.parse(await readFile(statePath, 'utf8'))
  } catch {
    return {}
  }
}

async function writeState(state) {
  await mkdir(path.dirname(statePath), { recursive: true })
  await writeFile(statePath, JSON.stringify(state, null, 2) + '\\n')
}

const state = await readState()

try {
  const response = await fetch(registryUrl, { signal: AbortSignal.timeout(3000) })
  const data = response.ok ? await response.json() : undefined
  await writeState({ ...state, lastUpdateCheck: now, latestVersion: data?.version ?? state.latestVersion })
} catch {
  await writeState({ ...state, lastUpdateCheck: now })
}
`

export function isVersionGreater(candidate: string, current: string): boolean {
  const candidateVersion = parseSemver(candidate)
  const currentVersion = parseSemver(current)
  if (!candidateVersion || !currentVersion) return candidate !== current

  for (let i = 0; i < 3; i += 1) {
    const diff = candidateVersion.numbers[i] - currentVersion.numbers[i]
    if (diff !== 0) return diff > 0
  }

  if (candidateVersion.prerelease === currentVersion.prerelease) return false
  if (!candidateVersion.prerelease) return Boolean(currentVersion.prerelease)
  if (!currentVersion.prerelease) return false

  return candidateVersion.prerelease.localeCompare(currentVersion.prerelease, undefined, { numeric: true }) > 0
}

function parseSemver(version: string): { numbers: [number, number, number]; prerelease: string } | undefined {
  const match = version.trim().match(/^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/)
  if (!match) return undefined
  return {
    numbers: [Number(match[1]), Number(match[2]), Number(match[3])],
    prerelease: match[4] ?? '',
  }
}

function isGlobalInstall(packageRoot: string, cwd: string): boolean {
  if (isOneOffInstallPath(packageRoot)) return false
  if (findProjectRootForLocalInstall(packageRoot, cwd)) return false

  return true
}

function findOwnPackageJsonPath(): string {
  let currentDir = path.dirname(fileURLToPath(import.meta.url))

  while (true) {
    const candidate = path.join(currentDir, 'package.json')
    try {
      const manifest = JSON.parse(readFileSync(candidate, 'utf8')) as { name?: string }
      if (manifest.name === PACKAGE_NAME) return candidate
    } catch {}

    const parentDir = path.dirname(currentDir)
    if (parentDir === currentDir) break
    currentDir = parentDir
  }

  throw new Error(`Could not locate ${PACKAGE_NAME} package metadata`)
}

function isOneOffInstallPath(packageRoot: string): boolean {
  const normalizedRoot = packageRoot.split(path.sep).join('/')
  return normalizedRoot.includes('/_npx/') || normalizedRoot.includes('/.npm/_npx/')
}

function findProjectRootForLocalInstall(packageRoot: string, cwd: string): string | undefined {
  const segments = packageRoot.split(path.sep)

  for (let index = segments.length - 1; index > 0; index -= 1) {
    if (segments[index] !== 'node_modules') continue

    const projectRoot = segments.slice(0, index).join(path.sep) || path.sep
    if (existsSync(path.join(projectRoot, 'package.json')) && isSameOrInside(cwd, projectRoot)) return projectRoot
  }

  return undefined
}

function isSameOrInside(candidate: string, parent: string): boolean {
  const relative = path.relative(parent, candidate)
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}

function formatUpdateMessage(opts: {
  currentVersion: string
  latestVersion: string
}): string {
  return (
    `\nA new airig version is available: ${opts.currentVersion} -> ${opts.latestVersion}.\n` +
    `Your installed airig package is outdated. Please upgrade to the latest version.\n\n`
  )
}
