#!/usr/bin/env node
/**
 * Local, offline CSV -> Supa's existing supa-offline-prices-v1 JSON import.
 * No retailer HTTP, credentials, auto-captured dates or generated prices.
 */
import { open, writeFile } from 'node:fs/promises'
import { constants } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { convertTwoStoreCsv } from '../public/offline-two-store-csv.mjs'

const MAX_BYTES = 256_000
const error = (message) => { throw new Error(message) }

/** Read the opened inode, not a pathname that can become a symlink after lstat. */
async function readPrivateCsv(path) {
  // SUPA's offline CLI runs on the supported POSIX/Node environment; reject
  // platforms where we cannot promise a no-follow open for private input.
  if (!Number.isInteger(constants.O_NOFOLLOW)) {
    error('Veilig openen van privé-CSV wordt niet ondersteund op dit systeem.')
  }
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    const stat = await handle.stat()
    if (!stat.isFile() || stat.size <= 0 || stat.size > MAX_BYTES) {
      error('CSV moet een regulier bestand van maximaal 256 kB zijn.')
    }
    const bytes = await handle.readFile()
    // Refuse an input modified while reading rather than importing a silent
    // partial/oversized capture from another process.
    if (bytes.length === 0 || bytes.length > MAX_BYTES) {
      error('CSV is leeg of groter dan 256 kB.')
    }
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } finally {
    await handle.close()
  }
}


async function main() {
  if (process.argv.length !== 4 || process.argv[2].startsWith('-') || process.argv[3].startsWith('-')) {
    error('Gebruik: node scripts/offline-two-store-csv-to-json.mjs waarnemingen.csv uitvoer.json')
  }
  const source = resolve(process.argv[2])
  const target = resolve(process.argv[3])
  if (source === target) error('Invoer en uitvoer moeten verschillende bestanden zijn.')
  const csv = await readPrivateCsv(source)
  const json = convertTwoStoreCsv(csv)
  const captures = JSON.parse(json).captures
  // The operator receives only row counts, never private names, amounts,
  // prices, source URLs, participant identities or an implied license.
  const counts = captures.map(capture => capture.retailer + ': ' + capture.products.length)
  await writeFile(target, json, { encoding: 'utf8', flag: 'wx', mode: 0o600 })
  process.stdout.write('Privé CSV omgezet (' + counts.join(', ') + '). Importeer JSON in Supa → Vergelijk. Geen openbare prijsclaim.\\n')
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(() => {
    process.stderr.write('Import mislukt: controleer bestand, CSV-kolommen, expliciete tijden en ontbrekende waarden. Bestaand uitvoerbestand wordt niet overschreven.\n')
    process.exitCode = 1
  })
}
