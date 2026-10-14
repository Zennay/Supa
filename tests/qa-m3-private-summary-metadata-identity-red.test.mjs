import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { buildOneStoreBasket } from '../src/domain/basket.ts'
import { buildObservedWeekReport } from '../scripts/m3-assess-observed-week.mjs'
import {
  m2DefaultActiveDays,
  m2InitialPlan,
  m2Products,
  m2Recipes,
} from '../src/data/m2Fixture.ts'

const EMAIL = 'fictional.person@example.invalid'
const PATHS = [
  {
    label: 'population',
    edit(study) { study.population = `fictional cohort contact ${EMAIL}` },
  },
  {
    label: 'region',
    edit(study) { study.region = `fictional region assigned to ${EMAIL}` },
  },
  {
    label: 'baseline store label',
    edit(study) { study.baseline.basket.store.name = `PLUS synthetic ${EMAIL}` },
  },
  {
    label: 'candidate store label',
    edit(study) { study.candidate.basket.store.name = `DekaMarkt synthetic ${EMAIL}` },
  },
  {
    label: 'baseline store ID',
    edit(study) { study.baseline.basket.store.id = EMAIL },
  },
  {
    label: 'candidate store ID',
    edit(study) { study.candidate.basket.store.id = EMAIL },
  },
]

function oneBasket(store, priceOffset) {
  const products = [
    ...m2Products.map(product => ({
      ...product,
      storeId: store.id,
      id: `${store.id}-${product.id}`,
      priceCents: product.priceCents + priceOffset,
    })),
    {
      id: `${store.id}-garam-50`,
      storeId: store.id,
      name: 'Synthetic garam masala 50 g',
      packAmount: 50,
      packUnit: 'g',
      priceCents: 139 + priceOffset,
      available: true,
    },
  ]
  const basket = buildOneStoreBasket({
    store, products, plan: m2InitialPlan,
    recipes: m2Recipes, activeDays: m2DefaultActiveDays,
  })
  assert.equal(basket.matchedLineCount, 11)
  assert.equal(basket.unresolvedLineCount, 0)
  return basket
}

function syntheticStudy() {
  return {
    schemaVersion: 1,
    studyId: 'privacy-qa-week-001',
    participantKey: 'synthetic-participant-001',
    population: 'fictional student cohort',
    region: 'synthetic region',
    weekStart: '2026-09-28',
    priceContext: 'in-store',
    baseline: {
      evidenceId: 'qa-plus-001',
      observedAt: '2026-10-02T17:00:00Z',
      source: 'manual-cart',
      provenanceNote: 'Synthetic QA values, NOT store evidence.',
      basket: oneBasket({ id: 'qa-plus', name: 'PLUS fictional branch' }, 0),
    },
    candidate: {
      evidenceId: 'qa-dekamarkt-001',
      observedAt: '2026-10-02T18:15:00Z',
      source: 'manual-cart',
      provenanceNote: 'Synthetic QA values, NOT store evidence.',
      basket: oneBasket({ id: 'qa-deka', name: 'DekaMarkt fictional branch' }, -10),
    },
  }
}

function assertPrivateReport(report) {
  assert.equal(report.reportType, 'm3-observed-week-assessment')
  assert.equal(report.publicSavingsClaimEligible, false)
  assert.equal('participantKey' in report, false)
  assert.doesNotMatch(JSON.stringify(report), /synthetic-participant-001/)
}

function assertNoDirectIdentifier(report) {
  assertPrivateReport(report)
  assert.doesNotMatch(JSON.stringify(report), /fictional\.person@example\.invalid/)
}

test('M3 report positive: fictional non-identifying metadata produces a private-only summary', () => {
  const study = syntheticStudy()
  const original = JSON.stringify(study)
  const report = buildObservedWeekReport(study)
  assert.equal(report.claimable, true, 'technical study eligibility is not public savings proof')
  assert.equal(report.outcome, 'better')
  assertNoDirectIdentifier(report)
  assert.equal(JSON.stringify(study), original, 'summary must not mutate raw study')
})

for (const path of PATHS) {
  test(`M3 expected RED: report must reject/redact email-like direct ID in ${path.label}`, () => {
    const study = syntheticStudy()
    path.edit(study)
    const original = JSON.stringify(study)
    let report
    let rejection
    try {
      report = buildObservedWeekReport(study)
    } catch (error) {
      rejection = error
    }
    if (rejection) {
      assert.match(String(rejection), /identity|privacy|identifier|personal|email|PII/i)
      assert.doesNotMatch(String(rejection), /fictional\.person@example\.invalid/, 'error must not echo direct ID')
    } else {
      assertNoDirectIdentifier(report)
    }
    assert.equal(JSON.stringify(study), original, 'privacy validation must not mutate evidence')
  })
}

test('M3 CLI positive: explicit separate output is private and original fictional JSON remains unchanged', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'supa-qa-m3-metadata-'))
  const input = join(directory, 'study.json')
  const output = join(directory, 'summary.json')
  try {
    const source = JSON.stringify(syntheticStudy(), null, 2)
    await writeFile(input, source, 'utf8')
    const result = spawnSync(process.execPath, [
      '--experimental-strip-types', 'scripts/m3-assess-observed-week.mjs',
      input, '--output', output,
    ], { cwd: process.cwd(), encoding: 'utf8' })
    assert.equal(result.status, 0, result.stderr)
    assert.equal(result.stdout, '', 'private report must not print to stdout')
    const report = JSON.parse(await readFile(output, 'utf8'))
    assertPrivateReport(report)
    assert.equal(report.claimable, true)
    assert.equal(await readFile(input, 'utf8'), source)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

for (const path of PATHS) {
  test(`M3 CLI expected RED: no direct ID in report for ${path.label}`, async () => {
    const directory = await mkdtemp(join(tmpdir(), 'supa-qa-m3-metadata-'))
    const input = join(directory, 'study.json')
    const output = join(directory, 'summary.json')
    try {
      const study = syntheticStudy()
      path.edit(study)
      const source = JSON.stringify(study, null, 2)
      await writeFile(input, source, 'utf8')
      const result = spawnSync(process.execPath, [
        '--experimental-strip-types', 'scripts/m3-assess-observed-week.mjs',
        input, '--output', output,
      ], { cwd: process.cwd(), encoding: 'utf8' })
      assert.equal(result.stdout, '', 'never print private data on stdout')
      assert.doesNotMatch(result.stderr, /fictional\.person@example\.invalid/, 'validation diagnostics must not echo the identity')
      if (result.status === 0) {
        assertNoDirectIdentifier(JSON.parse(await readFile(output, 'utf8')))
      } else {
        assert.equal(result.status, 1)
        await assert.rejects(readFile(output, 'utf8'), /ENOENT/)
      }
      assert.equal(await readFile(input, 'utf8'), source)
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })
}
