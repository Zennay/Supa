#!/usr/bin/env node
/**
 * Local, offline CSV -> Supa's existing supa-offline-prices-v1 JSON import.
 * No retailer HTTP, credentials, auto-captured dates or generated prices.
 */
import { readFile, writeFile, lstat } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { convertTwoStoreCsv } from '../public/offline-two-store-csv.mjs'

async function main() {
  if (process.argv.length !== 4 || process.argv[2].startsWith('-') || process.argv[3].startsWith('-')) {
    error('Gebruik: node scripts/offline-two-store-csv-to-json.mjs waarnemingen.csv uitvoer.json')
  }
  const source = resolve(process.argv[2])
  const target = resolve(process.argv[3])
  if (source === target) error('Invoer en uitvoer moeten verschillende bestanden zijn.')
  const stat = await lstat(source)
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_BYTES) {
    error('CSV moet een regulier bestand van maximaal 256 kB zijn.')
  }
  const input = await readFile(source)
  const decoder = new TextDecoder('utf-8', { fatal: true })
  const json = convertTwoStoreCsv(decoder.decode(input))
  await writeFile(target, json, { encoding: 'utf8', flag: 'wx', mode: 0o600 })
  process.stdout.write('Twee lokale winkelopnames omgezet. Importeer JSON in Supa → Vergelijk.\n')
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(() => {
    process.stderr.write('Import mislukt: controleer bestand, CSV-kolommen, expliciete tijden en ontbrekende waarden. Bestaand uitvoerbestand wordt niet overschreven.\n')
    process.exitCode = 1
  })
}
