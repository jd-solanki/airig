import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import extractZip from 'extract-zip'
import { create } from '../src/lib/zip.js'

let tmpDir: string

beforeEach(async () => {
  tmpDir = await mkdtemp(path.join(os.tmpdir(), 'ohmyai-zip-test-'))
})

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true })
})

describe('create', () => {
  it('produces a valid zip with expected files', async () => {
    const sourceDir = path.join(tmpDir, 'source')
    await mkdir(path.join(sourceDir, 'skills'), { recursive: true })
    await writeFile(path.join(sourceDir, 'ai.json'), '{}')
    await writeFile(path.join(sourceDir, 'skills', 'tdd.md'), '# TDD')

    const zipPath = path.join(tmpDir, 'test.zip')
    await create(sourceDir, zipPath)

    expect(existsSync(zipPath)).toBe(true)

    const extractDir = path.join(tmpDir, 'extracted')
    await mkdir(extractDir, { recursive: true })
    await extractZip(zipPath, { dir: extractDir })

    const baseName = path.basename(sourceDir)
    expect(existsSync(path.join(extractDir, baseName, 'ai.json'))).toBe(true)
    expect(existsSync(path.join(extractDir, baseName, 'skills', 'tdd.md'))).toBe(true)
  })

  it('roundtrip create→extract is lossless', async () => {
    const sourceDir = path.join(tmpDir, 'source')
    await mkdir(sourceDir, { recursive: true })
    const content = 'Hello, world! 🎉\nmultiline content\n'
    await writeFile(path.join(sourceDir, 'file.txt'), content)

    const zipPath = path.join(tmpDir, 'test.zip')
    await create(sourceDir, zipPath)

    const extractDir = path.join(tmpDir, 'extracted')
    await mkdir(extractDir, { recursive: true })
    await extractZip(zipPath, { dir: extractDir })

    const baseName = path.basename(sourceDir)
    const extracted = await readFile(path.join(extractDir, baseName, 'file.txt'), 'utf8')
    expect(extracted).toBe(content)
  })

  it('includes extraDirs in the same zip', async () => {
    const sourceDir = path.join(tmpDir, '.ai')
    const extraDir = path.join(tmpDir, '.ai.global')
    await mkdir(sourceDir, { recursive: true })
    await mkdir(extraDir, { recursive: true })
    await writeFile(path.join(sourceDir, 'ai.json'), '{}')
    await writeFile(path.join(extraDir, 'global.md'), '# global')

    const zipPath = path.join(tmpDir, 'test.zip')
    await create(sourceDir, zipPath, [extraDir])

    const extractDir = path.join(tmpDir, 'extracted')
    await mkdir(extractDir, { recursive: true })
    await extractZip(zipPath, { dir: extractDir })

    expect(existsSync(path.join(extractDir, '.ai', 'ai.json'))).toBe(true)
    expect(existsSync(path.join(extractDir, '.ai.global', 'global.md'))).toBe(true)
  })
})
