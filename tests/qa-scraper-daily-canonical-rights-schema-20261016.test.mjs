import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { evaluateSourcePermissionGate } from
  '../scripts/m1-check-source-permission-gate.mjs'
import { permittedDailyIds } from '../scraper/daily-refresh.mjs'

// 100% offline authorisation-contract QA. All hypothetical permissions below
// use example.test and confer ZERO actual rights or retailer HTTP access.
const now = new Date('2026-10-16T12:00:00.000Z')
const policy = {
  version: 1,
  sources: [{
    id: 'plus', enabled: true, publicationApproved: true,
    scope: 'public-product-prices', basis: 'documented_legal_review',
    reviewedAt: '2026-10-16', evidenceUrl: 'https://example.test/qa-only-scope',
    scopeNote: 'Entirely fictional unit-test approval; no real retailer grant.',
  }],
}
const exampleEvidence = kind => [{
  kind, url: 'https://example.test/fictional-not-a-license',
  finding: 'This is a synthetic test record, not permission.',
}]
function fictionalCanonical() {
  return {
    version: 1, milestone: 'M1 Data Feasibility',
    reviewedAt: '2026-10-16',
    sources: [
      { supermarket: 'plus', technicalStatus: 'proven',
        permissionStatus: 'permitted', productionEnabled: true,
        evidence: exampleEvidence('written_permission') },
      { supermarket: 'dekamarkt', technicalStatus: 'proven',
        permissionStatus: 'unresolved', productionEnabled: false,
        evidence: exampleEvidence('official_terms') },
    ],
  }
}

test('hypothetical fully shaped license passes a schema check, NOT an actual grant', () => {
  const hypothetical = fictionalCanonical()
  assert.equal(evaluateSourcePermissionGate(hypothetical).productionReady, false)
  assert.deepEqual(permittedDailyIds(policy, hypothetical, now), ['plus'])
})

test('actual canonical PLUS permission gate remains denied even beside fake daily-policy approval', async () => {
  const actual = JSON.parse(await readFile(
    new URL('../evidence/m1/source-permission-gate.v1.json', import.meta.url), 'utf8'))
  assert.equal(evaluateSourcePermissionGate(actual).productionReady, false)
  assert.throws(() => permittedDailyIds(policy, actual, now),
    /Canonical PLUS\/Deka project source gate blocks/)
})

for (const [label, invalidate] of [
  ['missing top-level schema version', doc => { delete doc.version }],
  ['missing second supermarket in canonical authorization registry',
    doc => { doc.sources.pop() }],
  ['future-dated canonical retailer rights review',
    doc => { doc.reviewedAt = '2099-01-01' }],
  ['duplicate contradictory PLUS authorization rows',
    doc => { doc.sources.push({
      supermarket: 'plus', technicalStatus: 'proven',
      permissionStatus: 'prohibited', productionEnabled: false,
      evidence: exampleEvidence('official_terms'),
    }) }],
]) {
  test('daily crawl must reject globally invalid source-rights contract: ' + label, () => {
    const forged = fictionalCanonical()
    invalidate(forged)
    assert.throws(() => evaluateSourcePermissionGate(forged))
    // No per-store permission may override an INVALID canonical registry.
    assert.throws(() => permittedDailyIds(policy, forged, now),
      /source gate|permission|canonical|registry|source/i)
  })
}
