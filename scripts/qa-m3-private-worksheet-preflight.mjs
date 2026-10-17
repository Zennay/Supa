/**
 * Independent, read-only QA preflight for a blank M3 human observation CSV.
 * NOT the M3 producer, a signed field record, source-rights proof or publication gate.
 * Accepts only private, paired UNOBSERVED rows; prints aggregate counts only.
 */
import { pathToFileURL } from 'node:url'

const HEADERS = Object.freeze([
  'evidenceStatus', 'retailerId', 'ingredientId', 'ingredientLabel',
  'requiredAmount', 'requiredUnit', 'observedAt', 'storeLocation',
  'priceContext', 'observedProductName', 'observedPackAmount',
  'observedPackUnit', 'observedPackCount', 'observedPriceEUR',
  'observedAvailability', 'collectionMethod', 'evidenceReference', 'notes',
])
const MARKER = 'UNOBSERVED_TEMPLATE_NOT_EVIDENCE'
const STORES = new Set(['plus', 'dekamarkt'])
const UNITS = new Set(['g', 'kg', 'ml', 'l', 'piece'])
const MAX_INPUT_BYTES = 1_048_576
const ID = /^[A-Za-z0-9._:-]{1,170}$/
const QUANTITY = /^(?:0|[1-9][0-9]{0,8})(?:\.[0-9]{1,6})?$/
const UNSAFE_TEXT = /[\u0000-\u001f\u007f\u061c\u200b\u200e\u200f\u202a-\u202e\u2060\u2066-\u2069\ufeff]/u
const UNSAFE_PREFIX = /^\s*(?:[\u200c\u200d]|[=+@-])/u
const MAX_NEEDS = 100
const refuse = () => { throw new Error('Private worksheet QA audit refused') }

function csvRows(csv) {
  if (typeof csv !== 'string' || Buffer.byteLength(csv, 'utf8') > MAX_INPUT_BYTES ||
      !csv.endsWith('\n')) refuse()
  const rows = []
  let row = []
  let index = 0
  while (index < csv.length) {
    if (csv[index++] !== '"') refuse()
    let field = ''
    let terminated = false
    while (index < csv.length) {
      const ch = csv[index++]
      if (ch !== '"') {
        field += ch
        if (field.length > 2048) refuse()
        continue
      }
      if (csv[index] === '"') {
        field += '"'
        index++
      } else {
        terminated = true
        break
      }
    }
    if (!terminated || UNSAFE_TEXT.test(field)) refuse()
    row.push(field)
    if (row.length > HEADERS.length) refuse()
    if (csv[index] === ',') {
      index++
      continue
    }
    if (csv[index] !== '\n') refuse()
    index++
    if (row.length !== HEADERS.length) refuse()
    rows.push(row)
    if (rows.length > MAX_NEEDS * STORES.size + 1) refuse()
    row = []
  }
  if (row.length !== 0 || rows.length < 3 ||
      rows[0].some((cell, i) => cell !== HEADERS[i])) refuse()
  return rows.slice(1)
}

/**
 * Verify only structural/data-minimization safety. Do not infer any capture,
 * price, permission, savings or actual human observation from a passing CSV.
 */
export function auditPrivateWorksheetCsv(csv) {
  const rows = csvRows(csv)
  if (rows.length % STORES.size !== 0) refuse()
  const expectedNeeds = rows.length / STORES.size
  if (expectedNeeds < 1 || expectedNeeds > MAX_NEEDS) refuse()

  const storeCounts = { plus: 0, dekamarkt: 0 }
  const demands = new Map()
  const paired = new Set()
  for (const row of rows) {
    const [marker, store, rawId, label, rawAmount, unit, ...observations] = row
    if (marker !== MARKER || !STORES.has(store) ||
        typeof label !== 'string' || !label.trim() || label.length > 512 ||
        UNSAFE_PREFIX.test(label) || observations.length !== 12 ||
        observations.some(item => item !== '') || !UNITS.has(unit)) refuse()
    // The producer safely emits a leading apostrophe if an ID begins "-".
    const id = rawId.startsWith("'-") ? rawId.slice(1) : rawId
    if (!ID.test(id) || (rawId !== id && !id.startsWith('-')) ||
        !QUANTITY.test(rawAmount)) refuse()
    const amount = Number(rawAmount)
    // QA-side conservative guard pending the product owner's unit-sensitive
    // collection bounds. Never silently convert exponent notation or round.
    if (!Number.isFinite(amount) || amount <= 0 || amount > 1_000_000) refuse()
    const key = store + ':' + id
    if (paired.has(key)) refuse()
    paired.add(key)
    storeCounts[store]++
    const existing = demands.get(id)
    if (existing) {
      if (existing.label !== label || existing.amount !== rawAmount ||
          existing.unit !== unit) refuse()
    } else {
      demands.set(id, { label, amount: rawAmount, unit })
    }
  }

  if (demands.size !== expectedNeeds ||
      storeCounts.plus !== expectedNeeds || storeCounts.dekamarkt !== expectedNeeds) refuse()
  for (const id of demands.keys()) {
    for (const store of STORES) {
      if (!paired.has(store + ':' + id)) refuse()
    }
  }
  return {
    mode: 'm3-blank-worksheet-qa-only',
    rows: rows.length,
    ingredientNeeds: demands.size,
    pairedRetailers: STORES.size,
    verifiedActualObservations: 0,
    sourceRightsVerified: false,
    productionReady: false,
    publicSavingsClaimEligible: false,
  }
}

/** Consume bounded stdin only; on failure emit no private data or partial JSON. */
export async function main(input = process.stdin, write = text => process.stdout.write(text)) {
  if (!input || typeof input[Symbol.asyncIterator] !== 'function' ||
      typeof write !== 'function') refuse()
  const chunks = []
  let bytes = 0
  for await (const raw of input) {
    if (!Buffer.isBuffer(raw) && typeof raw !== 'string') refuse()
    const chunk = Buffer.isBuffer(raw) ? raw : Buffer.from(raw, 'utf8')
    bytes += chunk.length
    if (bytes > MAX_INPUT_BYTES) refuse()
    chunks.push(chunk)
  }
  let csv
  try {
    csv = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))
  } catch { refuse() }
  const summary = auditPrivateWorksheetCsv(csv)
  write(JSON.stringify(summary) + '\n')
  return summary
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.length !== 2) {
    process.stderr.write('usage: node scripts/qa-m3-private-worksheet-preflight.mjs < local-template.csv\n')
    process.exitCode = 2
  } else {
    main().catch(() => {
      process.stderr.write('Private worksheet QA audit refused\n')
      process.exitCode = 2
    })
  }
}
