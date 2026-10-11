import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { buildOneStoreBasket } from '../src/domain/basket.ts'
import {
  m2DefaultActiveDays,
  m2InitialPlan,
  m2Products,
  m2Recipes,
} from '../src/data/m2Fixture.ts'

const BASELINE = { id: 'synthetic-plus', name: 'PLUS synthetic QA store' }
const CANDIDATE = { id: 'synthetic-deka', name: 'DekaMarkt synthetic QA store' }

function syntheticBasket(store, discount) {
  return buildOneStoreBasket({
    store,
    plan: m2InitialPlan,
    recipes: m2Recipes,
    activeDays: m2DefaultActiveDays,
    products: [
      ...m2Products.map((product) => ({
        ...product,
        id: `${store.id}-${product.id}`,
        storeId: store.id,
        priceCents: product.priceCents - discount,
      })),
      {
        id: `${store.id}-garam-masala`,
        storeId: store.id,
        name: 'Garam masala synthetic 50 g',
        packAmount: 50,
        packUnit: 'g',
        available: true,
        priceCents: 139 - discount,
      },
    ],
  })
}

function study(firstAt, secondAt) {
  return {
    schemaVersion: 1,
    studyId: 'synthetic-clock-cli-001',
    participantKey: 'synthetic-student-001',
    population: 'CONTROLLED SYNTHETIC QA; not retailer observations',
    region: 'synthetic test region',
    weekStart: '2026-10-19',
    priceContext: 'in-store',
    baseline: {
      evidenceId: 'synthetic-plus-basket-001',
      observedAt: firstAt,
      source: 'manual-cart',
      provenanceNote: 'Synthetic fake prices only; never observed at PLUS',
      basket: syntheticBasket(BASELINE, 0),
    },
    candidate: {
      evidenceId: 'synthetic-deka-basket-001',
      observedAt: secondAt,
      source: 'manual-cart',
      provenanceNote: 'Synthetic fake prices only; never observed at DekaMarkt',
      basket: syntheticBasket(CANDIDATE, 10),
    },
  }
}

test('M3 disk JSON -> canonical CLI -> disk report keeps nanosecond money gate and privacy', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'supa-m3-exact-clock-cli-'))
  const input = join(directory, 'synthetic-study.json')
  const output = join(directory, 'synthetic-report.json')

  const baseline = '2026-10-24T16:00:00.000000000Z'
  const boundary = '2026-10-25T16:00:00.000000000Z'
  const plus1ns = '2026-10-25T16:00:00.000000001Z'
  const minus1ns = '2026-10-25T15:59:59.999999999Z'

  try {
    for (const [first, second, expectedClaimable] of [
      [baseline, boundary, true],
      [baseline, minus1ns, true],
      [baseline, plus1ns, false],
      [plus1ns, baseline, false],
      [baseline, '2026-10-25T16:00:00.000999999Z', false],
    ]) {
      await writeFile(input, JSON.stringify(study(first, second)), 'utf8')
      const result = spawnSync(process.execPath, [
        '--experimental-strip-types',
        'scripts/m3-assess-observed-week.mjs',
        input,
        '--output',
        output,
      ], { cwd: process.cwd(), encoding: 'utf8' })

      assert.equal(result.status, 0, result.stderr)
      assert.equal(result.stdout, '')
      const report = JSON.parse(await readFile(output, 'utf8'))

      assert.equal(report.reportType, 'm3-observed-week-assessment')
      assert.equal(report.baseline.observedAt, first)
      assert.equal(report.candidate.observedAt, second)
      assert.equal(report.claimable, expectedClaimable)
      assert.equal(report.publicSavingsClaimEligible, false)
      assert.equal(Object.hasOwn(report, 'participantKey'), false)

      if (expectedClaimable) {
        assert.equal(report.outcome, 'better')
        assert.ok(report.savingsCents > 0)
      } else {
        assert.equal(report.outcome, 'unknown')
        assert.equal(report.deltaCents, null)
        assert.equal(report.savingsCents, null)
        assert.equal(report.attribution.status, 'unknown')
        assert.match(report.reasons.join(' '), /exact nanosecond limit exceeded/)
      }
    }
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
