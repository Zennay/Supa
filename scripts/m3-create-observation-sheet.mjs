import { lstat, mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { privateM3OutputFailure } from './m3-source-output-preservation.mjs'

import { buildObservationSheet } from '../src/domain/m3ObservationSheet.ts'

export { buildObservationSheet } from '../src/domain/m3ObservationSheet.ts'

/**
 * Reject symbolic ancestors before and after creating private parent folders.
 * Existing 0700/0600 and exclusive 'wx' semantics remain unchanged. This
 * protects normal operator paths, not an atomic guarantee against hostile
 * concurrent filesystem rewrites (handled in a separate issue).
 */
async function requireRealDirectoryParents(outputPath, allowMissing = false) {
  let directory = dirname(resolve(outputPath))
  for (;;) {
    try {
      const metadata = await lstat(directory)
      if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
        throw new Error('Private M3 output directory ancestry is not a real directory')
      }
    } catch (error) {
      if (!(allowMissing && error?.code === 'ENOENT')) throw error
    }
    const parent = dirname(directory)
    if (directory === parent) break
    directory = parent
  }
}

function validOutputArg(value) {
  if (typeof value !== 'string') return false

  const trimmed = value.trim()
  return Boolean(trimmed) && trimmed === value && !trimmed.startsWith('-')
}

function parseArgs(argv) {
  if (argv.length === 0) return { output: null }
  if (argv.length === 2 && argv[0] === '--output' && validOutputArg(argv[1])) {
    return { output: argv[1] }
  }
  throw new Error(
    'usage: m3:create-observation-sheet [--output observation-sheet.json]',
  )
}

export async function main(argv = process.argv.slice(2)) {
  const { output } = parseArgs(argv)
  const serialized = `${JSON.stringify(buildObservationSheet(), null, 2)}\n`

  if (output) {
    try {
      // Resolve the destination only once, and inspect every existing parent
      // without following a symlink. Recheck after mkdir before publishing.
      const destination = resolve(output)
      await requireRealDirectoryParents(destination, true)
      await mkdir(dirname(destination), { recursive: true, mode: 0o700 })
      await requireRealDirectoryParents(destination)
      await writeFile(destination, serialized, {
        encoding: 'utf8',
        flag: 'wx',
        mode: 0o600,
      })
    } catch (error) {
      if (error !== null && typeof error === 'object' &&
          'code' in error && error.code === 'EEXIST') {
        // Keep the no-clobber reason without revealing a private basename.
        throw new Error('refusing to overwrite existing observation sheet')
      }
      throw privateM3OutputFailure(error)
    }
  } else {
    process.stdout.write(serialized)
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
}
