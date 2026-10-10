import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

import { buildOneStoreBasket } from '../src/domain/basket.ts'
import { assessWeeklyBasketStudy } from '../src/domain/observedBasketStudy.ts'
import { buildObservedWeekReport } from '../scripts/m3-assess-observed-week.mjs'
import {
  m2DefaultActiveDays,
  m2InitialPlan,
  m2Products,
  m2Recipes,
} from '../src/data/m2Fixture.ts'

// Controlled fixture prices only: these are not PLUS/DekaMarkt observations.
const stores = [
  { id: 'synthetic-baseline-qa', name: 'Synthetic baseline' },
  { id: 'synthetic-candidate-qa', name: 'Synthetic candidate' },
]

function basket(store, offsetCents) {
  const products = [
    ...m2Products.map((product) => ({
      ...product,
      id: `${store.id}-${product.id}`,
      storeId: store.id,
      priceCents: product.priceCents + offsetCents,
    })),
    {
      id: `${store.id}-garam-50`,
      storeId: store.id,
      name: 'Garam masala 50 g',
      packAmount: 50,
      packUnit: 'g',
      available: true,
      priceCents: 139 + offsetCents,
    },
  ]

  return buildOneStoreBasket({
    // Never share the mutable fixture store with a returned basket under test.
    store: { ...store },
    plan: m2InitialPlan,
    recipes: m2Recipes,
    activeDays: m2DefaultActiveDays,
    products,
  })
}

function syntheticStudy() {
  return {
    schemaVersion: 1,
    studyId: 'synthetic-study-001',
    participantKey: 'synthetic-student-001',
    population: 'Synthetic independently living students',
    region: 'Synthetic QA region',
    weekStart: '2026-10-05',
    priceContext: 'in-store',
    baseline: {
      evidenceId: 'synthetic-evidence-a',
      observedAt: '2026-10-05T11:00:00Z',
      source: 'manual-cart',
      provenanceNote: 'Synthetic test data, not field evidence.',
      basket: basket(stores[0], 0),
    },
    candidate: {
      evidenceId: 'synthetic-evidence-b',
      observedAt: '2026-10-05T12:00:00Z',
      source: 'manual-cart',
      provenanceNote: 'Synthetic test data, not field evidence.',
      basket: basket(stores[1], -5),
    },
  }
}

function assertUnknownWithoutSavings(assessment, expectedReason) {
  assert.equal(assessment.claimable, false)
  assert.equal(assessment.comparison.claimable, false)
  assert.equal(assessment.comparison.outcome, 'unknown')
  assert.equal(assessment.comparison.deltaCents, null)
  assert.equal(assessment.comparison.savingsCents, null)
  assert.deepEqual(assessment.comparison.lineDeltas, [])
  assert.match(assessment.reasons.join(' | '), expectedReason)
}

test('M3 accepts every explicitly allowed observation source pair in both price contexts', () => {
  const sources = ['manual-cart', 'receipt', 'consented-export']
  let combinations = 0
  for (const priceContext of ['in-store', 'online-order']) {
    for (const baselineSource of sources) {
      for (const candidateSource of sources) {
        const study = syntheticStudy()
        study.priceContext = priceContext
        study.baseline.source = baselineSource
        study.candidate.source = candidateSource
        const original = structuredClone(study)
        const assessment = assessWeeklyBasketStudy(study)

        assert.equal(
          assessment.claimable,
          true,
          `${priceContext} / ${baselineSource} / ${candidateSource}: ${assessment.reasons.join('; ')}`,
        )
        assert.equal(assessment.comparison.outcome, 'better')
        assert.equal(assessment.observationWindowHours, 1)
        assert.deepEqual(assessment.reasons, [])
        assert.deepEqual(study, original, 'validation must never rewrite study evidence')
        combinations++
      }
    }
  }
  assert.equal(combinations, 18)
})

test('M3 invalid evidence identity, source or study metadata suppresses all savings values', () => {
  const invalid = [
    ['colliding evidence IDs', (s) => { s.candidate.evidenceId = s.baseline.evidenceId }, /evidence IDs must differ/],
    ['traversal evidence ID', (s) => { s.baseline.evidenceId = '../secret' }, /path-safe evidence key/],
    ['short evidence ID', (s) => { s.candidate.evidenceId = 'a' }, /path-safe evidence key/],
    ['email participant key', (s) => { s.participantKey = 'person@example.invalid' }, /pseudonymous path-safe key/],
    ['path traversal participant key', (s) => { s.participantKey = '../data' }, /pseudonymous path-safe key/],
    ['path traversal study ID', (s) => { s.studyId = '../study' }, /path-safe study key/],
    ['blank region', (s) => { s.region = '  ' }, /region is required/],
    ['blank population', (s) => { s.population = '  ' }, /population is required/],
    ['invalid week', (s) => { s.weekStart = '2026-02-31' }, /weekStart must be a valid/],
    ['mixed price context', (s) => { s.priceContext = 'in-store+online-order' }, /priceContext must/],
    ['unknown source', (s) => { s.candidate.source = 'synthetic-fixture' }, /not an allowed observed source/],
    ['missing provenance', (s) => { s.baseline.provenanceNote = '  ' }, /provenance note is required/],
    ['date-only time', (s) => { s.candidate.observedAt = '2026-10-05' }, /not a valid timestamp/],
    ['invalid attribution container', (s) => { s.attributionEvidence = {} }, /attributionEvidence must be an array/],
    ['identical store IDs', (s) => { s.candidate.basket.store.id = s.baseline.basket.store.id }, /stores must differ/],
  ]

  for (const [label, mutate, reason] of invalid) {
    const study = syntheticStudy()
    mutate(study)
    const original = structuredClone(study)
    const assessment = assessWeeklyBasketStudy(study)
    assertUnknownWithoutSavings(assessment, reason)
    assert.deepEqual(study, original, `${label}: invalid evidence mutated`)
  }
  assert.equal(invalid.length, 15)
})

test('M3 validity is independent from the order of distinct source/evidence identifiers', () => {
  const study = syntheticStudy()
  const original = structuredClone(study)
  const forward = assessWeeklyBasketStudy(study)

  const swapped = structuredClone(study)
  const priorBaseline = swapped.baseline
  swapped.baseline = swapped.candidate
  swapped.candidate = priorBaseline
  const reverse = assessWeeklyBasketStudy(swapped)

  assert.equal(forward.claimable, true)
  assert.equal(reverse.claimable, true)
  assert.equal(forward.comparison.savingsCents, -reverse.comparison.savingsCents)
  assert.equal(forward.comparison.deltaCents, -reverse.comparison.deltaCents)
  assert.equal(forward.observationWindowHours, reverse.observationWindowHours)
  assert.deepEqual(study, original)
})

test('M3 report keeps public savings claims disabled for every allowed evidence source pair', () => {
  let reports = 0
  for (const priceContext of ['in-store', 'online-order']) {
    for (const baselineSource of ['manual-cart', 'receipt', 'consented-export']) {
      for (const candidateSource of ['manual-cart', 'receipt', 'consented-export']) {
        const study = syntheticStudy()
        study.priceContext = priceContext
        study.baseline.source = baselineSource
        study.candidate.source = candidateSource
        // Retailer labels satisfy the structural identity gate; prices remain synthetic.
        study.baseline.basket.store.name = 'PLUS synthetic QA only'
        study.candidate.basket.store.name = 'DekaMarkt synthetic QA only'
        const original = structuredClone(study)
        const report = buildObservedWeekReport(study)
        const json = JSON.stringify(report)

        assert.equal(report.reportType, 'm3-observed-week-assessment')
        assert.equal(report.claimable, true)
        assert.equal(report.outcome, 'better')
        assert.equal(report.publicSavingsClaimEligible, false)
        assert.equal(report.baseline.source, baselineSource)
        assert.equal(report.candidate.source, candidateSource)
        assert.equal(report.priceContext, priceContext)
        assert.ok(!json.includes(study.participantKey), 'participant key must not leak into report')
        assert.match(report.evidenceBoundary, /never sufficient by itself for a public savings claim/)
        assert.deepEqual(study, original, 'report building must not change evidence')
        reports++
      }
    }
  }
  assert.equal(reports, 18)
})

test('M3 report rejects unapproved source labels and anonymizes invalid evidence IDs', () => {
  const incorrectSource = syntheticStudy()
  incorrectSource.baseline.basket.store.name = 'PLUS synthetic QA only'
  incorrectSource.candidate.basket.store.name = 'DekaMarkt synthetic QA only'
  incorrectSource.candidate.source = 'mock-price-source'
  assert.throws(
    () => buildObservedWeekReport(incorrectSource),
    /candidate.source is not an allowed observed source/,
  )

  const collision = syntheticStudy()
  collision.baseline.basket.store.name = 'PLUS synthetic QA only'
  collision.candidate.basket.store.name = 'DekaMarkt synthetic QA only'
  collision.candidate.evidenceId = collision.baseline.evidenceId
  const report = buildObservedWeekReport(collision)
  assert.equal(report.claimable, false)
  assert.equal(report.outcome, 'unknown')
  assert.equal(report.deltaCents, null)
  assert.equal(report.savingsCents, null)
  assert.equal(report.publicSavingsClaimEligible, false)
  assert.match(report.reasons.join(' '), /evidence IDs must differ/)
})

test('M3 assessment CLI keeps stdout and file reports equivalent and pseudonymous', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'supa-m3-source-qa-'))
  const input = join(directory, 'synthetic-study.json')
  const output = join(directory, 'synthetic-report.json')
  const study = syntheticStudy()
  study.baseline.basket.store.name = 'PLUS synthetic QA only'
  study.candidate.basket.store.name = 'DekaMarkt synthetic QA only'
  study.baseline.source = 'receipt'
  study.candidate.source = 'consented-export'
  // Deliberately place a private sentinel where an unchecked report could leak it.
  const privateMarker = 'synthetic-private-evidence-not-for-report'
  study.baseline.provenanceNote = privateMarker
  study.candidate.provenanceNote = privateMarker

  try {
    await writeFile(input, JSON.stringify(study), { encoding: 'utf8', mode: 0o600 })
    const stdout = spawnSync(process.execPath, [
      '--experimental-strip-types',
      'scripts/m3-assess-observed-week.mjs',
      input,
    ], { encoding: 'utf8', cwd: process.cwd() })
    assert.equal(stdout.status, 0, stdout.stderr)
    const direct = JSON.parse(stdout.stdout)

    const fileRun = spawnSync(process.execPath, [
      '--experimental-strip-types',
      'scripts/m3-assess-observed-week.mjs',
      input,
      '--output',
      output,
    ], { encoding: 'utf8', cwd: process.cwd() })
    assert.equal(fileRun.status, 0, fileRun.stderr)
    assert.equal(fileRun.stdout, '')
    const saved = JSON.parse(await readFile(output, 'utf8'))

    assert.deepEqual(saved, direct)
    assert.equal(saved.publicSavingsClaimEligible, false)
    assert.equal(saved.claimable, true)
    assert.equal(saved.baseline.source, 'receipt')
    assert.equal(saved.candidate.source, 'consented-export')
    for (const reportText of [stdout.stdout, JSON.stringify(saved)]) {
      assert.ok(!reportText.includes(study.participantKey))
      assert.ok(!reportText.includes(privateMarker))
      assert.ok(!reportText.includes(study.baseline.basket.lines[0].productId))
    }
  } finally {
    await rm(directory, { force: true, recursive: true })
  }
})

test('M3 invalid CLI input leaves an existing report untouched and emits no savings', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'supa-m3-failed-qa-'))
  const input = join(directory, 'invalid-study.json')
  const output = join(directory, 'prior-reviewed-report.json')
  const originalReport = 'KEEP PRIOR REVIEWED OUTPUT\\n'
  const invalid = syntheticStudy()
  invalid.baseline.basket.store.name = 'PLUS synthetic QA only'
  invalid.candidate.basket.store.name = 'DekaMarkt synthetic QA only'
  invalid.candidate.source = 'unapproved-fixture'

  try {
    await writeFile(input, JSON.stringify(invalid), { encoding: 'utf8', mode: 0o600 })
    await writeFile(output, originalReport, { encoding: 'utf8', mode: 0o600 })
    const result = spawnSync(process.execPath, [
      '--experimental-strip-types',
      'scripts/m3-assess-observed-week.mjs',
      input,
      '--output',
      output,
    ], { encoding: 'utf8', cwd: process.cwd() })
    assert.notEqual(result.status, 0)
    assert.equal(result.stdout, '')
    assert.match(result.stderr, /candidate.source is not an allowed observed source/)
    assert.equal(await readFile(output, 'utf8'), originalReport)
  } finally {
    await rm(directory, { force: true, recursive: true })
  }
})
