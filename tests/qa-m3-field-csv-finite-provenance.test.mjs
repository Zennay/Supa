import assert from 'node:assert/strict'
import test from 'node:test'
import { buildBlankM3FieldChecklistCsv } from '../scripts/m3-export-blank-field-checklist.mjs'
import { parseM3FieldCsv, reviewM3FieldCsv } from '../scripts/m3-review-field-csv.mjs'

// Deliberately fictional observations. They are not real retailer evidence.
function fictionalRows() {
  const rows = parseM3FieldCsv(buildBlankM3FieldChecklistCsv())
  for (const row of rows.slice(1)) {
    row[7] = '2026-10-10T10:00:00Z'
    row[8] = 'in-store'
    row[9] = 'fictional item'
    row[10] = '500'
    row[11] = 'g'
    row[12] = '1'
    row[13] = '199'
    row[14] = 'ja'
    row[15] = 'fictional field test'
  }
  return rows
}
function csv(rows) {
  return rows.map(row =>
    row.map(value => '"' + String(value).replaceAll('"', '""') + '"').join(',')
  ).join('\n') + '\n'
}
function rejectIncomplete(rows, expectedWarning = 'missing-or-incomplete-observations') {
  const summary = reviewM3FieldCsv(csv(rows))
  assert.ok(summary.warnings.includes(expectedWarning), JSON.stringify(summary))
  assert.equal(summary.completeRows, 21, 'one mutated row must not count as complete')
  assert.equal(summary.status, 'incomplete-or-needs-review')
  assert.equal(summary.evidenceVerified, false)
  assert.equal(summary.releaseEligible, false)
  assert.equal(summary.claimable, false)
  assert.equal(summary.savingsCents, null)
}

test('M3 filled CSV: whitespace-only context and source are missing provenance', () => {
  for (const column of [8, 15]) {
    const rows = fictionalRows()
    rows[1][column] = '    '
    rejectIncomplete(rows)
  }
})

test('M3 filled CSV: whitespace-only product is not a complete available observation', () => {
  const rows = fictionalRows()
  rows[1][9] = '    '
  rejectIncomplete(rows)
})

test('M3 filled CSV: overflowing decimal pack quantity must not count as complete', () => {
  for (const column of [10, 12]) {
    const rows = fictionalRows()
    rows[1][column] = '9'.repeat(400)
    rejectIncomplete(rows, 'inconsistent-product-fields')
  }
})

test('M3 filled CSV: an unavailable row still requires meaningful source/context', () => {
  for (const column of [8, 15]) {
    const rows = fictionalRows()
    rows[1][14] = 'nee'
    for (const index of [9, 10, 11, 12, 13]) rows[1][index] = ''
    rows[1][column] = '   '
    rejectIncomplete(rows)
  }
})

test('M3 filled CSV: ordinary finite packs and substantive provenance remain preflight-only', () => {
  const report = reviewM3FieldCsv(csv(fictionalRows()))
  assert.equal(report.completeRows, 22)
  assert.deepEqual(report.warnings, [])
  assert.equal(report.status, 'requires-canonical-human-verification')
  assert.equal(report.evidenceVerified, false)
  assert.equal(report.releaseEligible, false)
  assert.equal(report.claimable, false)
  assert.equal(report.savingsCents, null)
})
