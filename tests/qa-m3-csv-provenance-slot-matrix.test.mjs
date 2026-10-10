import assert from 'node:assert/strict'
import test from 'node:test'
import { buildBlankM3FieldChecklistCsv } from '../scripts/m3-export-blank-field-checklist.mjs'
import { parseM3FieldCsv, reviewM3FieldCsv } from '../scripts/m3-review-field-csv.mjs'

const encode = rows => rows.map(row =>
  row.map(cell => '"' + String(cell).replaceAll('"', '""') + '"').join(',')
).join('\n') + '\n'

// Test-only values; no observed store prices or actual retailer evidence.
function filledRows() {
  const rows = parseM3FieldCsv(buildBlankM3FieldChecklistCsv())
  for (const row of rows.slice(1)) {
    row[7] = '2026-10-10T10:00:00Z'
    row[8] = 'in-store'
    row[9] = 'Fictional fixture product'
    row[10] = '1'
    row[11] = row[6]
    row[12] = '1'
    row[13] = '199'
    row[14] = 'ja'
    row[15] = 'manual-cart'
  }
  return rows
}

function assertNotEvidence(summary) {
  assert.equal(summary.evidenceVerified, false)
  assert.equal(summary.releaseEligible, false)
  assert.equal(summary.claimable, false)
  assert.equal(summary.savingsCents, null)
}

test('every PLUS and DekaMarkt row refuses a substituted unsupported source', () => {
  const canonical = filledRows()
  assert.equal(reviewM3FieldCsv(encode(canonical), { validateUnits: true }).completeRows, 22)
  for (let index = 1; index <= 22; index++) {
    const rows = structuredClone(canonical)
    rows[index][15] = 'browser-cache-not-observed'
    const result = reviewM3FieldCsv(encode(rows), { validateUnits: true })
    assert.equal(result.completeRows, 21, `line ${index}`)
    assert.ok(result.warnings.includes('invalid-observation-source'), `line ${index}`)
    assert.ok(result.warnings.includes('missing-or-incomplete-observations'), `line ${index}`)
    assert.equal(result.status, 'incomplete-or-needs-review')
    assertNotEvidence(result)
    assert.doesNotMatch(JSON.stringify(result), /browser-cache-not-observed|Fictional fixture|199/)
  }
})

test('source provenance still matters when a product is legitimately unavailable', () => {
  for (const index of [1, 11, 12, 22]) {
    const rows = filledRows()
    // An unavailable product has no fabricated substitute, pack or price.
    for (const column of [9, 10, 11, 12, 13]) rows[index][column] = ''
    rows[index][14] = 'nee'
    const positive = reviewM3FieldCsv(encode(rows), { validateUnits: true })
    assert.equal(positive.completeRows, 22)
    assert.equal(positive.status, 'requires-canonical-human-verification')
    assertNotEvidence(positive)

    rows[index][15] = 'unverified-search-snippet'
    const negative = reviewM3FieldCsv(encode(rows), { validateUnits: true })
    assert.equal(negative.completeRows, 21)
    assert.ok(negative.warnings.includes('invalid-observation-source'))
    assert.equal(negative.status, 'incomplete-or-needs-review')
    assertNotEvidence(negative)
  }
})

test('all three canonical source values preserve structural review without a claim', () => {
  for (const source of ['manual-cart', 'receipt', 'consented-export']) {
    for (const context of ['in-store', 'online-order']) {
      const rows = filledRows()
      for (const row of rows.slice(1)) {
        row[15] = source
        row[8] = context
      }
      const result = reviewM3FieldCsv(encode(rows), { validateUnits: true })
      assert.equal(result.completeRows, 22)
      assert.deepEqual(result.warnings, [])
      assert.equal(result.status, 'requires-canonical-human-verification')
      assertNotEvidence(result)
    }
  }
})
