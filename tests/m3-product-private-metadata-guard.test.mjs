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

// All prices and addresses in this suite are fictional test data, not retailer
// observations. A complete matched basket is necessary to exercise real M3
// report output rather than accidentally accepting an unrelated validation error.
const EMAIL = 'fictional.person@example.invalid'
const FIELDS = [
  ['population', (study) => { study.population = `Cohort contact ${EMAIL}` }],
  ['region', (study) => { study.region = `Study region ${EMAIL}` }],
  ['baseline store label', (study) => { study.baseline.basket.store.name = `PLUS ${EMAIL}` }],
  ['candidate store label', (study) => { study.candidate.basket.store.name = `DekaMarkt ${EMAIL}` }],
  ['baseline store id', (study) => { study.baseline.basket.store.id = EMAIL }],
  ['candidate store id', (study) => { study.candidate.basket.store.id = EMAIL }],
]

function makeBasket(store, priceOffset) {
  const products = [
    ...m2Products.map((product) => ({
      ...product,
      storeId: store.id,
      id: `${store.id}-${product.id}`,
      priceCents: product.priceCents + priceOffset,
    })),
    {
      id: `${store.id}-spice-50`,
      storeId: store.id,
      name: 'Fictional garam masala 50 g',
      packAmount: 50,
      packUnit: 'g',
      available: true,
      priceCents: 139 + priceOffset,
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

function makeStudy() {
  return {
    schemaVersion: 1,
    studyId: 'm3-metadata-product-001',
    participantKey: 'opaque-test-key',
    population: 'fictional student group',
    region: 'fictional research region',
    weekStart: '2026-09-28',
    priceContext: 'in-store',
    baseline: {
      evidenceId: 'fictitious-plus-001',
      observedAt: '2026-10-02T17:00:00Z',
      source: 'manual-cart',
      provenanceNote: 'Not a real observed basket.',
      basket: makeBasket({ id: 'fictional-plus', name: 'PLUS fictional' }, 0),
    },
    candidate: {
      evidenceId: 'fictitious-deka-001',
      observedAt: '2026-10-02T18:15:00Z',
      source: 'manual-cart',
      provenanceNote: 'Not a real observed basket.',
      basket: makeBasket({ id: 'fictional-deka', name: 'DekaMarkt fictional' }, -10),
    },
  }
}

test('M3 report retains safe non-contact metadata without raw participant key', () => {
  const input = makeStudy()
  const before = JSON.stringify(input)
  const report = buildObservedWeekReport(input)
  assert.equal(report.claimable, true)
  assert.equal(report.publicSavingsClaimEligible, false)
  assert.equal(report.outcome, 'better')
  assert.equal(report.population, 'fictional student group')
  assert.equal(report.region, 'fictional research region')
  assert.equal('participantKey' in report, false)
  assert.equal(JSON.stringify(input), before)
})

for (const [field, inject] of FIELDS) {
  test(`M3 product report refuses direct email identity in ${field} without modifying input`, () => {
    const input = makeStudy()
    inject(input)
    const before = JSON.stringify(input)
    assert.throws(() => buildObservedWeekReport(input), (error) => {
      assert.match(error.message, /direct email identifier/)
      assert.doesNotMatch(error.message, /fictional\.person@example\.invalid/)
      return true
    })
    assert.equal(JSON.stringify(input), before)
  })
}

test('M3 CLI writes a private fictional control report only to explicit --output', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'supa-m3-product-metadata-'))
  try {
    const input = join(dir, 'in.json')
    const output = join(dir, 'report.json')
    const data = JSON.stringify(makeStudy())
    await writeFile(input, data)
    const command = spawnSync(process.execPath, [
      '--experimental-strip-types', 'scripts/m3-assess-observed-week.mjs',
      input, '--output', output,
    ], { cwd: process.cwd(), encoding: 'utf8' })
    assert.equal(command.status, 0, command.stderr)
    assert.equal(command.stdout, '')
    const report = JSON.parse(await readFile(output, 'utf8'))
    assert.equal(report.claimable, true)
    assert.equal(report.publicSavingsClaimEligible, false)
    assert.equal(await readFile(input, 'utf8'), data)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

for (const [field, inject] of FIELDS) {
  test(`M3 CLI refuses direct email identity in ${field} without creating a report`, async () => {
    const dir = await mkdtemp(join(tmpdir(), 'supa-m3-product-metadata-'))
    try {
      const input = join(dir, 'in.json')
      const output = join(dir, 'report.json')
      const study = makeStudy()
      inject(study)
      const data = JSON.stringify(study)
      await writeFile(input, data)
      const command = spawnSync(process.execPath, [
        '--experimental-strip-types', 'scripts/m3-assess-observed-week.mjs',
        input, '--output', output,
      ], { cwd: process.cwd(), encoding: 'utf8' })
      assert.equal(command.status, 1)
      assert.equal(command.stdout, '')
      assert.match(command.stderr, /direct email identifier/)
      assert.doesNotMatch(command.stderr, /fictional\.person@example\.invalid/)
      await assert.rejects(readFile(output, 'utf8'), /ENOENT/)
      assert.equal(await readFile(input, 'utf8'), data)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
}
