import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { buildObservationSheet } from '../src/domain/m3ObservationSheet.ts'
import { canonicalM3RetailerRequirements } from '../scripts/retailer-canonical-m3-demand.mjs'
import { buildFictionalPricedSheet } from '../scripts/m3-rehearse-field-run.mjs'
import { buildM3OutstandingFieldActions } from '../scripts/m3-private-outstanding-field-actions.mjs'

const referenceNowMs = Date.parse('2026-10-15T12:00:00Z')
const cli = fileURLToPath(new URL('../scripts/m3-private-outstanding-field-actions.mjs', import.meta.url))
const call = (cwd, ...args) => spawnSync(
  process.execPath, ['--experimental-strip-types', cli, ...args],
  { cwd, encoding: 'utf8', timeout: 20_000 },
)

test('blank canonical M3 sheet produces all exact 22 unmeasured actions', () => {
  const actions = buildM3OutstandingFieldActions(JSON.stringify(buildObservationSheet()), referenceNowMs)
  const requirements = canonicalM3RetailerRequirements()
  assert.equal(actions.expectedTotalLines, 22)
  assert.equal(actions.remainingTotalLines, 22)
  assert.equal(actions.completedTotalLines, 0)
  assert.deepEqual(actions.retailers.map(s => s.retailer), ['PLUS', 'DekaMarkt'])
  for (const store of actions.retailers) {
    assert.equal(store.pending.length, 11)
    assert.deepEqual(store.pending.map(x => ({
      id: x.ingredientId, amount: x.requiredAmount, unit: x.requiredUnit,
    })), requirements.map(x => ({ id: x.id, amount: x.amount, unit: x.unit })))
    assert.ok(store.pending.every(x => x.action === 'record-availability'))
  }
  assert.equal(actions.observationWindowState, 'not-started')
  assert.equal(actions.readyForPrivateReview, false)
  assert.equal(actions.publicSavingsClaimEligible, false)
  assert.equal(actions.verifiedRetailerObservations, false)
})

test('known unavailable is completed; incomplete available keeps pack-and-price action', () => {
  const sheet = buildObservationSheet()
  sheet.baseline.lines[0].observedProduct.available = false
  sheet.candidate.lines[0].observedProduct.available = true
  sheet.candidate.lines[0].observedProduct.productName = 'PRIVATE CUSTOMER-PRODUCT'
  sheet.candidate.lines[0].observedProduct.priceCents = 123456
  const before = JSON.stringify(sheet)
  const report = buildM3OutstandingFieldActions(before, referenceNowMs)
  assert.equal(report.remainingTotalLines, 21)
  assert.equal(report.retailers[0].completedLines, 1)
  assert.equal(report.retailers[0].pending.some(x => x.ingredientId === sheet.requirements[0].id), false)
  assert.equal(report.retailers[1].pending[0].action, 'complete-product-pack-and-price')
  assert.equal(JSON.stringify(sheet), before, 'never modify private source')
  assert.equal(JSON.stringify(report).includes('PRIVATE CUSTOMER-PRODUCT'), false)
  assert.equal(JSON.stringify(report).includes('123456'), false)
})

test('all 22 recorded unavailable but metadata absent stays private-review-not-ready', () => {
  const sheet = buildObservationSheet()
  for (const side of ['baseline', 'candidate']) {
    for (const line of sheet[side].lines) line.observedProduct.available = false
  }
  const report = buildM3OutstandingFieldActions(JSON.stringify(sheet), referenceNowMs)
  assert.equal(report.remainingTotalLines, 0)
  assert.equal(report.completedTotalLines, 22)
  assert.equal(report.readyForPrivateReview, false)
  assert.equal(report.publicSavingsClaimEligible, false)
})

test('fictional complete 11+11 remains explicitly unverified even when private-review-ready', () => {
  const sheet = buildFictionalPricedSheet()
  sheet.study.participantKey = 'fictional-secret-participant'
  sheet.baseline.store.id = 'fictional-sensitive-plus-store'
  sheet.candidate.lines[1].observedProduct.note = 'fictional-sensitive-price-notes'
  const report = buildM3OutstandingFieldActions(JSON.stringify(sheet), referenceNowMs)
  assert.equal(report.completedTotalLines, 22)
  assert.equal(report.remainingTotalLines, 0)
  assert.equal(report.readyForPrivateReview, true)
  assert.equal(report.verifiedRetailerObservations, false)
  assert.equal(report.publicSavingsClaimEligible, false)
  const output = JSON.stringify(report)
  for (const secret of ['fictional-secret-participant', 'fictional-sensitive-plus-store',
    'fictional-sensitive-price-notes', 'fictional-baseline-product', '2026-10-01T']) {
    assert.equal(output.includes(secret), false, 'operator output must not expose private source')
  }
})

test('incomplete paired field window shows state only, never observed timestamp', () => {
  const sheet = buildObservationSheet()
  sheet.baseline.observedAt = '2026-10-15T10:00:00Z'
  const report = buildM3OutstandingFieldActions(JSON.stringify(sheet), referenceNowMs)
  assert.equal(report.observationWindowState, 'single-observation')
  assert.equal(JSON.stringify(report).includes('2026-10-15T10:00:00Z'), false)
})

test('invalid or noncanonical sheet fails closed before presenting actions', () => {
  const sheet = buildObservationSheet()
  sheet.candidate.lines[2].requirement.amount += 10
  assert.throws(() => buildM3OutstandingFieldActions(JSON.stringify(sheet), referenceNowMs), /canonical/)
  assert.throws(() => buildM3OutstandingFieldActions('not json', referenceNowMs), /canonical/)
  assert.throws(() => buildM3OutstandingFieldActions(JSON.stringify(buildObservationSheet()), Number.NaN), /clock/)
  assert.throws(() => buildM3OutstandingFieldActions(null, referenceNowMs), /input/)
})

test('CLI reads private draft and emits only canonical unanswered requirements', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'supa-m3-outstanding-actions-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const name = join(dir, 'private-sheet.json')
  const sheet = buildObservationSheet()
  sheet.study.participantKey = 'DO-NOT-PRINT-PARTICIPANT'
  sheet.baseline.lines[0].observedProduct.available = false
  await writeFile(name, JSON.stringify(sheet), { mode: 0o600 })
  const command = call(dir, name)
  assert.equal(command.error, undefined, command.error?.message)
  assert.equal(command.status, 0, command.stderr)
  const actions = JSON.parse(command.stdout)
  assert.equal(actions.remainingTotalLines, 21)
  assert.equal(command.stdout.includes('DO-NOT-PRINT-PARTICIPANT'), false)
  assert.equal(command.stderr, '')
})

test('CLI rejects flags and unreadable paths without logging private names', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'supa-m3-actions-invalid-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  for (const args of [[], ['--private'], [join(dir, 'PERSONAL-SECRET-not-found.json')]]) {
    const command = call(dir, ...args)
    assert.equal(command.error, undefined, command.error?.message)
    assert.notEqual(command.status, 0)
    assert.equal(command.stdout, '')
    assert.equal(command.stderr.includes('PERSONAL-SECRET'), false)
    assert.equal(command.stderr.includes(dir), false)
  }
})
