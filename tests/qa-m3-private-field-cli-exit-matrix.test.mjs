import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import {
  buildObservationSheet,
  withObservedProductAvailability,
} from '../src/domain/m3ObservationSheet.ts'
import { checkFieldSheet } from '../scripts/m3-check-field-readiness.mjs'

const CHECKER = 'scripts/m3-check-field-readiness.mjs'
const PRIVATE_MARKER = 'SYNTHETIC_PRIVATE_PARTICIPANT_KEY'

function filledSheet() {
  const sheet = buildObservationSheet()
  Object.assign(sheet.study, {
    studyId: 'week-2026-40-independent-qa',
    participantKey: 'qa-private-pseudonym-001',
    population: 'synthetic-students',
    region: 'synthetic-region',
    weekStart: '2026-09-28',
    priceContext: 'in-store',
  })
  const descriptions = [
    ['baseline', 'PLUS Leiden QA', 'plus-qa-location', '2026-10-04T12:00:00Z'],
    ['candidate', 'DekaMarkt Leiden QA', 'dekamarkt-qa-location', '2026-10-04T13:00:00Z'],
  ]

  for (const [side, name, id, at] of descriptions) {
    const store = sheet[side]
    store.evidenceId = `${side}-evidence-qa`
    store.observedAt = at
    store.provenanceNote = 'PRIVATE-RECEIPT-NOTE-DO-NOT-LOG'
    store.store = { id, name }
    store.lines.forEach((line, index) => {
      const req = sheet.requirements[index]
      Object.assign(line.observedProduct, {
        productId: `${side}-product-${index}`,
        productName: req.query,
        packAmount: req.amount,
        packUnit: req.unit,
        packCount: 1,
        priceCents: 200 + index,
        available: true,
        sourceUrl: 'https://private.example.invalid/receipt?secret=PRIVATE',
        note: PRIVATE_MARKER,
      })
    })
  }
  return sheet
}

async function withPrivateSheet(sheet, action) {
  const directory = await mkdtemp(join(tmpdir(), 'supa-qa-field-cli-'))
  const filename = join(directory, 'collected-sheet.json')
  const data = JSON.stringify(sheet)
  try {
    await writeFile(filename, data, { mode: 0o600 })
    const result = spawnSync(
      process.execPath,
      ['--experimental-strip-types', CHECKER, filename],
      { cwd: process.cwd(), encoding: 'utf8' },
    )
    await action(result, data)
    assert.equal(await readFile(filename, 'utf8'), data, 'field evidence must never be changed by checker')
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

function mustNotClaimMoney(report) {
  assert.equal(report.verifiedFieldEvidence, false)
  assert.equal(report.publicSavingsClaimEligible, false)
  assert.equal('savingsCents' in report, false)
  assert.equal('participantKey' in report, false)
  assert.equal('sourceUrl' in report, false)
  assert.equal('provenanceNote' in report, false)
}

test('QA independent: canonical completed sheet is review-only, never claimable money', async () => {
  const sheet = filledSheet()
  await withPrivateSheet(sheet, async (result) => {
    assert.equal(result.status, 0, result.stderr)
    const report = JSON.parse(result.stdout)
    assert.equal(report.status, 'ready-for-human-review')
    assert.equal(report.progress.totalLines, 22)
    assert.equal(report.progress.completeLines, 22)
    assert.equal(report.observationWindowState, 'within-window')
    assert.equal(report.nextIncomplete, null)
    mustNotClaimMoney(report)
    for (const privatePart of [PRIVATE_MARKER, 'PRIVATE-RECEIPT-NOTE', 'private.example.invalid', '200', 'qa-private-pseudonym-001']) {
      assert.equal((result.stdout + result.stderr).includes(privatePart), false)
    }
  })
})

test('QA independent: a blank field sheet must fail process-level readiness, not only JSON status', async () => {
  await withPrivateSheet(buildObservationSheet(), async (result) => {
    const report = JSON.parse(result.stdout)
    assert.equal(report.status, 'needs-field-input')
    assert.equal(report.readyForHumanReview, false)
    mustNotClaimMoney(report)
    // Crucial integration boundary: automated wrappers inspect process status.
    // Exit zero on an incomplete field run would falsely green-light collection.
    assert.equal(result.status, 2, 'incomplete field checklist must have a distinct nonzero exit')
  })
})

test('QA independent: 24h+1min observed pair must not exit successfully', async () => {
  const sheet = filledSheet()
  sheet.candidate.observedAt = '2026-10-05T12:01:00Z'
  await withPrivateSheet(sheet, async (result) => {
    const report = JSON.parse(result.stdout)
    assert.equal(report.status, 'needs-field-input')
    assert.equal(report.observationWindowState, 'outside-window')
    assert.match(report.issues.join(' '), /24|maximaal/)
    mustNotClaimMoney(report)
    assert.equal(result.status, 2)
  })
})

test('QA independent: exactly 24 absolute hours with offset is allowed, not DST-clock-hour based', () => {
  const sheet = filledSheet()
  sheet.baseline.observedAt = '2026-10-24T13:00:00+02:00'
  sheet.candidate.observedAt = '2026-10-25T11:00:00Z'
  const report = checkFieldSheet(sheet)
  assert.equal(report.status, 'ready-for-human-review')
  assert.equal(report.observationWindowState, 'within-window')
  assert.equal(report.readyForHumanReview, true)
  mustNotClaimMoney(report)

  sheet.candidate.observedAt = '2026-10-25T11:00:00.001Z'
  const expired = checkFieldSheet(sheet)
  assert.equal(expired.status, 'needs-field-input')
  assert.equal(expired.observationWindowState, 'outside-window')
  mustNotClaimMoney(expired)
})

test('QA independent: explicitly unavailable lines remain unknown, not fabricated products', () => {
  const sheet = filledSheet()
  sheet.baseline.lines[0].observedProduct = withObservedProductAvailability(
    sheet.baseline.lines[0].observedProduct, false,
  )
  const report = checkFieldSheet(sheet)
  assert.notEqual(report.status, 'invalid')
  assert.equal(report.progress.availabilityRecorded, 22)
  mustNotClaimMoney(report)
})

test('QA independent: missing price returns non-success and a canonical next collection task', async () => {
  const sheet = filledSheet()
  sheet.candidate.lines[1].observedProduct.priceCents = null
  await withPrivateSheet(sheet, async (result) => {
    const report = JSON.parse(result.stdout)
    assert.equal(report.status, 'needs-field-input')
    assert.deepEqual(report.nextIncomplete, {
      retailerSide: 'candidate',
      ingredientId: sheet.requirements[1].id,
    })
    mustNotClaimMoney(report)
    assert.equal(result.status, 2)
    assert.equal(result.stdout.includes(PRIVATE_MARKER), false)
  })
})

test('QA independent: malformed JSON and canonical demand tampering use invalid exit 1', async () => {
  const sheet = filledSheet()
  sheet.requirements[0].amount += 1
  await withPrivateSheet(sheet, async (result) => {
    const report = JSON.parse(result.stdout)
    assert.equal(report.status, 'invalid')
    assert.equal(result.status, 1)
    mustNotClaimMoney(report)
    assert.equal(result.stdout.includes(PRIVATE_MARKER), false)
  })

  await withPrivateSheet({ value: 'PRIVATE-RECEIPT-NOTE-DO-NOT-LOG' }, async (result) => {
    const report = JSON.parse(result.stdout)
    assert.equal(report.status, 'invalid')
    assert.equal(result.status, 1)
    mustNotClaimMoney(report)
    assert.equal(result.stdout.includes('PRIVATE-RECEIPT-NOTE'), false)
  })
})
