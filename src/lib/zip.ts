import archiver from 'archiver'
import { createWriteStream } from 'node:fs'
import path from 'node:path'

export function create(sourceDir: string, outputPath: string, extraDirs?: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const output = createWriteStream(outputPath)
    const archive = archiver('zip', { zlib: { level: 9 } })

    output.on('close', resolve)
    archive.on('error', reject)

    archive.pipe(output)
    archive.directory(sourceDir, path.basename(sourceDir))
    for (const dir of extraDirs ?? []) {
      archive.directory(dir, path.basename(dir))
    }
    archive.finalize()
  })
}
