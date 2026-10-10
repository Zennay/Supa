import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildObservationSheet,
  observationSheetReadiness,
} from '../src/domain/m3ObservationSheet.ts'
import { buildWeeklyBasketStudyFromObservationSheet } from '../scripts/m3-build-observed-study.mjs'

// Independent QA on the existing M3 collector owner #154.
// All prices, products, timestamps and participants here are synthetic fixtures.
// Never use these records as M3 field evidence or as a public savings claim.
function completeSyntheticSheet() {
  const sheet = buildObservationSheet()
  Object.assign(sheet.study, {
    studyId: 'synthetic-canonical-shape-qa',
    participantKey: 'qa-pseudonym-001',
    population: 'Synthetic QA population',
    region: 'synthetic',
    weekStart: '2026-10-05',
    priceContext: 'in-store',
  })
  for (const side of ['baseline', 'candidate']) {
    const observation = sheet[side]
    observation.evidenceId = side + '-synthetic-evidence'
    observation.observedAt = side === 'baseline'
      ? '2026-10-05T09:00:00Z'
      : '2026-10-05T10:00:00Z'
    observation.source = 'manual-cart'
    observation.provenanceNote = 'SYNTHETIC QA ONLY — not a physical shop or receipt'
    observation.store = {
      id: side + '-synthetic-store',
      name: side === 'baseline' ? 'PLUS synthetic' : 'DekaMarkt synthetic',
    }
    observation.lines.forEach((line, index) => {
      const requirement = sheet.requirements[index]
      line.observedProduct = {
        available: true,
        productId: side + '-synthetic-' + requirement.id,
        productName: requirement.query,
        packAmount: requirement.amount,
        packUnit: requirement.unit,
        packCount: 1,
        priceCents: 100 + index,
        sourceUrl: '',
        note: 'Never treat as retailer evidence',
      }
    })
  }
  return sheet
}

test('positive control: canonical 22-line PLUS+DekaMarkt synthetic sheet remains converter-ready', () => {
  const sheet = completeSyntheticSheet()
  const snapshot = structuredClone(sheet)
  assert.deepEqual(observationSheetReadiness(sheet), { ready: true, issues: [] })
  const study = buildWeeklyBasketStudyFromObservationSheet(sheet)
  assert.equal(study.baseline.store.name, 'PLUS synthetic')
  assert.equal(study.candidate.store.name, 'DekaMarkt synthetic')
  assert.equal(study.baseline.basket.lines.length, 11)
  assert.equal(study.candidate.basket.lines.length, 11)
  assert.deepEqual(sheet, snapshot)
})

test('canonical sheet header and demand schema must be validated before preflight says ready', async (t) => {
  const cases = [
    ['schema version', (sheet) => { sheet.schemaVersion = 2 }],
    ['sheet type', (sheet) => { sheet.sheetType = 'old-m3-observation' }],
    ['planner fixture identity', (sheet) => { sheet.plannerFixture = 'm2-stale-week' }],
    ['ingredient query', (sheet) => { sheet.requirements[0].query += '-changed' }],
    ['ingredient label', (sheet) => { sheet.requirements[0].label += '-changed' }],
    ['ingredient unit', (sheet) => { sheet.requirements[0].unit = 'kg' }],
    ['candidate ingredient ID', (sheet) => { sheet.candidate.lines[0].ingredientId = 'wrong-id' }],
    ['candidate ingredient label', (sheet) => { sheet.candidate.lines[0].ingredientLabel += '-changed' }],
    ['candidate demand amount', (sheet) => { sheet.candidate.lines[0].requirement.amount += 1 }],
    ['reordered baseline ingredient lines', (sheet) => { sheet.baseline.lines.reverse() }],
    ['candidate missing final line', (sheet) => { sheet.candidate.lines.pop() }],
  ]
  for (const [name, mutate] of cases) {
    await t.test(name, () => {
      const sheet = completeSyntheticSheet()
      mutate(sheet)
      const snapshot = structuredClone(sheet)
      assert.throws(
        () => buildWeeklyBasketStudyFromObservationSheet(sheet),
        undefined,
        name + ': the canonical downstream converter must reject the changed sheet',
      )
      const readiness = observationSheetReadiness(sheet)
      assert.equal(readiness.ready, false, name + ': preflight must not claim this would convert')
      assert.ok(readiness.issues.length > 0, name + ': user needs a diagnostic before export')
      assert.deepEqual(sheet, snapshot, name + ': field preflight must not silently rewrite evidence')
    })
  }
})
