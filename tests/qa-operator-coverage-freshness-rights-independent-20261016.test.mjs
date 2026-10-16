/**
 * Follow-on independent historical-only QA: two previously unexecuted
 * cross-report health truth checks get their own native RED assertions.
 *
 * Preserve the earlier original QA file byte-for-byte in the same PR.
 * All observations are committed offline archive fixtures; no live fetch,
 * external permission or actual retailer price claim.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { loadReviewedRepositoryFixtures } from '../scripts/retailer-reviewed-ingest-engine.mjs'
import { evaluatePrivateAdapterHealth } from '../scripts/retailer-private-adapter-health.mjs'
import { planPrivateRetailerRollout } from '../scripts/retailer-private-source-rollout-matrix.mjs'
import { renderPrivateRetailerCoverageBrief } from '../scripts/retailer-private-operator-brief.mjs'

async function genuinePair() {
  const rights = JSON.parse(await readFile(
    new URL('../evidence/m1/source-permission-gate.v1.json', import.meta.url), 'utf8'))
  const batch = await loadReviewedRepositoryFixtures()
  const clock = { referenceTime: '2026-10-16T04:00:00Z', maxAgeHours: 24 }
  return {
    health: evaluatePrivateAdapterHealth(batch, clock),
    rollout: planPrivateRetailerRollout(rights, batch, clock),
  }
}

test('coverage refuses false all-fresh metadata even when raw stale bucket counters agree', async () => {
  const { health, rollout } = await genuinePair()
  const preview = renderPrivateRetailerCoverageBrief(health, rollout)
  assert.match(preview, /NIET ACTUEEL/)
  assert.equal(health.historicalFreshnessWithinWindow, health.staleSources === 0)
  const changed = structuredClone(health)
  changed.historicalFreshnessWithinWindow = !health.historicalFreshnessWithinWindow
  assert.throws(() => renderPrivateRetailerCoverageBrief(changed, rollout),
    /geweigerd/, 'false all-fresh reviewer evidence must not be admitted')
})

test('coverage refuses suppressing the mandatory obtain-written-retailer-source-rights action', async () => {
  const { health, rollout } = await genuinePair()
  assert.ok(health.operatorActions.includes('obtain-written-retailer-source-rights'))
  const changed = structuredClone(health)
  changed.operatorActions = changed.operatorActions.filter(item =>
    item !== 'obtain-written-retailer-source-rights')
  assert.throws(() => renderPrivateRetailerCoverageBrief(changed, rollout),
    /geweigerd/, 'missing written source-rights action must not be accepted')
})
