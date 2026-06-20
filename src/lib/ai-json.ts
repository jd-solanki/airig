import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { diagnostics } from '../diagnostics'

export interface PackageEntry {
  version: string
  linked: string[]
}

export interface AiJson {
  packages: Record<string, PackageEntry>
}

const AI_JSON_PATH = '.ai/ai.json'

function validate(data: unknown, aiJsonPath = AI_JSON_PATH): AiJson {
  if (
    typeof data !== 'object' || data === null ||
    typeof (data as Record<string, unknown>).packages !== 'object' ||
    (data as Record<string, unknown>).packages === null
  ) {
    throw diagnostics.AIRIG_C0003({ aiJsonPath })
  }

  const packages: Record<string, PackageEntry> = {}
  for (const [key, rawEntry] of Object.entries((data as { packages: Record<string, unknown> }).packages)) {
    if (typeof rawEntry !== 'object' || rawEntry === null) {
      throw diagnostics.AIRIG_C0004({ aiJsonPath, packageKey: key })
    }

    const entry = rawEntry as Record<string, unknown>
    if (typeof entry.version !== 'string' || entry.version.length === 0) {
      throw diagnostics.AIRIG_C0005({ aiJsonPath, packageKey: key })
    }
    if (key === '.' && entry.version !== '*') {
      throw diagnostics.AIRIG_C0006({ aiJsonPath })
    }
    if (entry.linked !== undefined && (
      !Array.isArray(entry.linked) ||
      entry.linked.some(label => typeof label !== 'string' || label.length === 0)
    )) {
      throw diagnostics.AIRIG_C0007({ aiJsonPath, packageKey: key })
    }

    packages[key] = {
      version: entry.version,
      linked: entry.linked === undefined ? [] : [...entry.linked] as string[],
    }
  }

  return { packages }
}

export async function readAiJson(aiJsonPath = AI_JSON_PATH): Promise<AiJson> {
  if (!existsSync(aiJsonPath)) {
    return { packages: {} }
  }
  const raw = await readFile(aiJsonPath, 'utf-8')
  return validate(parseAiJson(raw, aiJsonPath), aiJsonPath)
}

export async function writeAiJson(data: AiJson, aiJsonPath = AI_JSON_PATH): Promise<void> {
  await mkdir(path.dirname(aiJsonPath), { recursive: true })
  await writeFile(aiJsonPath, JSON.stringify(data, null, 2) + '\n', 'utf-8')
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
    throw diagnostics.AIRIG_R0001({ packageKey: key })
  }
  data.packages[key].linked = [...new Set(linked)]
}

export function addLinked(data: AiJson, key: string, artifact: string): void {
  if (!data.packages[key]) {
    throw diagnostics.AIRIG_R0001({ packageKey: key })
  }
  if (!data.packages[key].linked.includes(artifact)) {
    data.packages[key].linked.push(artifact)
  }
}

export function removeLinked(data: AiJson, key: string, artifact: string): void {
  if (!data.packages[key]) return
  data.packages[key].linked = data.packages[key].linked.filter(a => a !== artifact)
}

function parseAiJson(raw: string, aiJsonPath: string): unknown {
  try {
    return JSON.parse(raw)
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    throw diagnostics.AIRIG_C0008({ aiJsonPath, detail, cause: err })
  }
}
