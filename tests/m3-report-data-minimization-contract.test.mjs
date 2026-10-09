import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { buildOneStoreBasket } from '../src/domain/basket.ts'
import { compareFullBaskets } from '../src/domain/basketComparison.ts'
import { buildObservedWeekReport } from '../scripts/m3-assess-observed-week.mjs'
import {
  m2DefaultActiveDays,
  m2InitialPlan,
  m2Products,
  m2Recipes,
} from '../src/data/m2Fixture.ts'

// Synthetic markers are deliberately not real participant or retailer evidence.
const secrets = [
  'private-participant-marker-001',
  'PRIVATE_PROVENANCE_NOTE_001',
  'PRIVATE_PRODUCT_NAME_001',
  'PRIVATE_INGREDIENT_REASON_001',
  'PRIVATE_ATTRIBUTION_REFERENCE_001',
]

const expectedReportFields = [
  'schemaVersion', 'reportType', 'studyId', 'population', 'region', 'weekStart',
  'priceContext', 'baseline', 'candidate', 'claimable', 'outcome',
  'baselineTotalCents', 'candidateTotalCents', 'deltaCents', 'savingsCents',
  'observationWindowHours', 'attribution', 'reasons',
  'publicSavingsClaimEligible', 'evidenceBoundary',
].sort()

const expectedStoreFields = [
  'evidenceId', 'observedAt', 'source', 'storeId', 'storeName', 'totalCents',
  'matchedLineCount', 'unresolvedLineCount',
].sort()

function basket(store, priceAdjustment) {
  const products = [
    ...m2Products.map((product) => ({
      ...product,
      id: store.id + '-' + product.id,
      storeId: store.id,
      priceCents: product.priceCents + priceAdjustment,
    })),
    {
      id: store.id + '-garam-50',
      storeId: store.id,
      name: 'Garam masala 50 g',
      packAmount: 50,
      packUnit: 'g',
      available: true,
      priceCents: 139 + priceAdjustment,
    },
  ]

  return buildOneStoreBasket({
    store,
    plan: m2InitialPlan,
    recipes: m2Recipes,
    activeDays: m2DefaultActiveDays,
    products,
  })
}

function observedStudy() {
  const baselineStore = { id: 'plus-privacy-fixture', name: 'PLUS synthetic fixture' }
  const candidateStore = { id: 'dekamarkt-privacy-fixture', name: 'DekaMarkt synthetic fixture' }

  const study = {
    schemaVersion: 1,
    studyId: 'week-2026-40-privacy',
    participantKey: secrets[0],
    population: 'independently living students',
    region: 'synthetic-test-region',
    weekStart: '2026-09-28',
    priceContext: 'in-store',
    baseline: {
      evidenceId: 'privacy-baseline-001',
      observedAt: '2026-10-02T17:00:00Z',
      source: 'manual-cart',
      provenanceNote: secrets[1],
      basket: basket(baselineStore, 0),
    },
    candidate: {
      evidenceId: 'privacy-candidate-001',
      observedAt: '2026-10-02T18:00:00Z',
      source: 'manual-cart',
      provenanceNote: secrets[1],
      basket: basket(candidateStore, -10),
    },
  }

  for (const side of ['baseline', 'candidate']) {
    const matchedLine = study[side].basket.lines.find((line) => line.status === 'matched')
    assert.ok(matchedLine, 'fixture must contain a matched ingredient')
    matchedLine.productName = secrets[2]
    matchedLine.reasons.push(secrets[3])
  }

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
      evidenceRef: secrets[4],
    }))

  return study
}

function assertMinimised(report) {
  assert.deepEqual(Object.keys(report).sort(), expectedReportFields)
  assert.deepEqual(Object.keys(report.baseline).sort(), expectedStoreFields)
  assert.deepEqual(Object.keys(report.candidate).sort(), expectedStoreFields)
  assert.deepEqual(Object.keys(report.attribution).sort(), [
    'comparisonDeltaCents', 'effectTotals', 'fullyAttributed', 'reasons', 'status',
  ])
  assert.equal(report.publicSavingsClaimEligible, false)
  assert.equal(report.claimable, true, 'fixture exercises the claimable data path')
  assert.equal(report.outcome, 'better')

  const serialized = JSON.stringify(report)
  for (const secret of secrets) {
    assert.equal(serialized.includes(secret), false, 'M3 summary leaked private raw input: ' + secret)
  }
}

test('M3 report exposes only the explicitly reviewed summary schema, not raw observations', () => {
  assertMinimised(buildObservedWeekReport(observedStudy()))
})

test('M3 CLI redacts private observation fields in stdout and output-file modes', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'supa-m3-report-privacy-'))
  const input = join(directory, 'study.json')
  const output = join(directory, 'report.json')

  try {
    await writeFile(input, JSON.stringify(observedStudy()), 'utf8')

    const run = (extraArgs) => spawnSync(
      process.execPath,
      ['--experimental-strip-types', 'scripts/m3-assess-observed-week.mjs', input, ...extraArgs],
      { cwd: process.cwd(), encoding: 'utf8' },
    )

    const stdoutResult = run([])
    assert.equal(stdoutResult.status, 0, stdoutResult.stderr)
    assertMinimised(JSON.parse(stdoutResult.stdout))

    const fileResult = run(['--output', output])
    assert.equal(fileResult.status, 0, fileResult.stderr)
    assert.equal(fileResult.stdout, '')
    const fileReport = JSON.parse(await readFile(output, 'utf8'))
    assertMinimised(fileReport)
    assert.deepEqual(fileReport, JSON.parse(stdoutResult.stdout))
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
