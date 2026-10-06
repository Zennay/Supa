import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { pathToFileURL } from 'node:url'

import { buildObservationSheet } from '../src/domain/m3ObservationSheet.ts'

export { buildObservationSheet } from '../src/domain/m3ObservationSheet.ts'

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
    await mkdir(dirname(output), { recursive: true })
    try {
      await writeFile(output, serialized, { encoding: 'utf8', flag: 'wx' })
    } catch (error) {
      if (
        error !== null &&
        typeof error === 'object' &&
        'code' in error &&
        error.code === 'EEXIST'
      ) {
        throw new Error(
          `refusing to overwrite existing observation sheet: ${output}`,
        )
      }
      throw error
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
