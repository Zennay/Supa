/**
 * Independent frozen-owner M3 QA: coverage renderer must not trust
 * self-contradictory offline health metadata or a different review window.
 *
 * Works only on already committed archived six-shape fixtures; programmatic
 * in-memory mutations, no retailer HTTP, fresh prices, credentials or license.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { loadReviewedRepositoryFixtures } from '../scripts/retailer-reviewed-ingest-engine.mjs'
import { evaluatePrivateAdapterHealth } from '../scripts/retailer-private-adapter-health.mjs'
import { planPrivateRetailerRollout } from '../scripts/retailer-private-source-rollout-matrix.mjs'
import { renderPrivateRetailerCoverageBrief } from '../scripts/retailer-private-operator-brief.mjs'

async function historicalReviews() {
  const rights = JSON.parse(await readFile(
    new URL('../evidence/m1/source-permission-gate.v1.json', import.meta.url), 'utf8'))
  const batch = await loadReviewedRepositoryFixtures()
  const config = { referenceTime: '2026-10-16T04:00:00Z', maxAgeHours: 24 }
  return {
    health: evaluatePrivateAdapterHealth(batch, config),
    rollout: planPrivateRetailerRollout(rights, batch, config),
  }
}

test('real six-source coverage accepts aligned 24h historical review, but never exposes price or source identity', async () => {
  const { health, rollout } = await historicalReviews()
  const displayed = renderPrivateRetailerCoverageBrief(health, rollout)
  assert.match(displayed, /Aanvullende historische productdekking \(NIET ACTUEEL\)/)
  assert.match(displayed, /PLUS: \d+ historische productwaarnemingen/)
  assert.match(displayed, /DekaMarkt: \d+ historische productwaarnemingen/)
  assert.match(displayed, /geen live voorraad of actuele aanbiedingen/)
  assert.doesNotMatch(displayed,
    /https?:|access_token|sourceProductId|capture(?:dAt)?|sha256|€|currentPriceCents/i)
  assert.equal(displayed, renderPrivateRetailerCoverageBrief(health, rollout))
})

test('coverage refuses contradictory cross-report 24h versus 720h freshness windows', async () => {
  const { health, rollout } = await historicalReviews()
  assert.equal(health.maxAgeHours, rollout.maxAgeHours)
  const mismatched = structuredClone(health)
  mismatched.maxAgeHours = 720
  // Everything else remains byte-for-byte identical. This is a provenance
  // contract, not an assertion that archived prices are current at either age.
  assert.throws(() => renderPrivateRetailerCoverageBrief(mismatched, rollout),
    /geweigerd/, 'independent reports must share the same freshness window')
})

test('coverage refuses invented complete six-shape or all-fresh health attestations', async () => {
  const { health, rollout } = await historicalReviews()
  for (const [key, forged] of [
    ['sixShapeCoverageComplete', !health.sixShapeCoverageComplete],
    ['historicalFreshnessWithinWindow', !health.historicalFreshnessWithinWindow],
  ]) {
    const mismatched = structuredClone(health)
    mismatched[key] = forged
    assert.throws(() => renderPrivateRetailerCoverageBrief(mismatched, rollout),
      /geweigerd/, key + ' must agree with trusted six-shape counters')
  }
})

test('coverage refuses fabricated missing-shape list or dropped written-rights next action', async () => {
  const { health, rollout } = await historicalReviews()
  const invalidMissing = structuredClone(health)
  invalidMissing.missingSourceKinds = ['plus:product']
  assert.throws(() => renderPrivateRetailerCoverageBrief(invalidMissing, rollout),
    /geweigerd/, 'a false missing-source list contradicts six-shape facts')
  const droppedRights = structuredClone(health)
  droppedRights.operatorActions = droppedRights.operatorActions.filter(action =>
    action !== 'obtain-written-retailer-source-rights')
  assert.ok(health.operatorActions.includes('obtain-written-retailer-source-rights'))
  assert.throws(() => renderPrivateRetailerCoverageBrief(droppedRights, rollout),
    /geweigerd/, 'health review cannot silently drop mandatory written source rights')
})
