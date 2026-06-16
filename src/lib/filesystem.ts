import { lstat } from 'node:fs/promises'

export type FileStat = Awaited<ReturnType<typeof lstat>>

export async function lstatIfExists(filePath: string): Promise<FileStat | undefined> {
  try {
    return await lstat(filePath)
  } catch {
    return undefined
  }
}
