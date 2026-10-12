import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

import { buildOneStoreBasket } from '../src/domain/basket.ts'
import {
  m2DefaultActiveDays,
  m2InitialPlan,
  m2Products,
  m2Recipes,
} from '../src/data/m2Fixture.ts'

const assessor = fileURLToPath(new URL('../scripts/m3-assess-observed-week.mjs', import.meta.url))
const secret = 'SYNTHETIC_PRIVATE_MARKER_NEVER_REPORT'

function basket(side, name, adjustment) {
  const store = { id: `${side}-redaction-store`, name }
  const products = [
    ...m2Products.map((product) => ({
      ...product,
      id: `${store.id}-${product.id}`,
      storeId: store.id,
      priceCents: product.priceCents + adjustment,
    })),
    {
      id: `${store.id}-garam-50`,
      storeId: store.id,
      name: 'Garam masala 50 g',
      packAmount: 50,
      packUnit: 'g',
      available: true,
      priceCents: 139 + adjustment,
    },
  ]
  return buildOneStoreBasket({
    store, products,
    plan: m2InitialPlan,
    recipes: m2Recipes,
    activeDays: m2DefaultActiveDays,
  })
}

function study() {
  const baseline = basket('baseline', 'PLUS synthetic QA filiaal', 0)
  const candidate = basket('candidate', 'DekaMarkt synthetic QA filiaal', -10)
  const firstMatched = baseline.lines.find((line) => line.status === 'matched')
  assert.ok(firstMatched)
  firstMatched.productName = secret

  return {
    schemaVersion: 1,
    studyId: 'synthetic-redaction-study',
    participantKey: 'synthetic-private-participant',
    population: 'synthetic students',
    region: 'synthetic test region',
    weekStart: '2026-10-05',
    priceContext: 'in-store',
    baseline: {
      evidenceId: 'baseline-redaction-001',
      observedAt: '2026-10-05T10:00:00Z',
      source: 'manual-cart',
      provenanceNote: secret,
      basket: baseline,
    },
    candidate: {
      evidenceId: 'candidate-redaction-001',
      observedAt: '2026-10-05T11:00:00Z',
      source: 'manual-cart',
      provenanceNote: secret,
      basket: candidate,
    },
  }
}

async function withPaths(fn) {
  const directory = await mkdtemp(join(tmpdir(), 'supa-m3-report-redaction-'))
  const input = join(directory, 'private-study.json')
  const output = join(directory, 'sanitized-report.json')
  try {
    await fn({ input, output })
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

function run(input, output) {
  return spawnSync(
    process.execPath,
    ['--experimental-strip-types', assessor, input, '--output', output],
    { encoding: 'utf8' },
  )
}

test('M3 CLI report excludes participant, sensitive provenance and line-level product identities', async () => {
  await withPaths(async ({ input, output }) => {
    const privateStudy = study()
    await writeFile(input, JSON.stringify(privateStudy, null, 2), 'utf8')
    const result = run(input, output)
    assert.equal(result.status, 0, result.stderr)
    assert.equal(result.stdout.trim(), '')

    const raw = await readFile(output, 'utf8')
    const report = JSON.parse(raw)
    assert.equal(report.claimable, true)
    assert.equal(report.outcome, 'better')
    assert.equal(report.publicSavingsClaimEligible, false)
    assert.equal('participantKey' in report, false)
    assert.equal('basket' in report.baseline, false)
    assert.equal('basket' in report.candidate, false)
    assert.equal('provenanceNote' in report.baseline, false)
    assert.equal('provenanceNote' in report.candidate, false)
    assert.equal('lineDeltas' in report, false)
    assert.equal(raw.includes(privateStudy.participantKey), false)
    assert.equal(raw.includes(secret), false)
  })
})

test('invalid direct M3 study cannot overwrite an existing assessment report artifact', async () => {
  await withPaths(async ({ input, output }) => {
    const invalid = study()
    invalid.baseline.basket.totalCents += 1
    await writeFile(input, JSON.stringify(invalid), 'utf8')
    const sentinel = 'existing-private-assessment-do-not-overwrite\n'
    await writeFile(output, sentinel, 'utf8')

    const result = run(input, output)
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /totalCents must equal the sum of matched line totals/)
    assert.equal(result.stdout.trim(), '')
    assert.equal(await readFile(output, 'utf8'), sentinel)
  })
})
