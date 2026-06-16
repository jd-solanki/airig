import { existsSync, realpathSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export interface ScopeOptions {
  global?: boolean
}

export interface SetupScope {
  aiJsonPath: string
  sourceRoot: string
  targetRoot: string
  sourcePrefix: string
  manifestLabel: string
}

export function resolveSetupScope(options: ScopeOptions = {}): SetupScope {
  if (!options.global) return projectSetupScope()

  const globalRoot = globalSetupRoot()
  return {
    aiJsonPath: path.join(globalRoot, 'ai.json'),
    sourceRoot: globalRoot,
    targetRoot: globalRoot,
    sourcePrefix: globalRoot,
    manifestLabel: '~/.ai/ai.json',
  }
}

export function projectSetupScope(): SetupScope {
  return {
    aiJsonPath: path.join('.ai', 'ai.json'),
    sourceRoot: '.ai',
    targetRoot: '.',
    sourcePrefix: '.ai',
    manifestLabel: '.ai/ai.json',
  }
}

export function globalSetupRoot(): string {
  return path.join(os.homedir(), '.ai')
}

export function globalLocalSourceRoot(globalRoot = globalSetupRoot()): string {
  return path.join(globalLocalSourceRepoRoot(globalRoot), '.ai')
}

export function globalLocalSourceRepoRoot(globalRoot = globalSetupRoot()): string {
  return preferLogicalPath(process.cwd(), globalSetupWorkspaceRoot(globalRoot))
}

export function globalLocalPackageKey(globalRoot = globalSetupRoot()): string {
  return path.relative(globalRoot, globalLocalSourceRepoRoot(globalRoot))
}

function globalSetupWorkspaceRoot(globalRoot: string): string {
  return path.dirname(path.dirname(globalRoot))
}

function preferLogicalPath(filePath: string, logicalRoot: string): string {
  const realLogicalRoot = realPathIfExists(logicalRoot)
  if (!realLogicalRoot) return filePath

  // macOS can report cwd through /private/var while os.tmpdir()/homedir()
  // use /var; manifests should keep the user's visible path stable.
  const realFilePath = realPathIfExists(filePath) ?? path.resolve(filePath)
  const relativeFromRealRoot = path.relative(realLogicalRoot, realFilePath)
  if (relativeFromRealRoot.startsWith('..') || path.isAbsolute(relativeFromRealRoot)) {
    return filePath
  }

  return path.join(logicalRoot, relativeFromRealRoot)
}

function realPathIfExists(filePath: string): string | undefined {
  if (!existsSync(filePath)) return undefined
  return realpathSync(filePath)
}
