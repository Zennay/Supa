import assert from 'node:assert/strict'
import test from 'node:test'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { sameM3QuantityFamily, validM3PackPieceAmount } from '../scripts/m3-field-unit-compatibility.mjs'
import { buildBlankM3FieldChecklistCsv } from '../scripts/m3-export-blank-field-checklist.mjs'
import { parseM3FieldCsv, reviewM3FieldCsv } from '../scripts/m3-review-field-csv.mjs'

const quote = text => '"' + String(text).replaceAll('"', '""') + '"'
const csv = rows => rows.map(row => row.map(quote).join(',')).join('\n') + '\n'

function fictionalObservations() {
  const rows = parseM3FieldCsv(buildBlankM3FieldChecklistCsv())
  for (let i = 1; i < rows.length; i++) {
    rows[i][7] = i <= 11 ? '2026-10-10T10:00:00Z' : '2026-10-10T11:00:00Z'
    rows[i][8] = 'in-store'
    rows[i][9] = 'synthetic product — never actual retailer data'
    rows[i][10] = '500'
    rows[i][11] = rows[i][6]
    rows[i][12] = '1'
    rows[i][13] = '199'
    rows[i][14] = 'ja'
    rows[i][15] = 'manual-cart'
  }
  return rows
}

test('M3 physical unit families must agree with existing matching semantics', () => {
  for (const [need,pack] of [
    ['g','g'], ['g','kg'], ['kg','g'], ['kg','kg'],
    ['ml','ml'], ['ml','l'], ['l','ml'], ['l','l'], ['piece','piece'],
  ]) assert.equal(sameM3QuantityFamily(need,pack), true, `${need}/${pack}`)
  for (const [need,pack] of [
    ['g','ml'], ['kg','l'], ['ml','kg'], ['l','g'],
    ['piece','g'], ['g','piece'], ['piece','ml'],
    ['unknown','g'], ['g','unknown'], [null,'piece'],
    ['g',{}], ['__proto__','g'], ['g','constructor'],
  ]) assert.equal(sameM3QuantityFamily(need,pack), false, `${need}/${String(pack)}`)
})

test('M3 field reviewer rejects mismatched packaging dimension in either store', () => {
  for (const index of [1, 12]) {
    const rows = fictionalObservations()
    const required = rows[index][6]
    rows[index][11] = ['g','kg'].includes(required) ? 'ml' : 'g'
    const report = reviewM3FieldCsv(csv(rows), { validateUnits: true })
    assert.equal(report.completeRows, 21)
    assert.ok(report.warnings.includes('incompatible-pack-unit'))
    assert.equal(report.status, 'incomplete-or-needs-review')
    assert.equal(report.evidenceVerified, false)
    assert.equal(report.releaseEligible, false)
    assert.equal(report.claimable, false)
    assert.equal(report.savingsCents, null)
    assert.doesNotMatch(JSON.stringify(report), /synthetic product|synthetic test-only source|199/)
  }
})

test('M3 preflight allows cross-unit packs and correctly leaves actual pack purchase to basket engine', () => {
  const rows = fictionalObservations()
  for (let i = 1; i < rows.length; i++) {
    const need = rows[i][6]
    rows[i][11] = ({ g:'kg', kg:'g', ml:'l', l:'ml', piece:'piece' })[need]
    // A 100g single-SKU pack may be purchased more than once for a 1kg
    // requirement; pack_count is inner multipack count, not a purchase count.
    rows[i][10] = need === 'piece' ? '1' : '0.1'
    rows[i][12] = '1'
  }
  const report = reviewM3FieldCsv(csv(rows), { validateUnits: true })
  assert.equal(report.completeRows, 22)
  assert.deepEqual(report.warnings, [])
  assert.equal(report.status, 'requires-canonical-human-verification')
  assert.equal(report.evidenceVerified, false)
  assert.equal(report.releaseEligible, false)
  assert.equal(report.claimable, false)
  assert.equal(report.savingsCents, null)
})

test('M3 explicitly unavailable lines have no pack-unit compatibility requirement', () => {
  const rows = fictionalObservations()
  for (const index of [1, 12]) {
    rows[index][14] = 'nee'
    for (const column of [9,10,11,12,13]) rows[index][column] = ''
  }
  const report = reviewM3FieldCsv(csv(rows), { validateUnits: true })
  assert.equal(report.completeRows, 22)
  assert.deepEqual(report.warnings, [])
  assert.equal(report.status, 'requires-canonical-human-verification')
  assert.equal(report.evidenceVerified, false)
  assert.equal(report.claimable, false)
})


test('M3 piece packs reject fractional/unsafe inner item counts without rejecting fractional mass', () => {
  for (const value of ['0.5', '1.5', '0', '-1', '99999999999999999', '01']) {
    assert.equal(validM3PackPieceAmount(value, 'piece'), false, value)
  }
  for (const value of ['1', '2', '120']) {
    assert.equal(validM3PackPieceAmount(value, 'piece'), true, value)
  }
  assert.equal(validM3PackPieceAmount('0.5', 'g'), true)
  assert.equal(validM3PackPieceAmount('0.5', 'ml'), true)

  const rows = fictionalObservations()
  const pieceLine = rows.findIndex((row,index) => index > 0 && row[6] === 'piece')
  assert.ok(pieceLine > 0, 'canonical 11-demand M3 plan should contain a piece requirement')
  rows[pieceLine][10] = '0.5'
  rows[pieceLine][11] = 'piece'
  const rejected = reviewM3FieldCsv(csv(rows), { validateUnits: true })
  assert.equal(rejected.completeRows, 21)
  assert.ok(rejected.warnings.includes('inconsistent-product-fields'))
  assert.equal(rejected.releaseEligible, false)
  assert.equal(rejected.savingsCents, null)

  rows[pieceLine][10] = '2'
  const valid = reviewM3FieldCsv(csv(rows), { validateUnits: true })
  assert.equal(valid.completeRows, 22)
  assert.deepEqual(valid.warnings, [])
  assert.equal(valid.claimable, false)
  assert.equal(valid.evidenceVerified, false)
})


test('M3 unit validation is explicitly opt-in at the real CLI, preserving the legacy report', () => {
  const dir = mkdtempSync(join(tmpdir(), 'supa-m3-physical-units-'))
  try {
    const path = join(dir, 'private-fake-observations.csv')
    const rows = fictionalObservations()
    rows[1][11] = rows[1][6] === 'piece' ? 'ml' : 'piece'
    writeFileSync(path, csv(rows), { mode: 0o600 })
    const run = (...args) => spawnSync(process.execPath, [
      '--experimental-strip-types', 'scripts/m3-review-field-csv.mjs', ...args,
    ], { encoding: 'utf8' })
    const defaultRun = run(path)
    assert.equal(defaultRun.status, 0, defaultRun.stderr)
    assert.equal(JSON.parse(defaultRun.stdout).completeRows, 22)
    assert.deepEqual(JSON.parse(defaultRun.stdout).warnings, [])

    const stricter = run('--validate-units', path)
    assert.equal(stricter.status, 0, stricter.stderr)
    assert.equal(JSON.parse(stricter.stdout).completeRows, 21)
    assert.ok(JSON.parse(stricter.stdout).warnings.includes('incompatible-pack-unit'))
    assert.equal(JSON.parse(stricter.stdout).releaseEligible, false)
    assert.equal(JSON.parse(stricter.stdout).claimable, false)
    assert.doesNotMatch(stricter.stdout, /private-fake|synthetic product|199/)
    const malformed = run('--validate-units')
    assert.equal(malformed.status, 1)
    assert.equal(malformed.stdout, '')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
