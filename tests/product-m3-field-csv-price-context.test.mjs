import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { buildBlankM3FieldChecklistCsv } from '../scripts/m3-export-blank-field-checklist.mjs'
import { parseM3FieldCsv, reviewM3FieldCsv } from '../scripts/m3-review-field-csv.mjs'

const serialize = rows => rows.map(row =>
  row.map(value => '"' + String(value).replaceAll('"', '""') + '"').join(',')).join('\n') + '\n'

function syntheticRows(context = 'in-store') {
  const rows = parseM3FieldCsv(buildBlankM3FieldChecklistCsv())
  for (const row of rows.slice(1)) {
    row[7] = '2026-10-10T10:00:00Z'
    row[8] = context
    row[9] = 'Fictional product (not a retailer observation)'
    row[10] = '500'
    row[11] = 'g'
    row[12] = '1'
    row[13] = '199'
    row[14] = 'ja'
    row[15] = 'manual-cart'
  }
  return rows
}

test('canonical M3 price contexts remain structurally complete, never verified evidence', () => {
  for (const context of ['in-store', 'online-order']) {
    const summary = reviewM3FieldCsv(serialize(syntheticRows(context)))
    assert.equal(summary.completeRows, 22)
    assert.deepEqual(summary.warnings, [])
    assert.equal(summary.status, 'requires-canonical-human-verification')
    assert.equal(summary.evidenceVerified, false)
    assert.equal(summary.releaseEligible, false)
    assert.equal(summary.claimable, false)
    assert.equal(summary.savingsCents, null)
  }
})

test('unknown, padded and misleading shared price contexts cannot count as ready', () => {
  for (const context of ['delivery', 'instore', 'online', 'in-store ', ' online-order', 'IN-STORE']) {
    const summary = reviewM3FieldCsv(serialize(syntheticRows(context)))
    assert.equal(summary.completeRows, 0, context)
    assert.ok(summary.warnings.includes('invalid-price-context'), context)
    assert.ok(summary.warnings.includes('missing-or-incomplete-observations'), context)
    assert.equal(summary.status, 'incomplete-or-needs-review', context)
    assert.equal(summary.savingsCents, null)
    assert.equal(summary.claimable, false)
  }
})

test('one invalid observation context is not hidden among 21 valid observations', () => {
  const rows = syntheticRows()
  rows[7][8] = 'unknown-channel'
  const summary = reviewM3FieldCsv(serialize(rows))
  assert.equal(summary.completeRows, 21)
  assert.ok(summary.warnings.includes('invalid-price-context'))
  assert.ok(summary.warnings.includes('mixed-price-context'))
  assert.equal(summary.status, 'incomplete-or-needs-review')
  assert.equal(summary.releaseEligible, false)
})

test('strict CLI exits 2 on unsupported context and keeps evidence details private', () => {
  const dir = mkdtempSync(join(tmpdir(), 'supa-m3-context-'))
  try {
    const path = join(dir, 'private-price-context-evidence.csv')
    writeFileSync(path, serialize(syntheticRows('unapproved-retailer-channel')), { mode: 0o600 })
    const proc = spawnSync(process.execPath, [
      '--experimental-strip-types', 'scripts/m3-review-field-csv.mjs',
      '--require-complete', path,
    ], { encoding: 'utf8' })
    assert.equal(proc.status, 2, proc.stderr)
    assert.equal(proc.stderr, '')
    const summary = JSON.parse(proc.stdout)
    assert.equal(summary.completeRows, 0)
    assert.ok(summary.warnings.includes('invalid-price-context'))
    assert.equal(summary.evidenceVerified, false)
    assert.equal(summary.savingsCents, null)
    assert.doesNotMatch(proc.stdout, /private-price-context|unapproved-retailer|Fictional|199/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
