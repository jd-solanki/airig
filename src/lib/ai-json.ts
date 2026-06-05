import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'

export interface PackageEntry {
  version: string
  linked: string[]
}

export interface AiJson {
  packages: Record<string, PackageEntry>
}

const AI_JSON_PATH = '.ai/ai.json'

function validate(data: unknown): AiJson {
  if (
    typeof data !== 'object' || data === null ||
    typeof (data as Record<string, unknown>).packages !== 'object' ||
    (data as Record<string, unknown>).packages === null
  ) {
    throw new Error(
      `${AI_JSON_PATH} is malformed: expected { "packages": {} }\n` +
      `  Fix: restore the missing top-level keys, or delete ${AI_JSON_PATH} to reset it.`,
    )
  }

  const packages: Record<string, PackageEntry> = {}
  for (const [key, rawEntry] of Object.entries((data as { packages: Record<string, unknown> }).packages)) {
    if (typeof rawEntry !== 'object' || rawEntry === null) {
      throw new Error(`${AI_JSON_PATH} is malformed: package "${key}" must be an object.`)
    }

    const entry = rawEntry as Record<string, unknown>
    if (typeof entry.version !== 'string' || entry.version.length === 0) {
      throw new Error(`${AI_JSON_PATH} is malformed: package "${key}" must have a version string.`)
    }
    if (key === '.' && entry.version !== '*') {
      throw new Error(`${AI_JSON_PATH} is malformed: local package "." must use version "*".`)
    }
    if (key !== '.' && entry.version === '*') {
      throw new Error(`${AI_JSON_PATH} is malformed: remote package "${key}" must use an exact version.`)
    }
    if (entry.linked !== undefined && (
      !Array.isArray(entry.linked) ||
      entry.linked.some(label => typeof label !== 'string' || label.length === 0)
    )) {
      throw new Error(`${AI_JSON_PATH} is malformed: package "${key}" linked must be a string array.`)
    }

    packages[key] = {
      version: entry.version,
      linked: entry.linked === undefined ? [] : [...entry.linked] as string[],
    }
  }

  return { packages }
}

export async function readAiJson(): Promise<AiJson> {
  if (!existsSync(AI_JSON_PATH)) {
    return { packages: {} }
  }
  const raw = await readFile(AI_JSON_PATH, 'utf-8')
  return validate(JSON.parse(raw))
}

export async function writeAiJson(data: AiJson): Promise<void> {
  await mkdir(path.dirname(AI_JSON_PATH), { recursive: true })
  await writeFile(AI_JSON_PATH, JSON.stringify(data, null, 2) + '\n', 'utf-8')
}

export async function updateAiJson(fn: (data: AiJson) => Promise<void> | void): Promise<void> {
  const data = await readAiJson()
  await fn(data)
  await writeAiJson(data)
}

export function addPackage(data: AiJson, key: string, entry: PackageEntry): void {
  data.packages[key] = entry
}

export function removePackage(data: AiJson, key: string): void {
  delete data.packages[key]
}

export function setLinked(data: AiJson, key: string, linked: string[]): void {
  if (!data.packages[key]) {
    throw new Error(`Package "${key}" is not installed.`)
  }
  data.packages[key].linked = [...new Set(linked)]
}

export function addLinked(data: AiJson, key: string, artifact: string): void {
  if (!data.packages[key]) {
    throw new Error(`Package "${key}" is not installed.`)
  }
  if (!data.packages[key].linked.includes(artifact)) {
    data.packages[key].linked.push(artifact)
  }
}

export function removeLinked(data: AiJson, key: string, artifact: string): void {
  if (!data.packages[key]) return
  data.packages[key].linked = data.packages[key].linked.filter(a => a !== artifact)
}
