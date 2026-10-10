import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

import { buildOneStoreBasket } from '../src/domain/basket.ts'
import { assessWeeklyBasketStudy } from '../src/domain/observedBasketStudy.ts'
import { buildObservedWeekReport } from '../scripts/m3-assess-observed-week.mjs'
import { buildWeeklyBasketStudyFromObservationSheet } from '../scripts/m3-build-observed-study.mjs'
import { buildObservationSheet } from '../src/domain/m3ObservationSheet.ts'
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

test('M3 report rejects misleading financial certainty across incomplete source pairs', () => {
  const sources = ['manual-cart', 'receipt', 'consented-export']
  let cases = 0
  for (const baselineSource of sources) {
    for (const candidateSource of sources) {
      for (const priceContext of ['in-store', 'online-order']) {
        const study = syntheticStudy()
        study.baseline.basket.store.name = 'PLUS synthetic QA only'
        study.candidate.basket.store.name = 'DekaMarkt synthetic QA only'
        study.baseline.source = baselineSource
        study.candidate.source = candidateSource
        study.priceContext = priceContext
        study.candidate.evidenceId = study.baseline.evidenceId
        const original = structuredClone(study)
        const report = buildObservedWeekReport(study)

        assert.equal(report.claimable, false)
        assert.equal(report.outcome, 'unknown')
        assert.equal(report.deltaCents, null)
        assert.equal(report.savingsCents, null)
        assert.equal(report.publicSavingsClaimEligible, false)
        assert.equal(report.baseline.source, baselineSource)
        assert.equal(report.candidate.source, candidateSource)
        assert.match(report.reasons.join(' '), /evidence IDs must differ/)
        assert.ok(!JSON.stringify(report).includes(study.participantKey))
        assert.deepEqual(study, original)
        cases++
      }
    }
  }
  assert.equal(cases, 18)
})


function syntheticCollectedSheet({
  priceContext = 'in-store',
  baselineSource = 'manual-cart',
  candidateSource = 'manual-cart',
} = {}) {
  const sheet = buildObservationSheet()
  sheet.study.studyId = 'synthetic-converter-matrix-001'
  sheet.study.participantKey = 'synthetic-student-qa-001'
  sheet.study.population = 'Synthetic student test population'
  sheet.study.region = 'Synthetic test region'
  sheet.study.weekStart = '2026-10-05'
  sheet.study.priceContext = priceContext

  for (const [side, source, time, priceOffset] of [
    ['baseline', baselineSource, '2026-10-05T11:00:00Z', 50],
    ['candidate', candidateSource, '2026-10-05T12:00:00Z', 0],
  ]) {
    const observation = sheet[side]
    observation.evidenceId = `synthetic-${side}-evidence-001`
    observation.observedAt = time
    observation.source = source
    observation.provenanceNote = 'Controlled synthetic contract test, no live measurement.'
    observation.store.id = `${side}-synthetic-store`
    observation.store.name = side === 'baseline'
      ? 'PLUS synthetic QA only'
      : 'DekaMarkt synthetic QA only'
    observation.lines.forEach((line, index) => {
      const requirement = sheet.requirements[index]
      line.observedProduct = {
        productId: `${side}-synthetic-${requirement.id}`,
        productName: requirement.query,
        packAmount: requirement.amount,
        packUnit: requirement.unit,
        packCount: 1,
        priceCents: 150 + index + priceOffset,
        available: true,
        sourceUrl: '',
        note: 'Synthetic values: not field observations.',
      }
    })
  }

  return sheet
}

test('M3 observation sheet to study to report retains all permitted source combinations', () => {
  let cases = 0
  for (const priceContext of ['in-store', 'online-order']) {
    for (const baselineSource of ['manual-cart', 'receipt', 'consented-export']) {
      for (const candidateSource of ['manual-cart', 'receipt', 'consented-export']) {
        const sheet = syntheticCollectedSheet({ priceContext, baselineSource, candidateSource })
        const snapshot = structuredClone(sheet)
        const study = buildWeeklyBasketStudyFromObservationSheet(sheet)
        const report = buildObservedWeekReport(study)

        assert.equal(study.baseline.source, baselineSource)
        assert.equal(study.candidate.source, candidateSource)
        assert.equal(report.priceContext, priceContext)
        assert.equal(report.baseline.source, baselineSource)
        assert.equal(report.candidate.source, candidateSource)
        assert.equal(report.claimable, true)
        assert.equal(report.outcome, 'better')
        assert.equal(report.observationWindowHours, 1)
        assert.equal(report.publicSavingsClaimEligible, false)
        assert.ok(!JSON.stringify(report).includes(sheet.study.participantKey))
        assert.deepEqual(sheet, snapshot, 'converter must not mutate collected data')
        cases++
      }
    }
  }
  assert.equal(cases, 18)
})

test('M3 sheet-to-report evidence gaps remain non-claimable across source pairings', () => {
  const gaps = [
    ['unavailable', (product) => { product.available = false }],
    ['unknown price', (product) => { product.priceCents = null }],
    ['missing product identity', (product) => { product.productName = '' }],
  ]
  let cases = 0
  for (const priceContext of ['in-store', 'online-order']) {
    for (const baselineSource of ['manual-cart', 'receipt', 'consented-export']) {
      for (const candidateSource of ['manual-cart', 'receipt', 'consented-export']) {
        for (const [description, invalidate] of gaps) {
          const sheet = syntheticCollectedSheet({ priceContext, baselineSource, candidateSource })
          invalidate(sheet.candidate.lines[0].observedProduct)
          const before = structuredClone(sheet)
          const study = buildWeeklyBasketStudyFromObservationSheet(sheet)
          const report = buildObservedWeekReport(study)

          assert.equal(study.candidate.basket.unresolvedLineCount, 1, description)
          assert.equal(report.claimable, false, description)
          assert.equal(report.outcome, 'unknown', description)
          assert.equal(report.deltaCents, null, description)
          assert.equal(report.savingsCents, null, description)
          assert.equal(report.publicSavingsClaimEligible, false, description)
          assert.equal(report.baseline.source, baselineSource)
          assert.equal(report.candidate.source, candidateSource)
          assert.equal(report.priceContext, priceContext)
          assert.match(report.reasons.join(' '), /unresolved ingredients/)
          assert.ok(!JSON.stringify(report).includes(sheet.study.participantKey))
          assert.deepEqual(sheet, before, 'invalid evidence must never be mutated')
          cases++
        }
      }
    }
  }
  assert.equal(cases, 54)
})

test('M3 two-command field pipeline distinguishes complete from incomplete synthetic collections', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'supa-m3-pipeline-qa-'))
  try {
    for (const incomplete of [false, true]) {
      const sheet = syntheticCollectedSheet({
        priceContext: 'in-store',
        baselineSource: 'receipt',
        candidateSource: 'consented-export',
      })
      const privateMarker = 'QA-ONLY-PRIVATE-NOTE-MUST-NOT-BE-REPORTED'
      sheet.baseline.provenanceNote = privateMarker
      sheet.candidate.provenanceNote = privateMarker
      if (incomplete) sheet.candidate.lines[0].observedProduct.priceCents = null

      const suffix = incomplete ? 'incomplete' : 'complete'
      const input = join(directory, `${suffix}-collection.json`)
      const studyFile = join(directory, `${suffix}-study.json`)
      const reportFile = join(directory, `${suffix}-report.json`)
      const serializedSheet = JSON.stringify(sheet)
      await writeFile(input, serializedSheet, { encoding: 'utf8', mode: 0o600 })

      const convert = spawnSync(process.execPath, [
        '--experimental-strip-types',
        'scripts/m3-build-observed-study.mjs',
        input,
        '--output',
        studyFile,
      ], { cwd: process.cwd(), encoding: 'utf8' })
      assert.equal(convert.status, 0, convert.stderr)
      const converted = JSON.parse(await readFile(studyFile, 'utf8'))
      assert.equal(converted.baseline.source, 'receipt')
      assert.equal(converted.candidate.source, 'consented-export')
      assert.equal(converted.candidate.basket.unresolvedLineCount, incomplete ? 1 : 0)

      const assess = spawnSync(process.execPath, [
        '--experimental-strip-types',
        'scripts/m3-assess-observed-week.mjs',
        studyFile,
        '--output',
        reportFile,
      ], { cwd: process.cwd(), encoding: 'utf8' })
      assert.equal(assess.status, 0, assess.stderr)
      const serializedReport = await readFile(reportFile, 'utf8')
      const report = JSON.parse(serializedReport)
      assert.equal(report.claimable, !incomplete)
      assert.equal(report.outcome, incomplete ? 'unknown' : 'better')
      assert.equal(report.savingsCents === null, incomplete)
      assert.equal(report.deltaCents === null, incomplete)
      assert.equal(report.publicSavingsClaimEligible, false)
      assert.equal(report.baseline.source, 'receipt')
      assert.equal(report.candidate.source, 'consented-export')
      assert.ok(!serializedReport.includes(sheet.study.participantKey))
      assert.ok(!serializedReport.includes(privateMarker))
      assert.equal(await readFile(input, 'utf8'), serializedSheet)
    }
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
