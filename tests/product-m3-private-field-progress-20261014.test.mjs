import assert from 'node:assert/strict'
import test from 'node:test'
import { spawnSync } from 'node:child_process'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { buildObservationSheet } from '../src/domain/m3ObservationSheet.ts'
import { buildPrivateM3FieldProgress } from '../scripts/m3-private-field-progress.mjs'

const cli = fileURLToPath(new URL('../scripts/m3-private-field-progress.mjs', import.meta.url))
const canary = 'FICTIONAL_PRIVATE_PERSON_AND_PRICE_DO_NOT_PRINT_735'
const clock = Date.parse('2026-10-14T12:00:00Z')

function syntheticSheet({ filled = false } = {}) {
  const sheet = buildObservationSheet()
  if (filled) {
    Object.assign(sheet.study, {
      studyId: 'fictional-progress-study',
      participantKey: 'fictional-participant',
      population: canary,
      region: 'fictional region',
      weekStart: '2026-10-12',
      priceContext: 'in-store',
    })
    for (const [side, storeName, time] of [
      ['baseline', 'PLUS FICTIONAL', '12:00:00'],
      ['candidate', 'DekaMarkt FICTIONAL', '13:00:00'],
    ]) {
      const row = sheet[side]
      row.evidenceId = side + '-fictional-evidence'
      row.observedAt = '2026-10-12T' + time + 'Z'
      row.source = 'manual-cart'
      row.provenanceNote = canary
      row.store = { id: side + '-fictional-store', name: storeName }
      for (const line of row.lines) line.observedProduct.available = false
    }
  }
  return sheet
}

test('blank M3 22-line canonical sheet reports missing work without financial claims', () => {
  const report = buildPrivateM3FieldProgress(JSON.stringify(syntheticSheet()), clock)
  assert.equal(report.progress.expectedLines, 22)
  assert.equal(report.progress.completeLines, 0)
  assert.equal(report.progress.incompleteLines, 22)
  assert.equal(report.baseline.expectedLines, 11)
  assert.equal(report.candidate.expectedLines, 11)
  assert.equal(report.nextIncomplete.retailer, 'PLUS')
  assert.equal(report.readyForPrivateReview, false)
  assert.equal(report.observationWindow.state, 'not-started')
  assert.equal(report.publicSavingsClaimEligible, false)
})

test('M3 22 complete explicitly unavailable fictional slots remain unverified private review', () => {
  const sheet = syntheticSheet({ filled: true })
  const serialized = JSON.stringify(sheet)
  const report = buildPrivateM3FieldProgress(serialized, clock)
  assert.equal(report.progress.completeLines, 22)
  assert.equal(report.progress.availabilityRecorded, 22)
  assert.equal(report.progress.incompleteLines, 0)
  assert.equal(report.progress.readinessIssueCount, 0)
  assert.equal(report.readyForPrivateReview, true)
  assert.equal(report.verifiedRetailerObservations, false)
  assert.equal(report.publicSavingsClaimEligible, false)
  assert.equal(report.nextIncomplete, null)
  assert.deepEqual(report.observationWindow, { state: 'within-window', deltaHours: 1 })
  assert.doesNotMatch(JSON.stringify(report), new RegExp(canary))
  assert.equal(JSON.stringify(sheet), serialized, 'pure operator report never mutates input')
})

test('partial availability records count only complete physical slots', () => {
  const sheet = syntheticSheet()
  sheet.baseline.lines[0].observedProduct.available = false
  sheet.candidate.lines[0].observedProduct.available = false
  sheet.baseline.lines[1].observedProduct.available = true // pack/price still missing
  const report = buildPrivateM3FieldProgress(JSON.stringify(sheet), clock)
  assert.equal(report.progress.availabilityRecorded, 3)
  assert.equal(report.progress.completeLines, 2)
  assert.equal(report.progress.incompleteLines, 20)
  assert.equal(report.nextIncomplete.retailer, 'PLUS')
  assert.equal(report.nextIncomplete.ingredientId, sheet.baseline.lines[1].ingredientId)
  assert.equal(report.readyForPrivateReview, false)
})

test('malformed or forged planner demand is rejected without publishing caller metadata', () => {
  const malicious = syntheticSheet({ filled: true })
  malicious.baseline.lines.push(malicious.baseline.lines[0])
  assert.equal(buildPrivateM3FieldProgress(JSON.stringify(malicious), clock), null)
  const swapped = syntheticSheet({ filled: true })
  swapped.requirements[0].id = canary
  assert.equal(buildPrivateM3FieldProgress(JSON.stringify(swapped), clock), null)
  assert.equal(buildPrivateM3FieldProgress('not-json-'+canary, clock), null)
  assert.throws(() => buildPrivateM3FieldProgress('{}', NaN), /reference clock/)
})

test('invalid or future capture timestamps cannot appear ready for operator review', () => {
  const sheet = syntheticSheet({ filled: true })
  const beforeObservations = Date.parse('2026-10-11T12:00:00Z')
  const result = buildPrivateM3FieldProgress(JSON.stringify(sheet), beforeObservations)
  assert.equal(result.readyForPrivateReview, false)
  assert.equal(result.observationWindow.state, 'not-started')
  assert.ok(result.progress.readinessIssueCount >= 2)
})

test('M3 CLI emits aggregate JSON only and never includes private fields or paths', async () => {
  const root = await mkdtemp(join(tmpdir(), 'supa-m3-progress-'))
  try {
    const input = join(root, 'sheet.json')
    await writeFile(input, JSON.stringify(syntheticSheet({ filled: true })))
    const result = spawnSync(process.execPath, ['--experimental-strip-types', cli, input], { encoding: 'utf8' })
    assert.equal(result.status, 0, result.stderr)
    assert.equal(result.stderr, '')
    const output = JSON.parse(result.stdout)
    assert.equal(output.progress.completeLines, 22)
    assert.equal(output.reportType, 'm3-private-field-progress')
    assert.doesNotMatch(result.stdout, new RegExp(canary))
    assert.doesNotMatch(result.stdout, /priceCents|productName|participantKey|sourceUrl|provenanceNote|studyId/)
    const missing = spawnSync(process.execPath, ['--experimental-strip-types', cli, join(root, canary, 'missing.json')], { encoding: 'utf8' })
    assert.notEqual(missing.status, 0)
    assert.equal(missing.stdout, '')
    assert.doesNotMatch(missing.stderr, new RegExp(canary))
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
