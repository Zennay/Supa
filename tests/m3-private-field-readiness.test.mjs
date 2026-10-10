import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { buildObservationSheet } from '../src/domain/m3ObservationSheet.ts'
import { checkFieldSheet } from '../scripts/m3-check-field-readiness.mjs'

function syntheticCompleteSheet() {
  const sheet = buildObservationSheet()
  Object.assign(sheet.study, {
    studyId: 'week-2026-40-check',
    participantKey: 'synthetic-student-key',
    population: 'synthetic students',
    region: 'synthetic region',
    weekStart: '2026-09-28',
    priceContext: 'in-store',
  })

  for (const [side, retailer, storeId, time] of [
    ['baseline', 'PLUS', 'plus-synthetic', '2026-10-04T12:00:00Z'],
    ['candidate', 'DekaMarkt', 'dekamarkt-synthetic', '2026-10-04T13:00:00Z'],
  ]) {
    const store = sheet[side]
    store.store = { id: storeId, name: retailer }
    store.evidenceId = `${side}-synthetic-001`
    store.observedAt = time
    store.provenanceNote = 'Synthetic local test; not genuine retail evidence.'
    store.lines.forEach((line, i) => {
      const requirement = sheet.requirements[i]
      Object.assign(line.observedProduct, {
        productId: `${storeId}-${requirement.id}`,
        productName: requirement.query,
        packAmount: requirement.amount,
        packUnit: requirement.unit,
        packCount: 1,
        priceCents: 130 + i,
        available: true,
        sourceUrl: 'https://private.example.invalid/secret-receipt',
        note: 'SECRET-COLLECTION-NOTE',
      })
    })
  }
  return sheet
}

test('blank canonical sheet has 22 unfinished products and never becomes financial evidence', () => {
  const sheet = buildObservationSheet()
  const before = structuredClone(sheet)
  const report = checkFieldSheet(sheet)

  assert.equal(report.status, 'needs-field-input')
  assert.equal(report.readyForHumanReview, false)
  assert.equal(report.verifiedFieldEvidence, false)
  assert.equal(report.publicSavingsClaimEligible, false)
  assert.deepEqual(report.progress, {
    totalLines: 22,
    availabilityRecorded: 0,
    completeLines: 0,
    metadataCompleted: 0,
    metadataTotal: 16,
  })
  assert.deepEqual(report.nextIncomplete, {
    retailerSide: 'baseline',
    ingredientId: sheet.requirements[0].id,
  })
  assert.match(report.issues.join(' '), /beschikbaarheid/)
  assert.deepEqual(sheet, before)
})

test('synthetically filled same-demand two-store sheet is only ready for human review', () => {
  const sheet = syntheticCompleteSheet()
  const before = structuredClone(sheet)
  const report = checkFieldSheet(sheet)

  assert.equal(report.status, 'ready-for-human-review')
  assert.equal(report.readyForHumanReview, true)
  assert.equal(report.verifiedFieldEvidence, false)
  assert.equal(report.publicSavingsClaimEligible, false)
  assert.equal(report.progress.completeLines, 22)
  assert.equal(report.progress.availabilityRecorded, 22)
  assert.equal(report.progress.metadataCompleted, 16)
  assert.equal(report.observationWindowState, 'within-window')
  assert.deepEqual(report.issues, [])
  assert.equal(report.nextIncomplete, null)
  assert.match(report.evidenceBoundary, /human verification/)
  assert.deepEqual(sheet, before)

  const serialized = JSON.stringify(report)
  for (const secret of [
    'synthetic-student-key', '130', 'SECRET-COLLECTION-NOTE',
    'https://private.example.invalid', 'plus-synthetic', 'candidate-synthetic-001',
  ]) {
    assert.equal(serialized.includes(secret), false, `leaked sensitive input: ${secret}`)
  }
})

test('partial two-store measurement stays incomplete and retains the absolute 24h guard', () => {
  const sheet = syntheticCompleteSheet()
  sheet.candidate.lines[0].observedProduct.available = null
  sheet.candidate.observedAt = '2026-10-05T14:00:00Z'
  const report = checkFieldSheet(sheet)

  assert.equal(report.readyForHumanReview, false)
  assert.equal(report.status, 'needs-field-input')
  assert.equal(report.observationWindowState, 'outside-window')
  assert.deepEqual(report.nextIncomplete, {
    retailerSide: 'candidate',
    ingredientId: sheet.requirements[0].id,
  })
  assert.match(report.issues.join(' '), /maximaal|24/)
})

test('canonical wrong retailer must not be labelled ready', () => {
  const sheet = syntheticCompleteSheet()
  sheet.candidate.store.name = 'Other shop'
  const report = checkFieldSheet(sheet)
  assert.equal(report.status, 'needs-field-input')
  assert.match(report.issues.join(' '), /DekaMarkt/)
})

test('malformed or normalized-away original draft fields are invalid, never silently repaired', () => {
  for (const mutate of [
    (s) => { s.requirements[0].amount = 999 },
    (s) => { s.candidate.lines[0].ingredientId = 'forged' },
    (s) => { s.baseline.lines[0].observedProduct.available = 'yes' },
    (s) => { s.candidate.lines[0].observedProduct.packCount = 0 },
    (s) => { s.baseline.lines[0] = null },
    (s) => { s.candidate.store = null },
    (s) => { s.study.maxObservationWindowHours = 72 },
    (s) => { s.baseline.lines.pop() },
  ]) {
    const sheet = syntheticCompleteSheet()
    mutate(sheet)
    const report = checkFieldSheet(sheet)
    assert.equal(report.status, 'invalid')
    assert.equal(report.readyForHumanReview, false)
    assert.equal(report.publicSavingsClaimEligible, false)
    assert.equal('progress' in report, false)
  }
  for (const scalar of [null, 1, 'sheet', [], {}]) {
    assert.equal(checkFieldSheet(scalar).status, 'invalid')
  }
})

test('converter-only preflight failure cannot be counted as ready', () => {
  const sheet = syntheticCompleteSheet()
  sheet.baseline.observedAt = '2026-02-31T12:00:00Z'
  const report = checkFieldSheet(sheet)
  assert.notEqual(report.status, 'ready-for-human-review')
  assert.ok(report.issues.length > 0)
})

test('read-only CLI prints privacy-safe JSON and leaves input untouched', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'supa-m3-private-preflight-'))
  const path = join(directory, 'field.json')
  const original = JSON.stringify(syntheticCompleteSheet(), null, 2)
  try {
    await writeFile(path, original, { mode: 0o600 })
    const result = spawnSync(
      process.execPath,
      ['--experimental-strip-types', 'scripts/m3-check-field-readiness.mjs', path],
      { cwd: process.cwd(), encoding: 'utf8' },
    )
    assert.equal(result.status, 0, result.stderr)
    const output = JSON.parse(result.stdout)
    assert.equal(output.status, 'ready-for-human-review')
    assert.equal(output.publicSavingsClaimEligible, false)
    assert.equal(result.stdout.includes('SECRET-COLLECTION-NOTE'), false)
    assert.equal(result.stdout.includes('synthetic-student-key'), false)
    assert.equal(await readFile(path, 'utf8'), original)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('invalid JSON fails closed without echoing arbitrary field contents', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'supa-m3-private-preflight-'))
  const path = join(directory, 'bad.json')
  try {
    await writeFile(path, '{ "sensitive": "PERSONAL-CONTACT-INFO", ')
    const result = spawnSync(
      process.execPath,
      ['--experimental-strip-types', 'scripts/m3-check-field-readiness.mjs', path],
      { cwd: process.cwd(), encoding: 'utf8' },
    )
    assert.equal(result.status, 1)
    assert.equal(JSON.parse(result.stdout).status, 'invalid')
    assert.equal((result.stdout + result.stderr).includes('PERSONAL-CONTACT-INFO'), false)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
