import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { buildOneStoreBasket } from '../src/domain/basket.ts'
import { assessWeeklyBasketStudy } from '../src/domain/observedBasketStudy.ts'
import {
  m2DefaultActiveDays, m2InitialPlan, m2Products, m2Recipes,
} from '../src/data/m2Fixture.ts'

function makeBasket(store, priceAdjustment) {
  const products = [
    ...m2Products.map((product) => ({
      ...product,
      id: `${store.id}-${product.id}`,
      storeId: store.id,
      priceCents: product.priceCents + priceAdjustment,
    })),
    {
      id: `${store.id}-garam-50`,
      storeId: store.id,
      name: 'Fictional garam masala 50g',
      packAmount: 50,
      packUnit: 'g',
      available: true,
      priceCents: 139 + priceAdjustment,
    },
  ]
  const basket = buildOneStoreBasket({
    store, products, plan: m2InitialPlan, recipes: m2Recipes,
    activeDays: m2DefaultActiveDays,
  })
  assert.equal(basket.matchedLineCount, 11)
  assert.equal(basket.unresolvedLineCount, 0)
  return basket
}

function fictionalWeek(weekStart = '2026-09-28', baselineDate = '2026-10-02T17:00:00Z', candidateDate = '2026-10-02T18:15:00Z') {
  return {
    schemaVersion: 1,
    studyId: 'm3-week-product-001',
    participantKey: 'fictional-pseudo-001',
    population: 'synthetic student group',
    region: 'fictional Dutch region',
    weekStart,
    priceContext: 'in-store',
    baseline: {
      evidenceId: 'fictional-plus-001',
      observedAt: baselineDate,
      source: 'manual-cart',
      provenanceNote: 'Entirely synthetic unit test, no observed retailer data',
      basket: makeBasket({ id: 'fictitious-plus', name: 'PLUS fictional' }, 0),
    },
    candidate: {
      evidenceId: 'fictional-deka-001',
      observedAt: candidateDate,
      source: 'manual-cart',
      provenanceNote: 'Entirely synthetic unit test, no observed retailer data',
      basket: makeBasket({ id: 'fictitious-deka', name: 'DekaMarkt fictional' }, -10),
    },
  }
}

function assertUnknownAssessment(study) {
  const before = JSON.stringify(study)
  const result = assessWeeklyBasketStudy(study, { referenceNowMs: Date.now() })
  assert.equal(result.claimable, false)
  assert.equal(result.comparison.outcome, 'unknown')
  assert.equal(result.comparison.deltaCents, null)
  assert.equal(result.comparison.savingsCents, null)
  assert.equal(result.attribution.fullyAttributed, false)
  assert.match(result.reasons.join(' '), /outside the declared planning week/i)
  assert.equal(JSON.stringify(study), before)
}

test('M3 valid synthetic complete week remains technically comparable (not public savings)', () => {
  const study = fictionalWeek()
  const before = JSON.stringify(study)
  const result = assessWeeklyBasketStudy(study, { referenceNowMs: Date.now() })
  assert.equal(result.claimable, true)
  assert.equal(result.comparison.outcome, 'better')
  assert.equal(result.observationWindowHours, 1.25)
  assert.equal(result.comparison.lineDeltas.length, 11)
  assert.equal(JSON.stringify(study), before)
})

for (const otherWeek of ['2025-09-29', '2027-09-27']) {
  test(`M3 identical observed basket may not claim unrelated planning week ${otherWeek}`, () => {
    assertUnknownAssessment(fictionalWeek(otherWeek))
  })
}

test('M3 permits purchasing on Saturday immediately preceding declared week', () => {
  const study = fictionalWeek('2026-09-28', '2026-09-26T18:00:00+02:00', '2026-09-26T19:00:00+02:00')
  assert.equal(assessWeeklyBasketStudy(study, { referenceNowMs: Date.now() }).claimable, true)
})

test('M3 permits purchasing on final Sunday of declared week', () => {
  const study = fictionalWeek('2026-09-28', '2026-10-04T20:00:00+02:00', '2026-10-04T21:00:00+02:00')
  assert.equal(assessWeeklyBasketStudy(study, { referenceNowMs: Date.now() }).claimable, true)
})

test('M3 rejects shopping three civil days before nominated week', () => {
  assertUnknownAssessment(fictionalWeek('2026-09-28', '2026-09-25T18:00:00+02:00', '2026-09-25T19:00:00+02:00'))
})

test('M3 rejects shopping the Monday after nominated week', () => {
  assertUnknownAssessment(fictionalWeek('2026-09-28', '2026-10-05T18:00:00+02:00', '2026-10-05T19:00:00+02:00'))
})

test('M3 treats each observation local civil day as declared by its ISO offset near UTC midnight', () => {
  const study = fictionalWeek('2026-09-28', '2026-09-26T00:30:00+02:00', '2026-09-26T01:00:00+02:00')
  assert.equal(assessWeeklyBasketStudy(study, { referenceNowMs: Date.now() }).claimable, true)
  const beforeSaturday = fictionalWeek('2026-09-28', '2026-09-25T23:30:00+02:00', '2026-09-25T23:50:00+02:00')
  assertUnknownAssessment(beforeSaturday)
})

test('M3 changes to the candidate observation alone invalidate comparison', () => {
  assertUnknownAssessment(fictionalWeek('2026-09-28', '2026-10-04T23:30:00+02:00', '2026-10-05T00:00:00+02:00'))
})

for (const [label, weekStart, expectComparable] of [
  ['coherent', '2026-09-28', true],
  ['one year earlier', '2025-09-29', false],
  ['one year later', '2027-09-27', false],
]) {
  test(`M3 CLI private report honors ${label} declared observation week`, async () => {
    const dir = await mkdtemp(join(tmpdir(), 'supa-product-m3-week-'))
    try {
      const input = join(dir, 'study.json')
      const output = join(dir, 'private-report.json')
      const raw = JSON.stringify(fictionalWeek(weekStart))
      await writeFile(input, raw)
      const command = spawnSync(process.execPath, [
        '--experimental-strip-types', 'scripts/m3-assess-observed-week.mjs',
        input, '--output', output,
      ], { cwd: process.cwd(), encoding: 'utf8' })
      assert.equal(command.stdout, '')
      if (command.status === 0) {
        const report = JSON.parse(await readFile(output, 'utf8'))
        assert.equal(report.claimable, expectComparable)
        assert.equal(report.outcome, expectComparable ? 'better' : 'unknown')
        assert.equal(report.publicSavingsClaimEligible, false)
        assert.equal('participantKey' in report, false)
        if (!expectComparable) {
          assert.equal(report.deltaCents, null)
          assert.equal(report.savingsCents, null)
        }
      } else {
        assert.equal(expectComparable, false, command.stderr)
        assert.equal(command.status, 1)
        await assert.rejects(readFile(output, 'utf8'), /ENOENT/)
      }
      assert.equal(await readFile(input, 'utf8'), raw)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
}
