#!/usr/bin/env node
/**
 * Local, offline CSV -> Supa's existing supa-offline-prices-v1 JSON import.
 * No retailer HTTP, credentials, auto-captured dates or generated prices.
 */
import { open, writeFile } from 'node:fs/promises'
import { constants } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { convertTwoStoreCsv, convertOwnStoreCsv } from '../public/offline-two-store-csv.mjs'
import { offlinePriceJsonToCsv } from './offline-private-prices-json-to-csv.mjs'

const MAX_BYTES = 256_000
const error = (message) => { throw new Error(message) }

/** Read the opened inode, not a pathname that can become a symlink after lstat. */
export async function readPrivateCsv(path) {
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

/**
 * Normalize two independent owned CSV/TSV/JSON files through the SAME strict
 * one-store converter before composing their canonical two-store CSV. Excel
 * semicolon, TSV and comma exports may differ. Neither store may be fabricated or copied
 * under the other retailer ID; unknowns remain null, not zero prices.
 */
export function joinPrivateStoreCsv(first, second) {
  const oneStore = (raw) => {
    if (typeof raw !== 'string') error('Eigen winkelbron moet een tekstbestand zijn.')
    const source = raw.replace(/^\uFEFF/u, '')
    const csv = source.trimStart().startsWith('{')
      ? offlinePriceJsonToCsv(source) : source
    // Original, canonical CSV intake, including exact recorded source facts.
    return JSON.parse(convertOwnStoreCsv(csv))
  }
  const one = oneStore(first)
  const two = oneStore(second)
  if (one.captures.length !== 1 || two.captures.length !== 1 ||
      one.captures[0].retailer !== 'PLUS' ||
      two.captures[0].retailer !== 'DekaMarkt') {
    error('Gebruik één echte PLUS- en één DekaMarkt-opname, geen twee keer dezelfde winkel.')
  }
  const composed = { schema: 'supa-offline-prices-v1',
    captures: [...one.captures, ...two.captures] }
  // The existing reverse adapter preserves exact source IDs, packaging,
  // original timestamps and absent prices. Its 256 kB bound is mandatory.
  const csv = offlinePriceJsonToCsv(JSON.stringify(composed))
  // Keep the original two-store admission as the final authority.
  convertTwoStoreCsv(csv)
  return csv
}

/**
 * Product-facing, non-sensitive facts for the operator, not proof of
 * authorised access, published prices or matching with a selected week.
 */
function localCaptureGuidance(captures) {
  const now = Date.now()
  const instants = captures.map(item => Date.parse(item.observedAt))
  const details = captures.map(item => {
    const usable = item.products.filter(product =>
      product.available === true && Number.isSafeInteger(product.priceCents) &&
      product.priceCents >= 0 && product.packAmount !== null &&
      (product.packCount ?? 1) > 0).length
    return item.retailer + ': ' + usable + ' van ' + item.products.length +
      ' producten met bruikbare eigen prijs; ' + (item.products.length - usable) +
      ' niet prijsbaar'
  })
  const warnings = []
  if (instants.some(time => !Number.isFinite(time) || time > now)) {
    warnings.push('Een opnametijd ligt in de toekomst; controleer datum en UTC-offset.')
  }
  if (instants.some(time => Number.isFinite(time) && now - time > 7 * 24 * 60 * 60 * 1000)) {
    warnings.push('Een winkelopname is ouder dan 7 dagen; ververs de echte brondata.')
  }
  if (instants.length === 2 && instants.every(Number.isFinite) &&
      Math.abs(instants[0] - instants[1]) > 24 * 60 * 60 * 1000) {
    warnings.push('De twee winkeltijden liggen meer dan 24 uur uiteen.')
  }
  return [...details, ...warnings]
}

async function main() {
  const args = process.argv.slice(2)
  const pairing = args[0] === '--pair'
  const single = args[0] === '--single'
  const names = pairing || single ? args.slice(1) : args
  if ((!pairing && names.length !== 2) || (pairing && names.length !== 3) ||
      names.some(name => !name || name.startsWith('-'))) {
    error('Gebruik: node scripts/offline-two-store-csv-to-json.mjs samen.csv uitvoer.json ' +
      'of --pair plus.csv deka.json uitvoer.json of --single een-winkel.csv uitvoer.json')
  }
  const sources = names.slice(0, -1).map(resolve)
  const target = resolve(names.at(-1))
  if (new Set([...sources, target]).size !== sources.length + 1) {
    error('Invoerbestanden en uitvoerbestand moeten verschillende paden zijn.')
  }
  const texts = await Promise.all(sources.map(readPrivateCsv))
  const csv = pairing ? joinPrivateStoreCsv(texts[0], texts[1]) : texts[0]
  // Keep the one existing converter as the only authority for captured-at
  // timestamps, SKU uniqueness and physical prices. `--single` does not
  // manufacture a second store or relax the two-store default mode.
  const json = single ? convertOwnStoreCsv(csv) : convertTwoStoreCsv(csv)
  const captures = JSON.parse(json).captures
  if (single && captures.length !== 1) error('Geef exact één winkelopname bij --single.')
  // The operator receives only row counts, never private names, amounts,
  // prices, source URLs, participant identities or an implied license.
  const counts = captures.map(capture => capture.retailer + ': ' + capture.products.length)
  await writeFile(target, json, { encoding: 'utf8', flag: 'wx', mode: 0o600 })
  process.stdout.write('Privé CSV omgezet (' + counts.join(', ') + '). Importeer JSON in Supa → Vergelijk. Geen openbare prijsclaim.\n' +
    localCaptureGuidance(captures).join('\n') + '\n' +
    (single ? 'Tweede winkel ontbreekt: prijsverschil onbekend tot eigen tweede bron is ingelezen.\n' : '') +
    'Prijsverschil en ontbrekende productmatches zijn pas in de gekozen Supa-week te beoordelen.\n')
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(() => {
    process.stderr.write('Import mislukt: controleer bestand, CSV-kolommen, expliciete tijden en ontbrekende waarden. Bestaand uitvoerbestand wordt niet overschreven.\n')
    process.exitCode = 1
  })
}
