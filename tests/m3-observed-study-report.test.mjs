import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'

import { buildOneStoreBasket } from '../src/domain/basket.ts'
import { compareFullBaskets } from '../src/domain/basketComparison.ts'
import {
  buildObservedWeekReport,
  validateObservedWeekInput,
} from '../scripts/m3-assess-observed-week.mjs'
import {
  m2DefaultActiveDays,
  m2InitialPlan,
  m2Products,
  m2Recipes,
} from '../src/data/m2Fixture.ts'

const baselineStore = { id: 'study-a', name: 'Study store A' }
const candidateStore = { id: 'study-b', name: 'Study store B' }

function completeProducts(storeId, delta = 0) {
  return [
    ...m2Products.map((product) => ({
      ...product,
      id: `${storeId}-${product.id}`,
      storeId,
      priceCents: product.priceCents + delta,
    })),
    {
      id: `${storeId}-garam-50`,
      storeId,
      name: 'Garam masala 50 g',
      packAmount: 50,
      packUnit: 'g',
      available: true,
      priceCents: 139 + delta,
    },
  ]
}

function basket(store, delta = 0) {
  return buildOneStoreBasket({
    store,
    plan: m2InitialPlan,
    recipes: m2Recipes,
    activeDays: m2DefaultActiveDays,
    products: completeProducts(store.id, delta),
  })
}

function observedStudy(overrides = {}) {
  return {
    schemaVersion: 1,
    studyId: 'week-2026-40-runner',
    participantKey: 'student-002',
    population: 'independently living students',
    region: 'Leiden',
    weekStart: '2026-09-28',
    baseline: {
      evidenceId: 'runner-baseline-001',
      observedAt: '2026-10-02T17:00:00Z',
      source: 'manual-cart',
      provenanceNote: 'Synthetic regression observation for CLI protocol testing.',
      basket: basket(baselineStore, 0),
    },
    candidate: {
      evidenceId: 'runner-candidate-001',
      observedAt: '2026-10-02T18:00:00Z',
      source: 'manual-cart',
      provenanceNote: 'Synthetic regression observation for CLI protocol testing.',
      basket: basket(candidateStore, -10),
    },
    ...overrides,
  }
}

test('M3 report runner keeps participant key out of the emitted assessment', () => {
  const report = buildObservedWeekReport(observedStudy())

  assert.equal(report.claimable, true)
  assert.equal(report.outcome, 'better')
  assert.equal(report.publicSavingsClaimEligible, false)
  assert.ok(report.savingsCents > 0)
  assert.equal(report.attribution.status, 'partial')
  assert.equal(report.attribution.effectTotals.unknownCents, report.deltaCents)
  assert.equal('participantKey' in report, false)
  assert.match(report.evidenceBoundary, /never sufficient/)
})

test('M3 report runner preserves unknown evidence without inventing a money delta', () => {
  const study = observedStudy()
  study.candidate = {
    ...study.candidate,
    basket: buildOneStoreBasket({
      store: candidateStore,
      plan: m2InitialPlan,
      recipes: m2Recipes,
      activeDays: m2DefaultActiveDays,
      products: completeProducts(candidateStore.id, -10).filter(
        (product) => !product.id.endsWith('garam-50'),
      ),
    }),
  }

  const report = buildObservedWeekReport(study)

  assert.equal(report.claimable, false)
  assert.equal(report.outcome, 'unknown')
  assert.equal(report.deltaCents, null)
  assert.equal(report.savingsCents, null)
  assert.equal(report.attribution.status, 'unknown')
  assert.equal(report.attribution.effectTotals.unknownCents, null)
  assert.match(report.reasons.join(' '), /unresolved ingredients/)
})

test('M3 observed input preflight rejects missing nested basket evidence with a path-specific error', () => {
  const study = observedStudy()
  study.candidate = {
    ...study.candidate,
    basket: null,
  }

  assert.throws(
    () => validateObservedWeekInput(study),
    /candidate\.basket must be an object/,
  )
})

test('M3 observed input preflight rejects inconsistent observed line money', () => {
  const study = observedStudy()
  const matchedIndex = study.baseline.basket.lines.findIndex(
    (line) => line.status === 'matched',
  )
  assert.ok(matchedIndex >= 0)

  study.baseline.basket.lines[matchedIndex] = {
    ...study.baseline.basket.lines[matchedIndex],
    lineTotalCents:
      study.baseline.basket.lines[matchedIndex].lineTotalCents + 1,
  }

  assert.throws(
    () => buildObservedWeekReport(study),
    /lineTotalCents must equal packs × pricePerPackCents/,
  )
})

test('M3 CLI writes a reproducible assessment report file', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'supa-m3-report-'))
  const input = join(directory, 'study.json')
  const output = join(directory, 'report.json')

  try {
    await writeFile(input, JSON.stringify(observedStudy(), null, 2), 'utf8')

    const result = spawnSync(
      process.execPath,
      [
        '--experimental-strip-types',
        'scripts/m3-assess-observed-week.mjs',
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

    const report = JSON.parse(await readFile(output, 'utf8'))
    assert.equal(report.reportType, 'm3-observed-week-assessment')
    assert.equal(report.studyId, 'week-2026-40-runner')
    assert.equal(report.claimable, true)
    assert.equal(report.publicSavingsClaimEligible, false)
    assert.equal(report.attribution.status, 'partial')
    assert.equal('participantKey' in report, false)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('M3 CLI fails before report generation when collected JSON is structurally incomplete', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'supa-m3-malformed-'))
  const input = join(directory, 'study.json')
  const output = join(directory, 'report.json')

  try {
    await writeFile(
      input,
      JSON.stringify({
        schemaVersion: 1,
        studyId: 'week-2026-40-malformed',
      }),
      'utf8',
    )

    const result = spawnSync(
      process.execPath,
      [
        '--experimental-strip-types',
        'scripts/m3-assess-observed-week.mjs',
        input,
        '--output',
        output,
      ],
      {
        cwd: process.cwd(),
        encoding: 'utf8',
      },
    )

    assert.equal(result.status, 1)
    assert.match(result.stderr, /participantKey must be a non-empty string/)
    await assert.rejects(readFile(output, 'utf8'), /ENOENT/)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})


test('M3 observed report emits complete evidence-backed effect attribution', () => {
  const study = observedStudy()
  const comparison = compareFullBaskets({
    baseline: study.baseline.basket,
    candidate: study.candidate.basket,
  })
  study.attributionEvidence = comparison.lineDeltas
    .filter((line) => line.deltaCents !== 0)
    .map((line) => ({
      lineId: line.id,
      effect: 'offer',
      deltaCents: line.deltaCents,
      evidenceRef: `synthetic-regression:${line.id}`,
    }))

  const report = buildObservedWeekReport(study)

  assert.equal(report.claimable, true)
  assert.equal(report.attribution.status, 'complete')
  assert.equal(report.attribution.fullyAttributed, true)
  assert.equal(report.attribution.effectTotals.offerCents, report.deltaCents)
  assert.equal(report.attribution.effectTotals.packSizeCents, 0)
  assert.equal(report.attribution.effectTotals.planningCents, 0)
  assert.equal(report.attribution.effectTotals.unknownCents, 0)
})

test('M3 observed report fails malformed attribution evidence closed without crashing', () => {
  const study = observedStudy()
  const comparison = compareFullBaskets({
    baseline: study.baseline.basket,
    candidate: study.candidate.basket,
  })
  study.attributionEvidence = [
    {
      lineId: comparison.lineDeltas[0].id,
      effect: 'mystery-effect',
      deltaCents: comparison.lineDeltas[0].deltaCents,
      evidenceRef: 'synthetic-regression:bad-effect',
    },
  ]

  const report = buildObservedWeekReport(study)

  assert.equal(report.claimable, true)
  assert.equal(report.attribution.status, 'unknown')
  assert.equal(report.attribution.fullyAttributed, false)
  assert.equal(report.attribution.effectTotals.unknownCents, null)
  assert.match(report.attribution.reasons.join(' '), /unsupported effect/)
})

test('M3 observed input preflight rejects non-array attribution evidence', () => {
  const study = observedStudy({ attributionEvidence: {} })

  assert.throws(
    () => validateObservedWeekInput(study),
    /attributionEvidence must be an array when provided/,
  )
})
