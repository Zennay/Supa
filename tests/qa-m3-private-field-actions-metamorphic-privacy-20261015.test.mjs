import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { buildObservationSheet } from '../src/domain/m3ObservationSheet.ts'
import { buildM3OutstandingFieldActions } from '../scripts/m3-private-outstanding-field-actions.mjs'

// Independent M3 privacy noninterference: only canonical planner demand and
// collection COMPLETENESS may determine public operator-facing checklists.
// Changing raw customer, product, prices, URLs, notes or timestamps *without*
// changing availability/completeness or the coarse window must not leak.
const NOW = Date.parse('2026-10-15T12:00:00Z')
const CLI = fileURLToPath(new URL('../scripts/m3-private-outstanding-field-actions.mjs', import.meta.url))
const secrets = [
  'CUSTOMER_ALPHA_DO_NOT_ECHO', 'CUSTOMER_BETA_DO_NOT_ECHO',
  'PRIVATE_STORE_ALPHA', 'PRIVATE_STORE_BETA',
  'PRIVATE_PROD_ALPHA', 'PRIVATE_PROD_BETA',
  'SECRET_URL_ALPHA', 'SECRET_URL_BETA',
  'SECRET_EVIDENCE_ALPHA', 'SECRET_EVIDENCE_BETA',
]

function privateDraft(tag) {
  const sheet = buildObservationSheet()
  const first = tag === 'ALPHA'
  sheet.study.studyId = first ? 'custalpha_123' : 'custbeta_456'
  sheet.study.participantKey = first ? 'customeralpha_123' : 'customerbeta_456'
  sheet.study.population = first ? 'CUSTOMER_ALPHA_DO_NOT_ECHO' : 'CUSTOMER_BETA_DO_NOT_ECHO'
  sheet.study.region = first ? 'PRIVATE_STORE_ALPHA' : 'PRIVATE_STORE_BETA'
  sheet.study.priceContext = first ? 'in-store' : 'online-order'
  sheet.baseline.evidenceId = first ? 'SECRET_EVIDENCE_ALPHA' : 'SECRET_EVIDENCE_BETA'
  sheet.baseline.store.id = first ? 'PRIVATE_STORE_ALPHA' : 'PRIVATE_STORE_BETA'
  sheet.baseline.store.name = first ? 'PLUS PRIVATE_STORE_ALPHA' : 'PLUS PRIVATE_STORE_BETA'
  sheet.baseline.provenanceNote = first ? 'SECRET_URL_ALPHA' : 'SECRET_URL_BETA'
  sheet.candidate.store.name = first ? 'DekaMarkt PRIVATE_STORE_ALPHA' : 'DekaMarkt PRIVATE_STORE_BETA'
  sheet.baseline.observedAt = first ? '2026-10-15T08:00:00Z' : '2026-10-15T09:00:00Z'
  sheet.candidate.observedAt = first ? '2026-10-15T08:30:00Z' : '2026-10-15T09:30:00Z'

  const unavailable = sheet.baseline.lines[0].observedProduct
  unavailable.available = false
  unavailable.note = first ? 'PRIVATE_PROD_ALPHA' : 'PRIVATE_PROD_BETA'
  const incomplete = sheet.candidate.lines[1].observedProduct
  incomplete.available = true
  incomplete.productName = first ? 'PRIVATE_PROD_ALPHA' : 'PRIVATE_PROD_BETA'
  incomplete.priceCents = first ? 1357924 : 2468135
  incomplete.sourceUrl = first
    ? 'https://www.dekamarkt.nl/SECRET_URL_ALPHA'
    : 'https://www.dekamarkt.nl/SECRET_URL_BETA'
  incomplete.note = first ? 'CUSTOMER_ALPHA_DO_NOT_ECHO' : 'CUSTOMER_BETA_DO_NOT_ECHO'
  // Deliberately omit packAmount/packUnit: both different quoted products
  // require the identical "finish product/pack/price" operator action.
  return sheet
}

function rejectSecrets(value) {
  for (const secret of secrets) {
    assert.equal(value.includes(secret), false, 'operator output must not contain '+secret)
  }
  assert.equal(/1357924|2468135|2026-10-15T0[89]:/.test(value), false)
}

test('M3 independent privacy metamorphism: different private evidence has identical JSON action report', () => {
  const a = buildM3OutstandingFieldActions(JSON.stringify(privateDraft('ALPHA')), NOW)
  const b = buildM3OutstandingFieldActions(JSON.stringify(privateDraft('BETA')), NOW)
  assert.deepEqual(a, b, 'private fields must not influence publicly displayed operator actions')
  assert.equal(a.completedTotalLines, 1)
  assert.equal(a.remainingTotalLines, 21)
  assert.equal(a.readyForPrivateReview, false)
  assert.equal(a.verifiedRetailerObservations, false)
  assert.equal(a.publicSavingsClaimEligible, false)
  assert.equal(a.observationWindowState, 'within-window')
  rejectSecrets(JSON.stringify(a))
})

test('M3 CLI JSON and human text remain byte-identical for privately different drafts', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'supa-m3-independent-private-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const paths = [join(dir, 'alpha-personal.json'), join(dir, 'beta-personal.json')]
  await Promise.all(paths.map((path, i) =>
    writeFile(path, JSON.stringify(privateDraft(i === 0 ? 'ALPHA' : 'BETA')), { mode: 0o600 })))
  for (const format of [[], ['--text']]) {
    const results = paths.map(path => spawnSync(process.execPath,
      ['--experimental-strip-types', CLI, path, ...format],
      { cwd: dir, encoding: 'utf8', timeout: 20_000 }))
    for (const result of results) {
      assert.equal(result.error, undefined, result.error?.message)
      assert.equal(result.status, 0, result.stderr)
      assert.equal(result.stderr, '')
      rejectSecrets(result.stdout)
      assert.equal(result.stdout.includes(dir), false)
    }
    assert.equal(results[0].stdout, results[1].stdout,
      'secret names, prices, URLs, timestamps and files must not affect identical action checklist')
    if (format.length) assert.match(results[0].stdout, /nog te meten/)
    else assert.equal(JSON.parse(results[0].stdout).remainingTotalLines, 21)
  }
})

test('M3 actions respond to real availability changes, rather than ignoring the entire private draft', () => {
  const sheet = privateDraft('ALPHA')
  const previous = buildM3OutstandingFieldActions(JSON.stringify(sheet), NOW)
  sheet.candidate.lines[1].observedProduct.available = false
  const next = buildM3OutstandingFieldActions(JSON.stringify(sheet), NOW)
  assert.equal(next.remainingTotalLines, previous.remainingTotalLines - 1)
  assert.equal(next.completedTotalLines, previous.completedTotalLines + 1)
  assert.equal(next.verifiedRetailerObservations, false)
  assert.equal(next.publicSavingsClaimEligible, false)
})
