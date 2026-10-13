import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { assessRetailerDiscovery } from '../scripts/m5-audit-retailer-discovery.mjs'
import { assessRetailerResearch } from '../scripts/m5-assess-retailer-research.mjs'

const original = JSON.parse(await readFile(
  new URL('../docs/m5-retailer-discovery.v1.json', import.meta.url), 'utf8'))
const discovery = () => structuredClone(original)
const PRIVATE_SENTINEL = 'fictional-private-review-only.example.invalid'

function completeSyntheticLedger() {
  const candidates = assessRetailerDiscovery(discovery()).sources
  const reviews = candidates.map((retailer, index) => {
    const variant = index % 4
    const sourceKind = ['official-api', 'official-feed', 'no-public-source', 'unassessed'][variant]
    const rightsState = ['claimed-written-permission', 'request-pending', 'denied', 'unknown'][variant]
    return {
      retailerId: retailer.id,
      reviewedAt: '2026-10-13',
      sourceKind,
      sourceUrl: variant < 2
        ? `https://${PRIVATE_SENTINEL}/source/${retailer.id}` : null,
      termsUrl: `https://${PRIVATE_SENTINEL}/terms/${retailer.id}`,
      robotsUrl: `https://${PRIVATE_SENTINEL}/robots/${retailer.id}`,
      rightsState,
      rightsEvidenceUrl: variant === 0
        ? `https://${PRIVATE_SENTINEL}/claimed-unverified-rights/${retailer.id}` : null,
      regionScope: ['regional', 'national', 'store-specific', 'unknown'][variant],
      assortmentScope: ['products', 'products-and-offers', 'offers', 'unknown'][variant],
      termsReview: ['allowance-claimed', 'unclear', 'restrictive', 'unreviewed'][variant],
      robotsReview: ['allowance-claimed', 'conditional', 'restrictive', 'unreviewed'][variant],
      ownerContactStatus: ['reply-recorded', 'contact-pending', 'owner-identified', 'unassessed'][variant],
      freshnessPlan: ['daily-claimed', 'weekly-claimed', 'manual-only', 'unassessed'][variant],
      priority: ['P1', 'P2', 'P3', 'unprioritized'][variant],
    }
  })
  return { version: 1, purpose: 'manual-research-only', reviews }
}

function assertNonAuthorizing(report) {
  assert.equal(report.version, 1)
  assert.equal(report.reviewedCount, 17)
  assert.equal(report.missingCount, 0)
  assert.equal(report.productionReady, false)
  assert.equal(report.m5Eligible, false)
  assert.equal(report.retailers.length, 17)
  assert.ok(report.retailers.every((r) =>
    !r.productionEnabled && !r.rightsVerified &&
    r.nextAction.includes('Independent rights/legal review')))
  const published = JSON.stringify(report)
  assert.doesNotMatch(published, /fictional-private-review-only|\/source\/|\/terms\/|\/robots\/|claimed-unverified-rights/)
  assert.equal(Object.hasOwn(report, 'reviews'), false)
}

test('M5 QA: 17 complete fictional source reviews remain non-authorizing and private', () => {
  const ledger = completeSyntheticLedger()
  const originalLedgerBytes = JSON.stringify(ledger)
  const originalDiscovery = JSON.stringify(original)
  const report = assessRetailerResearch(discovery(), ledger)
  assertNonAuthorizing(report)
  const ids = assessRetailerDiscovery(discovery()).sources.map(s => s.id)
  assert.deepEqual(report.retailers.map(r => r.id), ids)

  for (let index = 0; index < ids.length; index++) {
    const candidate = ledger.reviews[index]
    const row = report.retailers[index]
    assert.equal(row.id, candidate.retailerId)
    assert.equal(row.sourceKind, candidate.sourceKind)
    assert.equal(row.rightsState, candidate.rightsState)
    assert.equal(row.sourceEvidenceProvided, Boolean(candidate.sourceUrl))
    assert.equal(row.termsEvidenceProvided, true)
    assert.equal(row.robotsEvidenceProvided, true)
    assert.equal(row.claimedRightsEvidenceProvided, Boolean(candidate.rightsEvidenceUrl))
  }

  assert.equal(JSON.stringify(ledger), originalLedgerBytes, 'private ledger mutated')
  assert.equal(JSON.stringify(original), originalDiscovery, 'registry mutated')
})

test('M5 QA: reordering private human research never changes sorted published completeness', () => {
  const ledger = completeSyntheticLedger()
  const baseline = assessRetailerResearch(discovery(), ledger)
  const shuffled = structuredClone(ledger)
  shuffled.reviews.reverse()
  assert.deepEqual(assessRetailerResearch(discovery(), shuffled), baseline)
  const rotated = structuredClone(ledger)
  rotated.reviews.push(rotated.reviews.shift())
  assert.deepEqual(assessRetailerResearch(discovery(), rotated), baseline)
  assert.equal(baseline.retailers.filter(r => r.rightsState === 'claimed-written-permission').length, 5)
  assert.ok(baseline.retailers.every(r => r.rightsVerified === false))
})

test('M5 QA: actual CLI accepts mode-0600 synthetic full ledger but prints only non-PII evidence flags', async () => {
  const temp = await mkdtemp(join(tmpdir(), 'supa-m5-full-offline-qa-'))
  const input = join(temp, 'private-review.json')
  try {
    const source = JSON.stringify(completeSyntheticLedger(), null, 2)
    await writeFile(input, source, { mode: 0o600 })
    const command = new URL('../scripts/m5-assess-retailer-research.mjs', import.meta.url)
    const processResult = spawnSync(process.execPath, [command.pathname, input],
      { cwd: process.cwd(), encoding: 'utf8', timeout: 20000 })
    assert.equal(processResult.status, 0, processResult.stderr)
    assert.equal(processResult.stderr, '')
    const report = JSON.parse(processResult.stdout)
    assertNonAuthorizing(report)
    assert.equal(await readFile(input, 'utf8'), source)
  } finally {
    await rm(temp, { force: true, recursive: true })
  }
})

test('M5 QA: private direct identifier in non-schema review field is refused without leaking diagnostics', async () => {
  const temp = await mkdtemp(join(tmpdir(), 'supa-m5-reject-private-qa-'))
  const input = join(temp, 'name-is-private-fictitious@example.invalid.json')
  const ledger = completeSyntheticLedger()
  ledger.reviews[0].reviewerEmail = 'fictional-person@example.invalid'
  try {
    const source = JSON.stringify(ledger, null, 2)
    await writeFile(input, source, { mode: 0o600 })
    assert.throws(() => assessRetailerResearch(discovery(), ledger),
      /Unexpected, missing or private review field/)
    const command = new URL('../scripts/m5-assess-retailer-research.mjs', import.meta.url)
    const processResult = spawnSync(process.execPath, [command.pathname, input],
      { cwd: process.cwd(), encoding: 'utf8', timeout: 20000 })
    assert.equal(processResult.status, 2)
    assert.equal(processResult.stdout, '')
    assert.match(processResult.stderr, /Offline M5 research assessment rejected/)
    assert.doesNotMatch(processResult.stderr, /fictional-person|fictitious|@example\.invalid|private-review-only/)
    assert.equal(await readFile(input, 'utf8'), source)
  } finally {
    await rm(temp, { force: true, recursive: true })
  }
})
