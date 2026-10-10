import { lstatSync, readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { buildBlankM3FieldChecklistCsv } from './m3-export-blank-field-checklist.mjs'
import { sameM3QuantityFamily, validM3PackPieceAmount } from './m3-field-unit-compatibility.mjs'

const LIMIT_BYTES = 128 * 1024
const IMMUTABLE = Object.freeze([0, 1, 2, 3, 4, 5, 6, 18])
const FIELDS = Object.freeze([
  'retailer_role', 'retailer', 'ingredient_id', 'ingredient_label',
  'search_query', 'required_amount', 'required_unit', 'observed_at',
  'price_context', 'product_name', 'pack_amount', 'pack_unit',
  'pack_count', 'price_cents', 'available', 'source', 'source_url',
  'note', 'evidence_status',
])

// Strict single-line RFC4180 subset. The canonical exporter never writes
// multiline cells: reject them instead of quietly changing evidence rows.
export function parseM3FieldCsv(input) {
  if (typeof input !== 'string' || Buffer.byteLength(input, 'utf8') > LIMIT_BYTES ||
      /[\u0000-\u0009\u000b-\u001f\u007f]/.test(input)) {
    throw new Error('M3 field CSV structure invalid')
  }
  const content = input.startsWith('\ufeff') ? input.slice(1) : input
  const rows = []
  let row = [], cell = '', quoted = false, closed = false, atStart = true
  function field() {
    row.push(cell)
    cell = ''
    closed = false
    atStart = true
  }
  function record() {
    field()
    rows.push(row)
    row = []
  }
  for (let i = 0; i < content.length; i++) {
    const c = content[i]
    if (quoted) {
      if (c === '"') {
        if (content[i + 1] === '"') { cell += '"'; i++ }
        else { quoted = false; closed = true }
      } else {
        if (c === '\r' || c === '\n') throw new Error('M3 field CSV structure invalid')
        cell += c
      }
      continue
    }
    if (c === ',') { field(); continue }
    if (c === '\n' || c === '\r') {
      if (c === '\r') {
        if (content[i + 1] !== '\n') throw new Error('M3 field CSV structure invalid')
        i++
      }
      record()
      continue
    }
    if (closed) throw new Error('M3 field CSV structure invalid')
    if (c === '"' && atStart) { quoted = true; atStart = false; continue }
    if (c === '"') throw new Error('M3 field CSV structure invalid')
    cell += c
    atStart = false
  }
  if (quoted) throw new Error('M3 field CSV structure invalid')
  if (row.length || cell || closed || !atStart) record()
  return rows
}

const isoInstant = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/
const whole = /^(?:0|[1-9]\d*)$/
const positiveDecimal = /^(?:(?:0|[1-9]\d*)(?:\.\d+)?|\.\d+)$/
const safeText = value => !/^[\s]*[=+@-]/.test(value)
const meaningfulText = value => typeof value === 'string' && value.trim().length > 0

// The lexical prefix alone accepts malformed ports and hostnames. Parse the
// authority without dereferencing the URL; never log or fetch the source.
function validSourceUrl(value) {
  if (!/^https:\/\/[^\s/@]+(?:\/|$)/i.test(value) || value.includes('\\')) return false
  try {
    const parsed = new URL(value)
    return parsed.protocol === 'https:' && Boolean(parsed.hostname) &&
      !parsed.username && !parsed.password
  } catch {
    return false
  }
}

function validObservationTime(value) {
  if (!isoInstant.test(value)) return null
  // Date.parse can silently normalize 30 February into March. Calendar and
  // explicit offset validation must precede any freshness arithmetic.
  const datePart = value.slice(0, 10)
  const [hoursOfDay, minutesOfHour, secondsOfMinute] =
    value.slice(11, 19).split(':').map(Number)
  if (hoursOfDay > 23 || minutesOfHour > 59 || secondsOfMinute > 59) return null
  const midnight = Date.parse(datePart + 'T00:00:00Z')
  if (!Number.isFinite(midnight) ||
      new Date(midnight).toISOString().slice(0, 10) !== datePart) return null
  const offset = value.match(/([+-])(\d{2}):(\d{2})$/)
  if (offset) {
    const hours = Number(offset[2])
    const minutes = Number(offset[3])
    if (hours > 14 || minutes > 59 || (hours === 14 && minutes !== 0)) return null
  }
  const millis = Date.parse(value)
  if (!Number.isFinite(millis)) return null
  // An over-precise timestamp is never silently truncated to milliseconds.
  const match = value.match(/\.([0-9]+)(?:Z|[+-])/)
  if (match && match[1].length > 3) return null
  return millis
}

export function reviewM3FieldCsv(input, { validateUnits = false } = {}) {
  const rows = parseM3FieldCsv(input)
  const expected = parseM3FieldCsv(buildBlankM3FieldChecklistCsv())
  if (rows.length !== expected.length || rows.length !== 23 ||
      rows.some(row => row.length !== FIELDS.length) ||
      FIELDS.some((field, index) => rows[0][index] !== field)) {
    throw new Error('M3 field CSV structure invalid')
  }

  const warnings = new Set()
  let completeRows = 0
  const timestamps = []
  const contexts = new Set()
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i]
    for (const column of IMMUTABLE) {
      if (row[column] !== expected[i][column]) {
        throw new Error('M3 field CSV structure invalid')
      }
    }
    const [observedAt, context, product, packAmount, packUnit, packCount,
      priceCents, available, source, sourceUrl, note] = row.slice(7, 18)
    if ([observedAt, context, product, packAmount, packUnit, packCount,
      priceCents, available, source, sourceUrl, note].some(value => !safeText(value))) {
      warnings.add('unsafe-observation-cell')
    }
    const validContext = context === 'in-store' || context === 'online-order'
    if (context && !validContext) warnings.add('invalid-price-context')
    if (context) contexts.add(context)
    if (sourceUrl && !validSourceUrl(sourceUrl)) {
      warnings.add('invalid-source-url')
    }
    const timestamp = observedAt ? validObservationTime(observedAt) : null
    if (observedAt && timestamp === null) warnings.add('invalid-timestamp')
    if (timestamp !== null) timestamps.push(timestamp)

    const state = available.toLowerCase()
    if (state && !['ja', 'nee', 'yes', 'no', 'true', 'false'].includes(state)) {
      warnings.add('invalid-availability')
    }
    const yes = ['ja', 'yes', 'true'].includes(state)
    const no = ['nee', 'no', 'false'].includes(state)
    // Provenance channel is an exact contract, not arbitrary free text. A
    // syntactically filled fictional source may never pass preflight.
    const validSource = ['manual-cart', 'receipt', 'consented-export'].includes(source)
    if (source && !validSource) warnings.add('invalid-observation-source')
    const required = Boolean(observedAt && validContext && validSource && (yes || no))
    const unitCompatible = !validateUnits || sameM3QuantityFamily(row[6], packUnit)
    if (validateUnits && yes && packUnit && !unitCompatible) {
      warnings.add('incompatible-pack-unit')
    }
    const coherent = no
      ? !product && !packAmount && !packUnit && !packCount && !priceCents
      : yes && unitCompatible && Boolean(meaningfulText(product) && packAmount && packUnit && packCount && priceCents) &&
        (!validateUnits || validM3PackPieceAmount(packAmount, packUnit)) &&
        positiveDecimal.test(packAmount) && Number.isFinite(Number(packAmount)) &&
        Number(packAmount) > 0 && Number.isSafeInteger(Math.ceil(Number(packAmount))) &&
        ['g', 'kg', 'ml', 'l', 'piece'].includes(packUnit) &&
        whole.test(packCount) && Number.isSafeInteger(Number(packCount)) &&
        Number(packCount) > 0 &&
        whole.test(priceCents) && Number.isSafeInteger(Number(priceCents))
    if ((yes || no) && !coherent) warnings.add('inconsistent-product-fields')
    if (required && coherent && timestamp !== null) completeRows++
  }
  if (contexts.size > 1) warnings.add('mixed-price-context')
  if (timestamps.length > 1 &&
      Math.max(...timestamps) - Math.min(...timestamps) > 24 * 60 * 60 * 1000) {
    warnings.add('capture-window-over-24-hours')
  }
  if (completeRows < 22) warnings.add('missing-or-incomplete-observations')
  return {
    status: completeRows === 22 && warnings.size === 0
      ? 'requires-canonical-human-verification'
      : 'incomplete-or-needs-review',
    expectedRows: 22,
    completeRows,
    // No participant, product, URL, store note, observation, or price is returned.
    warnings: [...warnings].sort(),
    evidenceVerified: false,
    releaseEligible: false,
    claimable: false,
    savingsCents: null,
  }
}

export function main(argv = process.argv.slice(2)) {
  // Strict completeness is an explicit automation gate; unit checks are
  // separately opt-in and may be combined in this documented order.
  const requireComplete = argv[0] === '--require-complete'
  const validateUnits = argv[requireComplete ? 1 : 0] === '--validate-units'
  const optionCount = Number(requireComplete) + Number(validateUnits)
  const filePath = argv[optionCount]
  if (argv.length !== optionCount + 1 || !filePath || filePath.startsWith('-')) {
    throw new Error('M3 field CSV review failed')
  }
  const stat = lstatSync(filePath)
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > LIMIT_BYTES) {
    throw new Error('M3 field CSV review failed')
  }
  const result = reviewM3FieldCsv(readFileSync(filePath, 'utf8'), { validateUnits })
  process.stdout.write(JSON.stringify(result) + '\n')
  if (requireComplete && result.status !== 'requires-canonical-human-verification') {
    process.exitCode = 2
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main()
  } catch {
    // Never echo raw study observations, CSV cells, filenames or stack traces.
    console.error('M3 field CSV review failed; check the canonical template and local file')
    process.exitCode = 1
  }
}
