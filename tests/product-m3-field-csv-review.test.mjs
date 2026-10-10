import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'
import { buildBlankM3FieldChecklistCsv } from '../scripts/m3-export-blank-field-checklist.mjs'
import { parseM3FieldCsv, reviewM3FieldCsv } from '../scripts/m3-review-field-csv.mjs'

const csv = value => '"' + String(value).replaceAll('"', '""') + '"'
const serialize = rows => rows.map(row => row.map(csv).join(',')).join('\n') + '\n'

function syntheticFilledRows() {
  const rows = parseM3FieldCsv(buildBlankM3FieldChecklistCsv())
  for (let i = 1; i < rows.length; i++) {
    rows[i][7] = i <= 11 ? '2026-10-10T10:00:00Z' : '2026-10-10T11:00:00Z'
    rows[i][8] = 'in-store'
    rows[i][9] = 'Synthetic observation – NOT retail evidence'
    rows[i][10] = '500'
    rows[i][11] = 'g'
    rows[i][12] = '1'
    rows[i][13] = '199'
    rows[i][14] = 'ja'
    rows[i][15] = 'synthetic-fixture-not-a-source'
    rows[i][16] = 'https://example.invalid/non-retailer'
    rows[i][17] = 'fictional test-only observation'
  }
  return rows
}

test('blank 22-slot canonical worksheet remains incomplete, not evidence', () => {
  const summary = reviewM3FieldCsv(buildBlankM3FieldChecklistCsv())
  assert.deepEqual(summary, {
    status: 'incomplete-or-needs-review',
    expectedRows: 22,
    completeRows: 0,
    warnings: ['missing-or-incomplete-observations'],
    evidenceVerified: false,
    releaseEligible: false,
    claimable: false,
    savingsCents: null,
  })
})

test('even 22 synthetic completed observations require the real canonical human gate', () => {
  const text = serialize(syntheticFilledRows())
  const summary = reviewM3FieldCsv(text)
  assert.equal(summary.completeRows, 22)
  assert.equal(summary.status, 'requires-canonical-human-verification')
  assert.deepEqual(summary.warnings, [])
  assert.equal(summary.evidenceVerified, false)
  assert.equal(summary.claimable, false)
  assert.equal(summary.savingsCents, null)
  const output = JSON.stringify(summary)
  assert.doesNotMatch(output, /synthetic observation|example\.invalid|199|fictional test-only|participant/i)
})

test('mutating canonical demand, retailer role, evidence marker or row count fails closed', () => {
  const original = syntheticFilledRows()
  for (const [row, column, value] of [
    [1, 0, 'candidate'], [1, 1, 'other-store'],
    [1, 2, 'other-demand'], [1, 3, 'changed ingredient'],
    [1, 5, '5000'], [1, 6, 'kg'],
    [1, 18, 'verified-real-evidence'],
  ]) {
    const rows = structuredClone(original)
    rows[row][column] = value
    assert.throws(() => reviewM3FieldCsv(serialize(rows)), /structure invalid/)
  }
  assert.throws(() => reviewM3FieldCsv(serialize(original.slice(0, -1))), /structure invalid/)
  assert.throws(() => reviewM3FieldCsv(serialize([original[0], ...original.slice(2)])), /structure invalid/)
})

test('overly precise timestamps, mixed contexts and >24h separation never pass', () => {
  const scenarios = [
    [7, '2026-10-10T10:00:00.000000001Z', 'invalid-timestamp'],
    [7, '2026-10-12T11:00:00Z', 'capture-window-over-24-hours'],
    [8, 'online-order', 'mixed-price-context'],
  ]
  for (const [column, value, reason] of scenarios) {
    const rows = syntheticFilledRows()
    rows[1][column] = value
    const result = reviewM3FieldCsv(serialize(rows))
    assert.ok(result.warnings.includes(reason))
    assert.equal(result.releaseEligible, false)
    assert.notEqual(result.status, 'requires-canonical-human-verification')
  }
})

test('invalid physical packs, blank provenance and misleading unavailable-product data stay incomplete', () => {
  const scenarios = [
    [13, '3.20', 'inconsistent-product-fields'],
    [12, '0', 'inconsistent-product-fields'],
    [10, '0', 'inconsistent-product-fields'],
    [11, 'weird-unit', 'inconsistent-product-fields'],
    [15, '', 'missing-or-incomplete-observations'],
    [14, 'unknown', 'invalid-availability'],
    [16, 'javascript:alert(1)', 'invalid-source-url'],
    [17, '=HYPERLINK("bad")', 'unsafe-observation-cell'],
  ]
  for (const [column, value, warning] of scenarios) {
    const rows = syntheticFilledRows()
    rows[3][column] = value
    const result = reviewM3FieldCsv(serialize(rows))
    assert.ok(result.warnings.includes(warning), warning)
    assert.equal(result.releaseEligible, false)
  }
  const unavailable = syntheticFilledRows()
  unavailable[1][14] = 'nee'
  const result = reviewM3FieldCsv(serialize(unavailable))
  assert.ok(result.warnings.includes('inconsistent-product-fields'))
})

test('RFC quoting is deterministic, escaped quotes survive and malformed CSV fails', () => {
  const original = syntheticFilledRows()
  original[1][17] = 'synthetic, "quoted" observation'
  assert.equal(parseM3FieldCsv(serialize(original))[1][17], original[1][17])
  assert.equal(reviewM3FieldCsv(serialize(original)).completeRows, 22)
  for (const bad of [
    '"unterminated', 'a,"embedded\nnewline",c', 'a"b,c',
    'a,"ok"junk,c', 'a\u0000b', 'x'.repeat(128 * 1024 + 1),
  ]) {
    assert.throws(() => parseM3FieldCsv(bad), /structure invalid/)
  }
})

test('CLI prints only aggregate safe status; bad inputs never leak filename or evidence', () => {
  const dir = mkdtempSync(join(tmpdir(), 'supa-m3-review-'))
  try {
    const file = join(dir, 'private-sensitive-record.csv')
    const alias = join(dir, 'aliased.csv')
    writeFileSync(file, serialize(syntheticFilledRows()), { mode: 0o600 })
    symlinkSync(file, alias)
    const run = path => spawnSync(process.execPath, [
      '--experimental-strip-types', 'scripts/m3-review-field-csv.mjs', path,
    ], { encoding: 'utf8' })
    const good = run(file)
    assert.equal(good.status, 0, good.stderr)
    assert.deepEqual(JSON.parse(good.stdout), reviewM3FieldCsv(serialize(syntheticFilledRows())))
    assert.equal(good.stderr, '')
    const bad = run(alias)
    assert.notEqual(bad.status, 0)
    assert.equal(bad.stdout, '')
    assert.match(bad.stderr, /field CSV review failed/)
    assert.doesNotMatch(bad.stderr, /private-sensitive-record|synthetic-fixture|example\.invalid/)
    const noArgs = spawnSync(process.execPath, [
      '--experimental-strip-types', 'scripts/m3-review-field-csv.mjs',
    ], { encoding: 'utf8' })
    assert.notEqual(noArgs.status, 0)
    assert.equal(noArgs.stdout, '')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
