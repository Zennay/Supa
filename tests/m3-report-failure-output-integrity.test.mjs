import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'

import { buildOneStoreBasket } from '../src/domain/basket.ts'
import {
  m2DefaultActiveDays,
  m2InitialPlan,
  m2Products,
  m2Recipes,
} from '../src/data/m2Fixture.ts'

const CLI = resolve('scripts/m3-assess-observed-week.mjs')
const sentinel = '{\n  "preserve": "earlier reviewed M3 report"\n}\n'

function observedBasket(store, priceOffset = 0) {
  const products = m2Products.map((product) => ({
    ...product,
    id: `${store.id}-${product.id}`,
    storeId: store.id,
    priceCents: product.priceCents + priceOffset,
  }))
  products.push({
    id: `${store.id}-garam-50`,
    storeId: store.id,
    name: 'Garam masala 50 g',
    packAmount: 50,
    packUnit: 'g',
    available: true,
    priceCents: 139 + priceOffset,
  })
  return buildOneStoreBasket({
    store,
    plan: m2InitialPlan,
    recipes: m2Recipes,
    activeDays: m2DefaultActiveDays,
    products,
  })
}

function validStudy() {
  return {
    schemaVersion: 1,
    studyId: 'week-2026-40-integrity',
    participantKey: 'student-integrity-001',
    population: 'students',
    region: 'Synthetic region',
    weekStart: '2026-09-28',
    priceContext: 'in-store',
    baseline: {
      evidenceId: 'integrity-plus-001',
      observedAt: '2026-10-02T12:00:00Z',
      source: 'manual-cart',
      provenanceNote: 'Synthetic regression only.',
      basket: observedBasket({ id: 'plus-integrity', name: 'PLUS testfiliaal' }),
    },
    candidate: {
      evidenceId: 'integrity-dekamarkt-001',
      observedAt: '2026-10-02T13:00:00Z',
      source: 'manual-cart',
      provenanceNote: 'Synthetic regression only.',
      basket: observedBasket({ id: 'dekamarkt-integrity', name: 'DekaMarkt testfiliaal' }, -10),
    },
  }
}

function invoke(input, output) {
  return spawnSync(
    process.execPath,
    ['--experimental-strip-types', CLI, input, '--output', output],
    { encoding: 'utf8', cwd: process.cwd() },
  )
}

test('M3 report CLI retains an existing reviewed artifact after every failed preflight', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'supa-m3-report-integrity-'))
  const input = join(dir, 'study.json')
  const output = join(dir, 'reviewed-report.json')

  const cases = [
    ['invalid JSON', '{broken JSON', /study JSON could not be read\/parsed/],
    ['missing participant metadata', JSON.stringify({ schemaVersion: 1, studyId: 'week-missing' }), /participantKey must be a non-empty string/],
    ['wrong price context', JSON.stringify({ ...validStudy(), priceContext: 'mixed' }), /priceContext must be in-store or online-order/],
    ['missing candidate basket', JSON.stringify({
      ...validStudy(),
      candidate: { ...validStudy().candidate, basket: null },
    }), /candidate\.basket must be an object/],
  ]

  try {
    for (const [label, source, expectedError] of cases) {
      await writeFile(input, source, 'utf8')
      await writeFile(output, sentinel, 'utf8')
      const result = invoke(input, output)

      assert.equal(result.status, 1, `${label}: ${result.stderr}`)
      assert.match(result.stderr, expectedError, label)
      assert.equal(result.stdout, '', `${label}: invalid evidence must not emit report JSON`)
      assert.equal(await readFile(input, 'utf8'), source, `${label}: input must remain intact`)
      assert.equal(await readFile(output, 'utf8'), sentinel, `${label}: previous report must remain intact`)
    }
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('M3 report CLI never creates an output for unreadable source evidence', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'supa-m3-report-missing-'))
  const input = join(dir, 'no-study.json')
  const output = join(dir, 'report.json')

  try {
    const result = invoke(input, output)
    assert.equal(result.status, 1, result.stderr)
    assert.match(result.stderr, /study JSON could not be read\/parsed/)
    assert.equal(result.stdout, '')
    await assert.rejects(readFile(output, 'utf8'), { code: 'ENOENT' })
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('M3 report CLI writes a valid report only after successful validation', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'supa-m3-report-valid-'))
  const input = join(dir, 'study.json')
  const output = join(dir, 'report.json')

  try {
    const study = validStudy()
    const original = `${JSON.stringify(study, null, 2)}\n`
    await writeFile(input, original, 'utf8')

    const result = invoke(input, output)
    assert.equal(result.status, 0, result.stderr)
    assert.equal(result.stdout, '')
    assert.equal(await readFile(input, 'utf8'), original)

    const report = JSON.parse(await readFile(output, 'utf8'))
    assert.equal(report.reportType, 'm3-observed-week-assessment')
    assert.equal(report.studyId, study.studyId)
    assert.equal(report.publicSavingsClaimEligible, false)
    assert.equal(report.outcome, 'better')
    assert.equal('participantKey' in report, false)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('M3 report CLI stdout and file paths agree for better, equal and worse baskets', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'supa-m3-report-outcome-parity-'))
  const input = join(dir, 'study.json')
  const output = join(dir, 'assessment.json')

  try {
    for (const [offset, outcome, savingsSign] of [
      [-10, 'better', 1],
      [0, 'same', 0],
      [10, 'worse', -1],
    ]) {
      const study = validStudy()
      study.candidate.basket = observedBasket(
        { id: 'dekamarkt-integrity', name: 'DekaMarkt testfiliaal' },
        offset,
      )
      const original = `${JSON.stringify(study, null, 2)}\n`
      await writeFile(input, original, 'utf8')

      const stdoutResult = spawnSync(
        process.execPath,
        ['--experimental-strip-types', CLI, input],
        { cwd: process.cwd(), encoding: 'utf8' },
      )
      assert.equal(stdoutResult.status, 0, stdoutResult.stderr)
      assert.equal(stdoutResult.stderr, '')

      const fileResult = invoke(input, output)
      assert.equal(fileResult.status, 0, fileResult.stderr)
      assert.equal(fileResult.stdout, '')

      const bytes = await readFile(output, 'utf8')
      assert.equal(stdoutResult.stdout, bytes, `${outcome}: report delivery paths must agree byte-for-byte`)
      const report = JSON.parse(bytes)
      assert.equal(report.outcome, outcome)
      assert.equal(report.claimable, true)
      assert.equal(report.publicSavingsClaimEligible, false)
      assert.equal(Math.sign(report.savingsCents), savingsSign)
      assert.equal(await readFile(input, 'utf8'), original)
    }
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('M3 rejected study metadata never leaks private source strings to CLI output', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'supa-m3-report-private-error-'))
  const input = join(dir, 'study.json')
  const output = join(dir, 'report.json')
  const privateMarkers = [
    'synthetic_private_participant_007',
    'synthetic_private_receipt_marker_482',
    'synthetic_private_product_marker_694',
  ]

  try {
    const study = validStudy()
    study.participantKey = privateMarkers[0]
    study.candidate.provenanceNote = privateMarkers[1]
    study.baseline.basket.lines[0].ingredientLabel = privateMarkers[2]
    study.priceContext = 'mixed-inconsistent'
    await writeFile(input, JSON.stringify(study), 'utf8')

    const result = invoke(input, output)
    assert.equal(result.status, 1)
    assert.match(result.stderr, /priceContext must be in-store or online-order/)
    assert.equal(result.stdout, '')
    for (const marker of privateMarkers) {
      assert.equal(result.stderr.includes(marker), false, `stderr leaked ${marker}`)
      assert.equal(result.stdout.includes(marker), false, `stdout leaked ${marker}`)
    }
    await assert.rejects(readFile(output, 'utf8'), { code: 'ENOENT' })
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
