// Independent second-line CLI contract validation for M3 report #3778.
// Synthetic PLUS/DekaMarkt observations; every product is unavailable, so
// none of these cases supplies price, consumer evidence, or a savings claim.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { buildObservationSheet } from '../scripts/m3-create-observation-sheet.mjs'
import { buildWeeklyBasketStudyFromObservationSheet } from '../scripts/m3-build-observed-study.mjs'

function syntheticUnavailableStudy() {
  const sheet = buildObservationSheet()
  Object.assign(sheet.study, {
    studyId: 'qa-stdout-protocol-001',
    participantKey: 'fictional-participant-001',
    population: 'fictional qa population',
    region: 'fictional qa region',
    weekStart: '2026-10-12',
    priceContext: 'online-order',
  })
  for (const [side, retailer, time] of [
    ['baseline', 'PLUS', '2026-10-16T09:00:00Z'],
    ['candidate', 'DekaMarkt', '2026-10-16T10:00:00Z'],
  ]) {
    const observation = sheet[side]
    observation.evidenceId = `qa-stdout-${side}-001`
    observation.observedAt = time
    observation.source = 'manual-cart'
    observation.provenanceNote = 'Offline synthetic unavailable basket, no prices.'
    observation.store = { id: `qa-shop-${side}-001`, name: retailer }
    for (const line of observation.lines) line.observedProduct.available = false
  }
  return buildWeeklyBasketStudyFromObservationSheet(sheet)
}

async function invokeStdout(study) {
  const dir = await mkdtemp(join(tmpdir(), 'supa-m3-stdout-protocol-'))
  try {
    const input = join(dir, 'synthetic-input.json')
    await writeFile(input, JSON.stringify(study), { mode: 0o600 })
    return spawnSync(process.execPath, [
      '--experimental-strip-types',
      join(process.cwd(), 'scripts/m3-assess-observed-week.mjs'),
      input,
    ], { encoding: 'utf8', timeout: 30000 })
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

test('M3 stdout CLI: canonical v1 private unavailable basket returns valid unclaimable JSON', async () => {
  const result = await invokeStdout(syntheticUnavailableStudy())
  assert.equal(result.status, 0, result.stderr)
  const report = JSON.parse(result.stdout)
  assert.equal(report.schemaVersion, 1)
  assert.equal(report.claimable, false)
  assert.equal(report.publicSavingsClaimEligible, false)
  assert.equal(report.savingsCents, null)
  assert.equal(report.outcome, 'unknown')
  assert.equal('participantKey' in report, false)
})

test('M3 stdout CLI: Gregorian century leap day remains canonical (year 2000)', async () => {
  const study = syntheticUnavailableStudy()
  study.weekStart = '2000-02-29'
  const result = await invokeStdout(study)
  assert.equal(result.status, 0, result.stderr)
  const report = JSON.parse(result.stdout)
  assert.equal(report.weekStart, '2000-02-29')
  assert.equal(report.claimable, false)
  assert.equal(report.publicSavingsClaimEligible, false)
})

for (const [field, badValue] of [
  ['schemaVersion', 2],
  ['schemaVersion', -1],
  ['weekStart', '1900-02-29'],
  ['weekStart', '2000-02-30'],
  ['weekStart', '2026-04-31'],
  ['weekStart', '2026-10-12 '],
  ['weekStart', '\uFEFF2026-10-12'],
]) {
  test(`M3 stdout CLI must refuse malformed ${field} ${JSON.stringify(badValue)} before emitting report JSON`, async () => {
    const study = syntheticUnavailableStudy()
    study[field] = badValue
    const result = await invokeStdout(study)
    assert.notEqual(result.status, 0, 'reporting CLI must exit nonzero on invalid input')
    assert.equal(result.stdout, '', 'malformed evidence must not produce a plausible JSON report')
    assert.doesNotMatch(result.stderr, /fictional-participant-001|qa-shop-(?:baseline|candidate)-001/,
      'failure must not disclose test-only private evidence identifiers')
  })
}
