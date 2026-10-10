import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { buildBlankM3FieldChecklistCsv } from '../scripts/m3-export-blank-field-checklist.mjs'
import { parseM3FieldCsv, reviewM3FieldCsv } from '../scripts/m3-review-field-csv.mjs'

// These are FICTIONAL shapes; they must never be read as retail observations.
function filledSyntheticRows(source = 'manual-cart') {
  const rows = parseM3FieldCsv(buildBlankM3FieldChecklistCsv())
  for (const row of rows.slice(1)) {
    row[7] = '2026-10-10T12:00:00Z'
    row[8] = 'in-store'
    row[9] = 'Fictional item, not an observed retailer product'
    row[10] = '1'
    row[11] = row[6]
    row[12] = '1'
    row[13] = '199'
    row[14] = 'ja'
    row[15] = source
    row[16] = ''
    row[17] = ''
  }
  return rows
}

const encode = rows => rows.map(row =>
  row.map(value => '"' + String(value).replaceAll('"', '""') + '"').join(',')
).join('\n') + '\n'

const assertUnverified = result => {
  assert.equal(result.evidenceVerified, false)
  assert.equal(result.releaseEligible, false)
  assert.equal(result.claimable, false)
  assert.equal(result.savingsCents, null)
}

test('canonical M3 source types remain structurally reviewable, never verified or claimable', () => {
  for (const source of ['manual-cart', 'receipt', 'consented-export']) {
    const summary = reviewM3FieldCsv(encode(filledSyntheticRows(source)), { validateUnits: true })
    assert.equal(summary.completeRows, 22, source)
    assert.deepEqual(summary.warnings, [], source)
    assert.equal(summary.status, 'requires-canonical-human-verification')
    assertUnverified(summary)
  }
})

test('noncanonical observation source cannot make 22 synthetic rows complete', () => {
  for (const source of [
    'browser-cache', 'search-result', 'retailer-page', 'receipt ', ' manual-cart',
    'RECEIPT', 'consented export',
  ]) {
    const summary = reviewM3FieldCsv(encode(filledSyntheticRows(source)))
    assert.equal(summary.completeRows, 0, source)
    assert.ok(summary.warnings.includes('invalid-observation-source'), source)
    assert.ok(summary.warnings.includes('missing-or-incomplete-observations'), source)
    assert.equal(summary.status, 'incomplete-or-needs-review', source)
    assertUnverified(summary)
    assert.doesNotMatch(JSON.stringify(summary), /browser-cache|retailer-page|199|Fictional/)
  }
})

test('single invalid source among 21 valid M3 rows is not silently accepted', () => {
  const rows = filledSyntheticRows('receipt')
  rows[12][15] = 'unknown-channel'
  const summary = reviewM3FieldCsv(encode(rows), { validateUnits: true })
  assert.equal(summary.completeRows, 21)
  assert.ok(summary.warnings.includes('invalid-observation-source'))
  assert.ok(summary.warnings.includes('missing-or-incomplete-observations'))
  assert.equal(summary.status, 'incomplete-or-needs-review')
  assertUnverified(summary)
})

test('optional strict CLI exits 2 on bad M3 source and reveals aggregate codes only', () => {
  const dir = mkdtempSync(join(tmpdir(), 'supa-source-enum-qa-'))
  try {
    const file = join(dir, 'private-evidence-sensitive.csv')
    writeFileSync(file, encode(filledSyntheticRows('synthetic-only-unsafe-source')), { mode: 0o600 })
    const outcome = spawnSync(process.execPath, [
      '--experimental-strip-types', 'scripts/m3-review-field-csv.mjs',
      '--require-complete', '--validate-units', file,
    ], { encoding: 'utf8' })
    assert.equal(outcome.status, 2, outcome.stderr)
    assert.equal(outcome.stderr, '')
    const report = JSON.parse(outcome.stdout)
    assert.equal(report.completeRows, 0)
    assert.ok(report.warnings.includes('invalid-observation-source'))
    assertUnverified(report)
    assert.doesNotMatch(outcome.stdout, /private-evidence-sensitive|synthetic-only-unsafe-source|Fictional|199/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
