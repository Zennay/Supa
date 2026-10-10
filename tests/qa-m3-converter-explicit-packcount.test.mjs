import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

import { assessWeeklyBasketStudy } from '../src/domain/observedBasketStudy.ts'
import { buildObservationSheet } from '../src/domain/m3ObservationSheet.ts'
import { buildWeeklyBasketStudyFromObservationSheet } from '../scripts/m3-build-observed-study.mjs'

// Entirely synthetic. The genuine PLUS + DekaMarkt M3 field pair (#78)
// remains necessary; none of these values are retailer observations.
function completeSyntheticSheet() {
  const sheet = buildObservationSheet()
  Object.assign(sheet.study, {
    studyId: 'qa-packcount-converter-only',
    participantKey: 'synthetic-participant',
    population: 'synthetic test only',
    region: 'synthetic',
    weekStart: '2026-10-05',
    priceContext: 'in-store',
  })

  for (const [side, storeName] of [
    ['baseline', 'PLUS QA'],
    ['candidate', 'DekaMarkt QA'],
  ]) {
    const observation = sheet[side]
    observation.evidenceId = side + '-synthetic-evidence'
    observation.observedAt = side === 'baseline'
      ? '2026-10-05T12:00:00Z'
      : '2026-10-05T13:00:00Z'
    observation.source = 'manual-cart'
    observation.provenanceNote = 'Artificial QA fixture, not an observation'
    observation.store = { id: side + '-synthetic-store', name: storeName }
    observation.lines.forEach((line, index) => {
      const requirement = sheet.requirements[index]
      line.observedProduct = {
        productId: side + '-' + requirement.id,
        productName: requirement.query,
        packAmount: requirement.amount,
        packUnit: requirement.unit,
        packCount: 1,
        priceCents: 100 + index,
        available: true,
        sourceUrl: '',
        note: 'Synthetic pack fixture',
      }
    })
  }
  return sheet
}

for (const validCount of [1, 2]) {
  test('M3 converter accepts explicit valid packCount=' + validCount, () => {
    const sheet = completeSyntheticSheet()
    sheet.baseline.lines[0].observedProduct.packCount = validCount
    const before = structuredClone(sheet)
    const study = buildWeeklyBasketStudyFromObservationSheet(sheet)
    const assessment = assessWeeklyBasketStudy(study)

    assert.equal(study.baseline.basket.matchedLineCount, sheet.requirements.length)
    assert.equal(assessment.claimable, true)
    assert.deepEqual(sheet, before, 'converter must not mutate collection input')
  })
}

const malformedCounts = [
  ['explicit null', null],
  ['explicit undefined', undefined],
  ['field absent', Symbol('delete')],
  ['zero', 0],
  ['negative', -1],
  ['fractional', 1.5],
  ['numeric string', '1'],
  ['unsafe integer', Number.MAX_SAFE_INTEGER + 1],
]

for (const [label, malformed] of malformedCounts) {
  test('M3 converter must not promote ' + label + ' packCount to observed single pack', () => {
    const sheet = completeSyntheticSheet()
    if (typeof malformed === 'symbol') {
      delete sheet.baseline.lines[0].observedProduct.packCount
    } else {
      sheet.baseline.lines[0].observedProduct.packCount = malformed
    }
    const before = structuredClone(sheet)

    // A strict input rejection OR an unresolved line is acceptable. Neither
    // may silently manufacture packCount=1 or a claimable comparison.
    let study
    try {
      study = buildWeeklyBasketStudyFromObservationSheet(sheet)
    } catch (error) {
      assert.match(String(error), /pack|count|quantity|observed/i)
      assert.deepEqual(sheet, before)
      return
    }

    const line = study.baseline.basket.lines[0]
    assert.equal(line.status, 'unresolved', label + ': collection gap must remain unresolved')
    assert.match(line.reasons.join(' '), /pack count|pack quantity/i)
    assert.equal(study.baseline.basket.unresolvedLineCount, 1)
    assert.equal(assessWeeklyBasketStudy(study).claimable, false)
    assert.deepEqual(sheet, before)
  })
}


test('M3 JSON CLI cannot turn an absent pack count into a claimable observed-week report', async () => {
  const sheet = completeSyntheticSheet()
  delete sheet.baseline.lines[0].observedProduct.packCount
  const directory = await mkdtemp(join(tmpdir(), 'supa-qa-m3-pack-count-'))
  const inputPath = join(directory, 'raw-observation.json')
  const studyPath = join(directory, 'converted-study.json')

  try {
    await writeFile(inputPath, JSON.stringify(sheet, null, 2), 'utf8')
    const conversion = spawnSync(process.execPath, [
      '--experimental-strip-types',
      'scripts/m3-build-observed-study.mjs',
      inputPath,
      '--output',
      studyPath,
    ], { cwd: process.cwd(), encoding: 'utf8' })

    // The converter may reject incomplete observations outright, or represent
    // their missing pack count as unresolved. Both are safe.
    if (conversion.status !== 0) {
      assert.match(conversion.stderr, /pack|count|quantity|observed/i)
      await assert.rejects(readFile(studyPath, 'utf8'), { code: 'ENOENT' })
      return
    }

    const converted = JSON.parse(await readFile(studyPath, 'utf8'))
    assert.equal(converted.baseline.basket.lines[0].status, 'unresolved')

    const assessment = spawnSync(process.execPath, [
      '--experimental-strip-types',
      'scripts/m3-assess-observed-week.mjs',
      studyPath,
    ], { cwd: process.cwd(), encoding: 'utf8' })
    assert.equal(assessment.status, 0, assessment.stderr)
    const report = JSON.parse(assessment.stdout)
    assert.equal(report.claimable, false)
    assert.equal(report.outcome, 'unknown')
    assert.equal(report.deltaCents, null)
    assert.equal(report.savingsCents, null)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})


test('M3 evidence gate rejects omitted/null pack count on either retailer side, irrespective of comparison direction', () => {
  for (const side of ['baseline', 'candidate']) {
    for (const omission of ['null', 'missing']) {
      const sheet = completeSyntheticSheet()
      const observed = sheet[side].lines.at(-1).observedProduct
      if (omission === 'null') observed.packCount = null
      else delete observed.packCount
      const original = structuredClone(sheet)
      const study = buildWeeklyBasketStudyFromObservationSheet(sheet)
      const report = assessWeeklyBasketStudy(study)
      const lastLine = study[side].basket.lines.at(-1)

      assert.equal(lastLine.status, 'unresolved', side + ':' + omission)
      assert.equal(study[side].basket.unresolvedLineCount, 1)
      assert.equal(report.claimable, false, side + ':' + omission)
      assert.equal(report.comparison.outcome, 'unknown')
      assert.equal(report.comparison.deltaCents, null)
      assert.equal(report.comparison.savingsCents, null)
      assert.deepEqual(report.comparison.lineDeltas, [])
      assert.deepEqual(sheet, original)
    }
  }
})
