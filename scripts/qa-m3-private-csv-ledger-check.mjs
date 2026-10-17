import { pathToFileURL } from 'node:url'
import { auditPrivateM3ComparisonCsv } from './qa-m3-private-comparison-csv-audit.mjs'

// Optional OFFLINE financial-consistency preflight for a *locally edited*
// private M3 CSV. It checks arithmetic, not evidence authenticity or rights.
// Neither this tool nor a passing result authorizes price publication.
const MAX_BYTES = 1024 * 1024
const EUROS = /^(?:0|[1-9]\d*),\d{2}$/u
const SIGNED_EUROS = /^-?(?:0|[1-9]\d*),\d{2}$/u
const COUNT = /^(?:0|[1-9]\d*)$/u
const CANONICAL_HEADERS = Object.freeze(["Ingrediënt","Benodigd","Eenheid","PLUS product","PLUS pakgrootte","PLUS pakeenheid","PLUS stuks per verpakking","PLUS benodigde pakken","PLUS prijs per pak (EUR)","PLUS regeltotaal (EUR)","DekaMarkt product","DekaMarkt pakgrootte","DekaMarkt pakeenheid","DekaMarkt stuks per verpakking","DekaMarkt benodigde pakken","DekaMarkt prijs per pak (EUR)","DekaMarkt regeltotaal (EUR)","Deka - PLUS (EUR)","Regelstatus"])
const CANONICAL_ADVISORY = 'Geen actuele prijsfeed en geen publieke besparingsclaim'
const UNKNOWN = 'Niet gemeten / niet beschikbaar'
const LINE_KNOWN = 'Voorlopig vergelijkbaar'
const LINE_UNKNOWN = 'Onbekend / niet volledig'
const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER)

function invalid() {
  throw new Error('M3 private CSV financial consistency failed')
}

function parseQuotedLine(line) {
  const cells = []
  let i = 0
  while (i < line.length) {
    if (line[i++] !== '"') invalid()
    let value = ''
    let closed = false
    while (i < line.length) {
      const character = line[i++]
      if (character !== '"') value += character
      else if (line[i] === '"') {
        value += '"'
        i++
      } else {
        closed = true
        break
      }
    }
    if (!closed) invalid()
    cells.push(value)
    if (i === line.length) break
    if (line[i++] !== ';' || i === line.length) invalid()
  }
  return cells
}

function safeCents(value, allowNegative = false) {
  if (!(allowNegative ? SIGNED_EUROS : EUROS).test(value)) invalid()
  const negative = value.startsWith('-')
  const magnitude = negative ? value.slice(1) : value
  const [euros, cents] = magnitude.split(',')
  const parsed = BigInt(euros) * 100n + BigInt(cents)
  if (parsed > MAX_SAFE) invalid()
  return negative ? -parsed : parsed
}

function safeCount(value) {
  if (!COUNT.test(value)) invalid()
  const count = BigInt(value)
  if (count <= 0n || count > MAX_SAFE) invalid()
  return count
}

function packTotal(cells, start) {
  // The seven-cell schema is name, pack size, unit, pieces, packs,
  // price/pack and total. Unknown never means a fabricated zero-price pack.
  const [name, amount, unit, pieces, packages, price, total] =
    cells.slice(start, start + 7)
  if (name === UNKNOWN) {
    if ([amount, unit, pieces, packages, price, total].some(Boolean)) invalid()
    return null
  }
  if (!name || !amount || !unit || !pieces || !packages ||
      !price || !total) invalid()
  // Quantity is advisory here; the upstream exporter validates physical units.
  // No money is recomputed from the display quantity.
  const quantity = Number(amount)
  if (!Number.isFinite(quantity) || quantity <= 0) invalid()
  safeCount(pieces)
  const count = safeCount(packages)
  const packCents = safeCents(price)
  const lineCents = safeCents(total)
  if (count * packCents !== lineCents) invalid()
  return lineCents
}

export function auditPrivateM3CsvLedger(csv) {
  // The existing independent syntactic/formula gate runs *first*. Do not
  // change its permissive plain-text contract or its existing callers.
  auditPrivateM3ComparisonCsv(csv)
  const rows = csv.slice(1, -2).split('\r\n').map(parseQuotedLine)
  if (rows[0].length !== 2 || rows[0][1] !== CANONICAL_ADVISORY ||
      rows[1].length !== CANONICAL_HEADERS.length ||
      CANONICAL_HEADERS.some((heading, index) => heading !== rows[1][index])) invalid()
  let plusTotal = 0n
  let dekaTotal = 0n
  let comparableRows = 0
  for (const row of rows.slice(2, 13)) {
    if (row.length !== 19 || !row[0] || !row[2]) invalid()
    const required = Number(row[1])
    if (!Number.isFinite(required) || required <= 0) invalid()
    const plus = packTotal(row, 3)
    const deka = packTotal(row, 10)
    if (plus !== null) plusTotal += plus
    if (deka !== null) dekaTotal += deka
    if (plus !== null && deka !== null) {
      if (row[18] !== LINE_KNOWN || safeCents(row[17], true) !== deka - plus) invalid()
      comparableRows++
    } else if (row[17] !== '' || row[18] !== LINE_UNKNOWN) invalid()
  }
  const footer = rows[13]
  if (footer.length !== 19) invalid()
  if (comparableRows === 11) {
    if (footer[0] !== 'VOORLOPIGE VOLLEDIGE MAND' ||
        safeCents(footer[9]) !== plusTotal ||
        safeCents(footer[16]) !== dekaTotal ||
        safeCents(footer[17], true) !== dekaTotal - plusTotal ||
        footer[18] !== 'Uitsluitend lokaal, niet onafhankelijk geverifieerd') invalid()
  } else if (footer[0] !== 'VOLLEDIGE MAND ONBEKEND' ||
             footer[9] !== '' || footer[16] !== '' || footer[17] !== '' ||
             footer[18] !== 'Niet alle producten/evidence vergelijkbaar') invalid()
  // Do not echo price, canary, participant or supermarket provenance.
  return Object.freeze({
    privateOnly: true,
    ledgerConsistent: true,
    canonicalShoppingRows: 11,
    comparableRows,
    fullBasketComparable: comparableRows === 11,
    verifiedRetailerObservations: false,
    publicSavingsClaimEligible: false,
  })
}

async function main() {
  const chunks = []
  let size = 0
  for await (const part of process.stdin) {
    size += part.length
    if (size > MAX_BYTES) invalid()
    chunks.push(part)
  }
  const csv = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true })
    .decode(Buffer.concat(chunks))
  process.stdout.write(JSON.stringify(auditPrivateM3CsvLedger(csv)) + '\n')
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.length !== 2) {
    process.stderr.write('M3 private CSV financial consistency failed\n')
    process.exitCode = 1
  } else {
    main().catch(() => {
      process.stderr.write('M3 private CSV financial consistency failed\n')
      process.exitCode = 1
    })
  }
}
