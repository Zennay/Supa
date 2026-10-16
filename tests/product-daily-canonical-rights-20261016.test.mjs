import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { evaluateSourcePermissionGate } from '../scripts/m1-check-source-permission-gate.mjs'
import { permittedDailyIds } from '../scraper/daily-refresh.mjs'

// Entirely fictional policy and evidence, used only inside Node tests.
// Never enable an actual retailer or persist a source license.
const now = new Date('2026-10-16T12:00:00.000Z')
const daily = enabled => ({ version: 1, sources: [{
  id: 'plus', enabled, publicationApproved: enabled,
  scope: 'public-product-prices', basis: 'documented_legal_review',
  reviewedAt: '2026-10-16', evidenceUrl: 'https://example.test/fictional',
  scopeNote: 'Fictional test review only; absolutely no retailer permission.',
}] })
const fiction = () => ({
  version: 1, milestone: 'M1 Data Feasibility', reviewedAt: '2026-10-16',
  sources: [
    { supermarket: 'plus', technicalStatus: 'proven', productionEnabled: true,
      permissionStatus: 'permitted',
      evidence: [{ kind: 'written_permission', url: 'https://example.test/not-real',
        finding: 'Hypothetical and not an actual permission grant.' }] },
    { supermarket: 'dekamarkt', technicalStatus: 'proven', productionEnabled: false,
      permissionStatus: 'unresolved',
      evidence: [{ kind: 'official_terms', url: 'https://example.test/not-real',
        finding: 'Unresolved fictional permissions.' }] },
  ],
})

test('fully valid hypothetical two-retailer gate supports its one approved fictional PLUS row only', () => {
  const canonical = fiction()
  assert.equal(evaluateSourcePermissionGate(canonical).productionReady, false)
  assert.deepEqual(permittedDailyIds(daily(true), canonical, now), ['plus'])
  assert.deepEqual(permittedDailyIds(daily(false), canonical, now), [])
})

test('invalid canonical M1 gate refuses even when no daily policy source is enabled', () => {
  for (const mutate of [
    gate => { delete gate.version },
    gate => { gate.sources.pop() },
    gate => { gate.reviewedAt = '2099-01-01' },
    gate => { gate.sources.push({ ...gate.sources[0],
      permissionStatus: 'prohibited', productionEnabled: false }) },
  ]) {
    const canonical = fiction()
    mutate(canonical)
    assert.throws(() => evaluateSourcePermissionGate(canonical))
    assert.throws(() => permittedDailyIds(daily(false), canonical, now))
  }
})

test('actual repository rights remain denied even beside fictional enabled daily scope', async () => {
  const actual = JSON.parse(await readFile(
    new URL('../evidence/m1/source-permission-gate.v1.json', import.meta.url), 'utf8'))
  assert.equal(evaluateSourcePermissionGate(actual).productionReady, false)
  assert.throws(() => permittedDailyIds(daily(true), actual, now),
    /Canonical PLUS\/Deka project source gate blocks unattended scraper/)
  assert.deepEqual(permittedDailyIds(daily(false), actual, now), [])
})
