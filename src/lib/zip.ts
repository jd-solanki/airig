import { ZipArchive } from 'archiver'
import { createWriteStream } from 'node:fs'
import path from 'node:path'

export function create(sourceDir: string, outputPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const output = createWriteStream(outputPath)
    const archive = new ZipArchive({ zlib: { level: 9 } })
    const sourceBaseName = path.basename(sourceDir)

    output.on('close', resolve)
    archive.on('error', reject)

    archive.pipe(output)
    archive.directory(sourceDir, sourceBaseName, entry => {
      if (entry.name === 'ai.json' && entry.prefix === sourceBaseName) return false
      return entry
    })
    archive.finalize()
  })
}
