import assert from 'node:assert/strict'
import test from 'node:test'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildBlankM3FieldChecklistCsv } from '../scripts/m3-export-blank-field-checklist.mjs'
import { parseM3FieldCsv, reviewM3FieldCsv } from '../scripts/m3-review-field-csv.mjs'

const AT_NOON = Date.parse('2026-10-10T12:00:00.000Z')
const serialize = rows => rows.map(row =>
  row.map(cell => '"' + String(cell).replaceAll('"', '""') + '"').join(',')
).join('\n') + '\n'

function syntheticRows(time = '2026-10-10T12:00:00Z') {
  const rows = parseM3FieldCsv(buildBlankM3FieldChecklistCsv())
  for (const row of rows.slice(1)) {
    row[7] = time
    row[8] = 'in-store'
    row[9] = 'Fictional test-only product, never retailer data'
    row[10] = '1'
    row[11] = row[6]
    row[12] = '1'
    row[13] = '199'
    row[14] = 'ja'
    row[15] = 'manual-cart'
  }
  return rows
}

function safe(summary) {
  assert.equal(summary.evidenceVerified, false)
  assert.equal(summary.releaseEligible, false)
  assert.equal(summary.claimable, false)
  assert.equal(summary.savingsCents, null)
}

test('M3 CSV accepts the exact review instant and equivalent timezone offsets, not future instants', () => {
  for (const timestamp of [
    '2026-10-10T12:00:00Z', '2026-10-10T12:00:00.000Z',
    '2026-10-10T13:00:00+01:00', '2026-10-10T08:00:00-04:00',
  ]) {
    const result = reviewM3FieldCsv(serialize(syntheticRows(timestamp)), {
      validateUnits: true, referenceNowMs: AT_NOON,
    })
    assert.equal(result.completeRows, 22, timestamp)
    assert.deepEqual(result.warnings, [], timestamp)
    assert.equal(result.status, 'requires-canonical-human-verification')
    safe(result)
  }
})

test('whole-sheet future instants fail closed without inventing evidence', () => {
  for (const timestamp of [
    '2026-10-10T12:00:00.001Z',
    '2026-10-10T13:00:00Z',
    '2026-10-10T08:00:01-04:00',
    '2099-10-10T12:00:00Z',
  ]) {
    const result = reviewM3FieldCsv(serialize(syntheticRows(timestamp)), {
      validateUnits: true, referenceNowMs: AT_NOON,
    })
    assert.equal(result.completeRows, 0, timestamp)
    assert.ok(result.warnings.includes('invalid-timestamp'), timestamp)
    assert.ok(result.warnings.includes('missing-or-incomplete-observations'))
    assert.equal(result.status, 'incomplete-or-needs-review')
    safe(result)
  }
})

test('every individual row is reviewed against clock, not only the shared 24-hour window', () => {
  for (let rowIndex = 1; rowIndex <= 22; rowIndex++) {
    const rows = syntheticRows()
    rows[rowIndex][7] = '2026-10-10T12:00:00.001Z'
    const result = reviewM3FieldCsv(serialize(rows), {
      validateUnits: true, referenceNowMs: AT_NOON,
    })
    assert.equal(result.completeRows, 21, rowIndex)
    assert.ok(result.warnings.includes('invalid-timestamp'))
    assert.equal(result.status, 'incomplete-or-needs-review')
    safe(result)
  }
})

test('a malformed reference clock fails instead of silently approving unknown freshness', () => {
  for (const clock of [NaN, Infinity, -Infinity, '2026-10-10T12:00:00Z']) {
    assert.throws(
      () => reviewM3FieldCsv(serialize(syntheticRows()), { referenceNowMs: clock }),
      /structure invalid/,
    )
  }
})

test('opt-in strict CLI rejects 2099-dated CSV without revealing private cells', () => {
  const dir = mkdtempSync(join(tmpdir(), 'supa-future-csv-'))
  try {
    const file = join(dir, 'private-participant-prices.csv')
    writeFileSync(file, serialize(syntheticRows('2099-10-10T12:00:00Z')), { mode: 0o600 })
    const output = spawnSync(process.execPath, [
      '--experimental-strip-types', 'scripts/m3-review-field-csv.mjs',
      '--require-complete', '--validate-units', file,
    ], { encoding: 'utf8' })
    assert.equal(output.status, 2, output.stderr)
    assert.equal(output.stderr, '')
    const result = JSON.parse(output.stdout)
    assert.equal(result.completeRows, 0)
    assert.ok(result.warnings.includes('invalid-timestamp'))
    assert.equal(result.status, 'incomplete-or-needs-review')
    safe(result)
    assert.doesNotMatch(output.stdout, /private-participant|Fictional test-only|2099-10-10|199/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
