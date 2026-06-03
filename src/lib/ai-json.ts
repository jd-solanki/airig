import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'

export interface PackageEntry {
  version: string
  exclude?: string[]
}

export interface AiJson {
  packages: Record<string, PackageEntry>
  ownership: Record<string, string>
}

const AI_JSON_PATH = '.ai/ai.json'

function validate(data: unknown): AiJson {
  if (
    typeof data !== 'object' || data === null ||
    typeof (data as Record<string, unknown>).packages !== 'object' ||
    typeof (data as Record<string, unknown>).ownership !== 'object'
  ) {
    throw new Error(
      `${AI_JSON_PATH} is malformed: expected { "packages": {}, "ownership": {} }\n` +
      `  Fix: restore the missing top-level keys, or delete ${AI_JSON_PATH} to reset it.`,
    )
  }
  return data as AiJson
}

export async function readAiJson(): Promise<AiJson> {
  if (!existsSync(AI_JSON_PATH)) {
    return { packages: {}, ownership: {} }
  }
  const raw = await readFile(AI_JSON_PATH, 'utf-8')
  return validate(JSON.parse(raw))
}

export async function writeAiJson(data: AiJson): Promise<void> {
  await mkdir(path.dirname(AI_JSON_PATH), { recursive: true })
  await writeFile(AI_JSON_PATH, JSON.stringify(data, null, 2) + '\n', 'utf-8')
}

export function addPackage(data: AiJson, key: string, entry: PackageEntry): void {
  data.packages[key] = entry
}

export function removePackage(data: AiJson, key: string): void {
  delete data.packages[key]
}

export function addOwnership(data: AiJson, targetPath: string, value: string): void {
  data.ownership[targetPath] = value
}

export function removeOwnership(data: AiJson, targetPath: string): void {
  delete data.ownership[targetPath]
}
