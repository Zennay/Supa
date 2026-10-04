import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'

import { buildObservationSheet } from '../scripts/m3-create-observation-sheet.mjs'
import {
  observationSheetProgress,
  observationWindowSummary,
} from '../src/domain/m3ObservationSheet.ts'

function requirement(sheet, id) {
  return sheet.requirements.find((item) => item.id === id)
}

test('M3 observation sheet derives the exact default-week demand', () => {
  const sheet = buildObservationSheet()

  assert.equal(sheet.schemaVersion, 1)
  assert.equal(sheet.sheetType, 'm3-manual-cart-observation-sheet')
  assert.equal(sheet.evidenceStatus, 'collection-template-not-evidence')
  assert.equal(sheet.selectedMealCount, 4)
  assert.equal(sheet.requirements.length, 11)

  assert.deepEqual(requirement(sheet, 'chicken-thigh'), {
    id: 'chicken-thigh',
    label: 'Kippendij',
    query: 'kippendij',
    amount: 600,
    unit: 'g',
  })
  assert.equal(requirement(sheet, 'basmati-rice').amount, 450)
  assert.equal(requirement(sheet, 'coconut-milk').amount, 400)
  assert.equal(requirement(sheet, 'cauliflower').amount, 2)
  assert.equal(requirement(sheet, 'garam-masala').amount, 20)
})

test('M3 observation sheet gives both stores the same demand and blank evidence fields', () => {
  const sheet = buildObservationSheet()

  for (const side of ['baseline', 'candidate']) {
    assert.equal(sheet[side].source, 'manual-cart')
    assert.equal(sheet[side].evidenceId, '')
    assert.equal(sheet[side].observedAt, '')
    assert.equal(sheet[side].store.id, '')
    assert.equal(sheet[side].lines.length, sheet.requirements.length)

    assert.deepEqual(
      sheet[side].lines.map((line) => line.requirement),
      sheet.requirements.map(({ amount, unit }) => ({ amount, unit })),
    )
    assert.ok(
      sheet[side].lines.every(
        (line) =>
          line.observedProduct.priceCents === null &&
          line.observedProduct.available === null &&
          line.observedProduct.productName === '',
      ),
    )
  }
})

test('M3 observation progress counts explicit availability without inventing evidence', () => {
  const sheet = buildObservationSheet()
  let progress = observationSheetProgress(sheet)

  assert.equal(progress.totalLines, 22)
  assert.equal(progress.availabilityRecorded, 0)
  assert.equal(progress.metadataCompleted, 0)
  assert.equal(progress.metadataTotal, 16)

  sheet.baseline.lines[0].observedProduct.available = false
  sheet.baseline.store.name = 'Observed store'
  progress = observationSheetProgress(sheet)

  assert.equal(progress.availabilityRecorded, 1)
  assert.equal(progress.metadataCompleted, 1)
})

test('M3 observation sheet does not prefill participant identity or savings evidence', () => {
  const sheet = buildObservationSheet()

  assert.equal(sheet.study.participantKey, '')
  assert.equal(sheet.study.population, '')
  assert.equal(sheet.study.region, '')
  assert.equal(sheet.study.weekStart, '')
  assert.equal(sheet.study.priceContext, '')
  assert.equal(sheet.study.maxObservationWindowHours, 24)
  assert.match(sheet.instructions.join(' '), /do not guess/i)
  assert.match(sheet.instructions.join(' '), /pseudonymous/i)
})

test('M3 observation sheet CLI creates nested output directories', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'supa-m3-observation-'))
  const output = join(directory, 'artifacts', 'm3', 'observation-sheet.json')

  try {
    const result = spawnSync(
      process.execPath,
      [
        '--experimental-strip-types',
        'scripts/m3-create-observation-sheet.mjs',
        '--output',
        output,
      ],
      {
        cwd: process.cwd(),
        encoding: 'utf8',
      },
    )

    assert.equal(result.status, 0, result.stderr)
    const sheet = JSON.parse(await readFile(output, 'utf8'))
    assert.equal(sheet.evidenceStatus, 'collection-template-not-evidence')
    assert.equal(sheet.requirements.length, 11)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('M3 observation window exposes the second-store deadline after the first measurement', () => {
  const sheet = buildObservationSheet()
  sheet.baseline.observedAt = '2026-10-04T10:00:00.000Z'

  const single = observationWindowSummary(sheet)

  assert.equal(single.state, 'single-observation')
  assert.equal(single.firstSide, 'baseline')
  assert.equal(single.firstObservedAt, '2026-10-04T10:00:00.000Z')
  assert.equal(single.deadlineAt, '2026-10-05T10:00:00.000Z')

  sheet.candidate.observedAt = '2026-10-05T09:30:00.000Z'
  const validPair = observationWindowSummary(sheet)
  assert.equal(validPair.state, 'within-window')
  assert.equal(validPair.deltaHours, 23.5)

  sheet.candidate.observedAt = '2026-10-05T10:30:00.000Z'
  const expiredPair = observationWindowSummary(sheet)
  assert.equal(expiredPair.state, 'outside-window')
  assert.equal(expiredPair.deltaHours, 24.5)
})

