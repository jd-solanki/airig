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

export async function readAiJson(): Promise<AiJson> {
  if (!existsSync(AI_JSON_PATH)) {
    return { packages: {}, ownership: {} }
  }
  const raw = await readFile(AI_JSON_PATH, 'utf-8')
  return JSON.parse(raw) as AiJson
}

export async function writeAiJson(data: AiJson): Promise<void> {
  await mkdir(path.dirname(AI_JSON_PATH), { recursive: true })
  await writeFile(AI_JSON_PATH, JSON.stringify(data, null, 2) + '\n', 'utf-8')
}
