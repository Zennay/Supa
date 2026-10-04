import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'

import { assessWeeklyBasketStudy } from '../src/domain/observedBasketStudy.ts'
import { buildObservationSheet } from '../scripts/m3-create-observation-sheet.mjs'
import { buildWeeklyBasketStudyFromObservationSheet } from '../scripts/m3-build-observed-study.mjs'

function fillSide(sheet, side, { storeId, storeName, priceOffset = 0 }) {
  const observation = sheet[side]
  observation.evidenceId = `${side}-week-001`
  observation.observedAt =
    side === 'baseline' ? '2026-10-04T12:00:00Z' : '2026-10-04T13:00:00Z'
  observation.source = 'manual-cart'
  observation.provenanceNote = 'Synthetic regression observation only.'
  observation.store.id = storeId
  observation.store.name = storeName

  observation.lines.forEach((line, index) => {
    const requirement = sheet.requirements[index]
    line.observedProduct = {
      productId: `${storeId}-${requirement.id}`,
      productName: requirement.query,
      packAmount: requirement.amount,
      packUnit: requirement.unit,
      packCount: 1,
      priceCents: 100 + index + priceOffset,
      available: true,
      sourceUrl: '',
      note: 'Synthetic regression value.',
    }
  })
}

function completedSheet() {
  const sheet = buildObservationSheet()
  sheet.study.studyId = 'week-2026-40-converter'
  sheet.study.participantKey = 'student-003'
  sheet.study.population = 'independently living students'
  sheet.study.region = 'test-region'
  sheet.study.weekStart = '2026-09-28'
  sheet.study.priceContext = 'in-store'
  fillSide(sheet, 'baseline', {
    storeId: 'store-a',
    storeName: 'Store A',
    priceOffset: 10,
  })
  fillSide(sheet, 'candidate', {
    storeId: 'store-b',
    storeName: 'Store B',
    priceOffset: 0,
  })
  return sheet
}

test('M3 observation sheet converts into a structurally valid claimable weekly study', () => {
  const study = buildWeeklyBasketStudyFromObservationSheet(completedSheet())
  const assessment = assessWeeklyBasketStudy(study)

  assert.equal(study.priceContext, 'in-store')
  assert.equal(study.baseline.basket.matchedLineCount, 11)
  assert.equal(study.baseline.basket.unresolvedLineCount, 0)
  assert.equal(study.candidate.basket.matchedLineCount, 11)
  assert.equal(assessment.claimable, true)
  assert.equal(assessment.comparison.outcome, 'better')
  assert.equal(assessment.observationWindowHours, 1)
})

test('M3 converter preserves an observed unavailable product as unknown evidence', () => {
  const sheet = completedSheet()
  sheet.candidate.lines[0].observedProduct.available = false

  const study = buildWeeklyBasketStudyFromObservationSheet(sheet)
  const assessment = assessWeeklyBasketStudy(study)

  assert.equal(study.candidate.basket.unresolvedLineCount, 1)
  assert.equal(assessment.claimable, false)
  assert.equal(assessment.comparison.outcome, 'unknown')
  assert.match(assessment.reasons.join(' '), /unresolved ingredients/)
})

test('M3 converter preserves a missing observed price as unresolved instead of inventing money', () => {
  const sheet = completedSheet()
  sheet.baseline.lines[1].observedProduct.priceCents = null

  const study = buildWeeklyBasketStudyFromObservationSheet(sheet)
  const line = study.baseline.basket.lines.find(
    (candidate) => candidate.id === sheet.requirements[1].id,
  )

  assert.equal(line.status, 'unresolved')
  assert.match(line.reasons.join(' '), /price is unknown/i)
})

test('M3 converter refuses a missing price context', () => {
  const sheet = completedSheet()
  sheet.study.priceContext = ''

  assert.throws(
    () => buildWeeklyBasketStudyFromObservationSheet(sheet),
    /priceContext must be in-store or online-order/,
  )
})

test('M3 converter refuses planner-demand drift', () => {
  const sheet = completedSheet()
  sheet.requirements[0].amount += 1

  assert.throws(
    () => buildWeeklyBasketStudyFromObservationSheet(sheet),
    /requirements must exactly match the canonical planner demand/,
  )
})

test('M3 converter refuses ambiguous availability types', () => {
  const sheet = completedSheet()
  sheet.baseline.lines[0].observedProduct.available = 'yes'

  assert.throws(
    () => buildWeeklyBasketStudyFromObservationSheet(sheet),
    /available must be true or false/,
  )
})

test('M3 converter CLI writes a nested WeeklyBasketStudy output', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'supa-m3-study-'))
  const input = join(directory, 'observation-sheet.json')
  const output = join(directory, 'evidence', 'm3', 'study.json')

  try {
    await writeFile(input, JSON.stringify(completedSheet(), null, 2), 'utf8')

    const result = spawnSync(
      process.execPath,
      [
        '--experimental-strip-types',
        'scripts/m3-build-observed-study.mjs',
        input,
        '--output',
        output,
      ],
      {
        cwd: process.cwd(),
        encoding: 'utf8',
      },
    )

    assert.equal(result.status, 0, result.stderr)
    const study = JSON.parse(await readFile(output, 'utf8'))
    assert.equal(study.schemaVersion, 1)
    assert.equal(study.studyId, 'week-2026-40-converter')
    assert.equal(study.baseline.basket.matchedLineCount, 11)
    assert.equal(study.candidate.basket.matchedLineCount, 11)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
