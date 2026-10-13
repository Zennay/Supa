import assert from 'node:assert/strict'
import test from 'node:test'
import { spawnSync } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { buildOneStoreBasket } from '../src/domain/basket.ts'
import { assessWeeklyBasketStudy } from '../src/domain/observedBasketStudy.ts'
import {
  m2DefaultActiveDays,
  m2InitialPlan,
  m2Products,
  m2Recipes,
} from '../src/data/m2Fixture.ts'

// Fictional research evidence only. All 11 canonical M2 ingredients are
// populated from the controlled, non-retailer test fixture.
function makeBasket(store, deltaCents) {
  const products = [
    ...m2Products.map((product) => ({
      ...product,
      id: `${store.id}-${product.id}`,
      storeId: store.id,
      priceCents: product.priceCents + deltaCents,
    })),
    {
      id: `${store.id}-garam-50`,
      storeId: store.id,
      name: 'Fictional garam masala 50 g',
      packAmount: 50,
      packUnit: 'g',
      available: true,
      priceCents: 139 + deltaCents,
    },
  ]
  const basket = buildOneStoreBasket({
    store,
    plan: m2InitialPlan,
    recipes: m2Recipes,
    activeDays: m2DefaultActiveDays,
    products,
  })
  assert.equal(basket.matchedLineCount, 11)
  assert.equal(basket.unresolvedLineCount, 0)
  return basket
}

function fictionalObservedWeek(weekStart = '2026-09-28') {
  return {
    schemaVersion: 1,
    studyId: 'qa-week-coherence-001',
    participantKey: 'synthetic-001',
    population: 'fictional student cohort',
    region: 'fictional region',
    weekStart,
    priceContext: 'in-store',
    baseline: {
      evidenceId: 'fictional-plus-001',
      observedAt: '2026-10-02T17:00:00Z',
      source: 'manual-cart',
      provenanceNote: 'Synthetic offline fixture, NOT actual PLUS prices.',
      basket: makeBasket({ id: 'plus-fictional', name: 'PLUS (fictional)' }, 0),
    },
    candidate: {
      evidenceId: 'fictional-deka-001',
      observedAt: '2026-10-02T18:15:00Z',
      source: 'manual-cart',
      provenanceNote: 'Synthetic offline fixture, NOT actual DekaMarkt prices.',
      basket: makeBasket({ id: 'dekamarkt-fictional', name: 'DekaMarkt (fictional)' }, -10),
    },
  }
}

test('QA M3: observation week and timestamps align for a complete synthetic same-demand basket', () => {
  const study = fictionalObservedWeek()
  const original = JSON.stringify(study)
  const result = assessWeeklyBasketStudy(study)

  assert.equal(result.claimable, true)
  assert.equal(result.comparison.outcome, 'better')
  assert.equal(result.observationWindowHours, 1.25)
  assert.equal(result.comparison.lineDeltas.length, 11)
  assert.equal(result.attribution.status, 'partial')
  assert.equal(JSON.stringify(study), original, 'assessment must not mutate evidence')
})

for (const distantWeek of ['2025-09-29', '2027-09-27']) {
  test(`QA M3 EXPECTED RED: observation from Oct 2026 cannot prove week ${distantWeek}`, () => {
    const study = fictionalObservedWeek(distantWeek)
    const original = JSON.stringify(study)
    const result = assessWeeklyBasketStudy(study)

    assert.equal(result.observationWindowHours, 1.25)
    assert.equal(result.claimable, false, 'unrelated study week must fail closed')
    assert.equal(result.comparison.outcome, 'unknown')
    assert.equal(result.comparison.deltaCents, null)
    assert.equal(result.comparison.savingsCents, null)
    assert.equal(result.attribution.fullyAttributed, false)
    assert.match(result.reasons.join(' '), /weekStart|week|observation|observed/i)
    assert.equal(JSON.stringify(study), original, 'original evidence must remain byte-identical')
  })
}

for (const [weekStart, shouldBeClaimable] of [
  ['2026-09-28', true],
  ['2025-09-29', false],
  ['2027-09-27', false],
]) {
  test(`QA M3 CLI ${shouldBeClaimable ? 'GREEN' : 'EXPECTED RED'}: report preserves week/evidence coherence for ${weekStart}`, async () => {
    const directory = await mkdtemp(join(tmpdir(), 'supa-m3-qa-week-'))
    const input = join(directory, 'fictional-study.json')
    const output = join(directory, 'private-summary.json')

    try {
      const original = JSON.stringify(fictionalObservedWeek(weekStart), null, 2)
      await writeFile(input, original, 'utf8')
      const result = spawnSync(process.execPath, [
        '--experimental-strip-types',
        'scripts/m3-assess-observed-week.mjs',
        input,
        '--output', output,
      ], { cwd: process.cwd(), encoding: 'utf8' })

      assert.equal(result.stdout, '', 'private summary must not appear on stdout')
      assert.equal(await readFile(input, 'utf8'), original, 'raw fictional evidence must remain unchanged')
      if (shouldBeClaimable) {
        assert.equal(result.status, 0, result.stderr)
        const report = JSON.parse(await readFile(output, 'utf8'))
        assert.equal(report.claimable, true)
        assert.equal(report.outcome, 'better')
        assert.equal(report.publicSavingsClaimEligible, false)
        assert.equal('participantKey' in report, false)
      } else if (result.status === 0) {
        // A private unknown report is acceptable; publishing savings is not.
        const report = JSON.parse(await readFile(output, 'utf8'))
        assert.equal(report.claimable, false)
        assert.equal(report.outcome, 'unknown')
        assert.equal(report.deltaCents, null)
        assert.equal(report.savingsCents, null)
        assert.equal(report.publicSavingsClaimEligible, false)
        assert.equal('participantKey' in report, false)
      } else {
        // Early CLI refusal, without creating a report, is also safe.
        assert.equal(result.status, 1)
        await assert.rejects(readFile(output, 'utf8'), /ENOENT/)
      }
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })
}
