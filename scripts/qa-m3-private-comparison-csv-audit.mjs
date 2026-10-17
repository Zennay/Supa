import { pathToFileURL } from 'node:url'

// Standalone, opt-in quality gate for an already generated *private* local
// comparison CSV. It neither modifies Supa's product exporter nor authorizes
// retailer fetching, price publication or savings claims.
const MAX_BYTES = 1024 * 1024
const TEXT_COLUMNS = Object.freeze([0, 2, 3, 5, 10, 12, 18])
const TEXT_SET = new Set(TEXT_COLUMNS)
const PHYSICAL_DECIMAL = /^(?:0|[1-9]\d*)(?:\.\d+)?(?:e[+-]?\d+)?$/iu
const WHOLE_COUNT = /^(?:0|[1-9]\d*)$/u
const EUROS = /^(?:0|[1-9]\d*),\d{2}$/u
const SIGNED_EUROS = /^-?(?:0|[1-9]\d*),\d{2}$/u

function isCanonicalNumericCell(value, index) {
  // Missing cells are allowed for unresolved private pack evidence.
  if (value === '') return true
  if ([1, 4, 11].includes(index)) return PHYSICAL_DECIMAL.test(value)
  if ([6, 7, 13, 14].includes(index)) return WHOLE_COUNT.test(value)
  if ([8, 9, 15, 16].includes(index)) return EUROS.test(value)
  if (index === 17) return SIGNED_EUROS.test(value)
  return false
}

function invalid() {
  throw new Error('M3 private CSV safety preflight failed')
}

function quotedCells(line) {
  const fields = []
  let i = 0
  while (i < line.length) {
    if (line[i] !== '"') invalid()
    i++
    let value = ''
    let closed = false
    while (i < line.length) {
      const ch = line[i++]
      if (ch !== '"') {
        value += ch
      } else if (line[i] === '"') {
        value += '"'
        i++
      } else {
        closed = true
        break
      }
    }
    if (!closed) invalid()
    fields.push(value)
    if (i === line.length) break
    if (line[i++] !== ';' || i === line.length) invalid()
  }
  return fields
}

function hasUnguardedFormulaText(value) {
  if (value.startsWith("'")) return false
  const normalized = value.normalize('NFKC')
  // A leading Unicode formatting/combining character can make a formula
  // visually start with "=" while bypassing an ASCII-only exporter check.
  const visuallyLeading = normalized.replace(
    /^[\p{White_Space}\p{Default_Ignorable_Code_Point}\p{Mn}\p{Me}]+/gu,
    '',
  )
  return /^[=+\-@]/u.test(visuallyLeading)
}

export function auditPrivateM3ComparisonCsv(csv) {
  if (typeof csv !== 'string') invalid()
  if (Buffer.byteLength(csv, 'utf8') > MAX_BYTES) invalid()
  if (!csv.startsWith('\ufeff') || !csv.endsWith('\r\n')) invalid()
  const physical = csv.slice(1, -2).split('\r\n')
  // Advisory, headers, exactly 11 physical shopping rows, footer.
  if (physical.length !== 14) invalid()
  const rows = physical.map(quotedCells)
  if (rows[0].length !== 2 || rows[0][0] !== 'PRIVE / NIET GEVERIFIEERD') invalid()
  if (rows[1].length !== 19 || rows[1][0] !== 'Ingrediënt') invalid()
  if (!['VOORLOPIGE VOLLEDIGE MAND', 'VOLLEDIGE MAND ONBEKEND']
    .includes(rows[13][0])) invalid()
  // Advisory/header labels are also text cells; never assume manually
  // modified CSV headers are inert just because the producer normally owns them.
  for (const cells of rows.slice(0, 2)) {
    for (const value of cells) if (hasUnguardedFormulaText(value)) invalid()
  }
  for (let rowIndex = 2; rowIndex < rows.length; rowIndex++) {
    const cells = rows[rowIndex]
    if (cells.length !== 19) invalid()
    const footer = rowIndex === 13
    for (let index = 0; index < 19; index++) {
      const value = cells[index]
      if (footer) {
        if ([9, 16, 17].includes(index)) {
          if (!isCanonicalNumericCell(value, index)) invalid()
        } else if (hasUnguardedFormulaText(value)) invalid()
      } else if (TEXT_SET.has(index)) {
        if (hasUnguardedFormulaText(value)) invalid()
      } else if (!isCanonicalNumericCell(value, index)) {
        // Covers all numeric positions; signed basket deltas are permitted
        // only in canonical exact-EUR representation, not formula expressions.
        invalid()
      }
    }
  }
  return Object.freeze({
    schemaVersion: 1,
    privateOnly: true,
    safeToImportAsPlainText: true,
    canonicalShoppingRows: 11,
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
  const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true })
    .decode(Buffer.concat(chunks))
  const report = auditPrivateM3ComparisonCsv(text)
  process.stdout.write(JSON.stringify(report) + '\n')
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.length !== 2) {
    process.stderr.write('M3 private CSV safety preflight failed\n')
    process.exitCode = 1
  } else {
    main().catch(() => {
      // Never echo a private cell, local path or parser error to the terminal.
      process.stderr.write('M3 private CSV safety preflight failed\n')
      process.exitCode = 1
    })
  }
}
