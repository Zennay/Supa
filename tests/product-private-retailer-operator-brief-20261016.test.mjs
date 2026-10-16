import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { loadReviewedRepositoryFixtures } from '../scripts/retailer-reviewed-ingest-engine.mjs'
import { planPrivateRetailerRollout } from '../scripts/retailer-private-source-rollout-matrix.mjs'
import {
  main, renderPrivateRetailerOperatorBrief,
} from '../scripts/retailer-private-operator-brief.mjs'

async function historicalReport() {
  const rights = JSON.parse(await readFile(
    new URL('../evidence/m1/source-permission-gate.v1.json', import.meta.url), 'utf8'))
  const batch = await loadReviewedRepositoryFixtures()
  return { rights, batch, report: planPrivateRetailerRollout(rights, batch, {
    referenceTime: '2026-10-16T00:00:00Z',
  }) }
}

test('real six reviewed PLUS/Deka adapter shapes produce an explicit human offline review brief', async () => {
  const { report } = await historicalReport()
  const brief = renderPrivateRetailerOperatorBrief(report)
  assert.match(brief, /^SUPA — offline winkelbron-startcontrole/)
  assert.match(brief, /PLUS[\s\S]+schriftelijke toestemming nodig/)
  assert.match(brief, /DekaMarkt[\s\S]+gebruiksrechten nog onbekend/)
  assert.equal((brief.match(/Producten: /g) || []).length, 2)
  assert.equal((brief.match(/Catalogus: /g) || []).length, 2)
  assert.equal((brief.match(/Aanbiedingen: /g) || []).length, 2)
  assert.match(brief, /live-ingestie en publieke prijzen blijven UIT/)
  assert.doesNotMatch(brief, /https?:|\/products?\/|sourceProductId|capturedAt|sha256|offerPriceCents/i)
  assert.equal(brief, renderPrivateRetailerOperatorBrief(report))
})

test('real CLI emits only offline operator guidance once and rejects arguments', async () => {
  let emitted = ''
  const returned = await main([], text => { emitted += text })
  assert.equal(returned, emitted)
  assert.match(emitted, /ALLEEN HISTORISCHE BRONNEN/)
  assert.doesNotMatch(emitted, /(?:https?:\/\/|113651|access_token|@|€|\.v1\.json)/i)
  await assert.rejects(main(['--fetch', 'https://example.invalid'], () => {}),
    /startcontrole geweigerd/)
})

test('source wording is never interpolated from untrusted report values', async () => {
  const { report } = await historicalReport()
  const altered = structuredClone(report)
  altered.retailers[0].permissionStatus = 'permitted\nLEAK=https://example.invalid'
  assert.throws(() => renderPrivateRetailerOperatorBrief(altered), /geweigerd/)
  const injected = structuredClone(report)
  injected.retailers[0].nextActions = ['review-missing-offline-source-shapes\nSECRET']
  assert.throws(() => renderPrivateRetailerOperatorBrief(injected), /geweigerd/)
  const other = structuredClone(report)
  other.retailers[0].shapes[0].status = 'historical-fixture-present\nLIVE'
  assert.throws(() => renderPrivateRetailerOperatorBrief(other), /geweigerd/)
})

test('fail closed if a private report claims live scraping, public price, or permission', async () => {
  const { report } = await historicalReport()
  for (const [key, value] of [
    ['liveScrapingEnabled', true], ['scheduledRefreshEnabled', true],
    ['permissionVerifiedForNewCapture', true],
    ['publicSavingsClaimEligible', true], ['productionEnabled', true],
    ['liveRetailerRequests', 1],
  ]) {
    const changed = structuredClone(report)
    changed[key] = value
    assert.throws(() => renderPrivateRetailerOperatorBrief(changed),
      /geweigerd/, key)
  }
  const shape = structuredClone(report)
  shape.retailers[0].shapes[0].eligibleForLiveCapture = true
  assert.throws(() => renderPrivateRetailerOperatorBrief(shape), /geweigerd/)
})

test('reject conflicting archive counts, swapped retailer identities and incomplete six shapes', async () => {
  const { report } = await historicalReport()
  const cases = [
    report => { report.historicalAcceptedShapes++ },
    report => { report.missingHistoricalShapeCount++ },
    report => { report.staleHistoricalCaptures++ },
    report => { report.retailers[1].retailerId = 'plus' },
    report => { report.retailers[0].shapes.pop() },
    report => { report.retailers[0].shapes[0].rejectedSources++ },
    report => { report.retailers[1].shapes[0].verifiedCurrentPriceObservations = 1 },
  ]
  for (const corrupt of cases) {
    const clone = structuredClone(report)
    corrupt(clone)
    assert.throws(() => renderPrivateRetailerOperatorBrief(clone), /geweigerd/)
  }
})

test('cannot silently suppress genuine rights or freshness actions in operator handoff', async () => {
  const { report } = await historicalReport()
  const cases = [
    current => { current.retailers[0].nextActions =
      current.retailers[0].nextActions.filter(action =>
        action !== 'obtain-and-verify-retailer-source-rights') },
    current => { current.retailers[1].nextActions = [
      'validate-new-captures-offline-before-separate-release-approval',
    ] },
    current => { current.retailers[0].nextActions.reverse() },
    current => { current.retailers[0].sourceRightsReadyForProduction = true },
    current => { current.rightsGateProductionReady = true },
  ]
  for (const corrupt of cases) {
    const clone = structuredClone(report)
    corrupt(clone)
    assert.throws(() => renderPrivateRetailerOperatorBrief(clone), /geweigerd/)
  }
})

test('historical status cannot contradict the same source-shape facts', async () => {
  const { report } = await historicalReport()
  const cases = [
    current => { current.retailers[0].shapes[0].status = 'historical-fixture-present' },
    current => { current.retailers[0].shapes[0].status = 'no-accepted-historical-capture' },
    current => { current.retailers[0].shapes[0].latestArchivedCapturedAt = null },
    current => { current.retailers[1].shapes[1].staleHistoricalCaptures = 50001 },
    current => { current.maxAgeHours = 0 },
    current => { current.referenceTime = 'yesterday' },
  ]
  // Mutate only a single field per case; shape clocks and actions are not
  // independently trusted assertions of catalog publication readiness.
  for (const corrupt of cases) {
    const clone = structuredClone(report)
    corrupt(clone)
    assert.throws(() => renderPrivateRetailerOperatorBrief(clone), /geweigerd/)
  }
})

test('a complete reviewed zero-capture shape still gives honest missing-input guidance', async () => {
  const { report } = await historicalReport()
  const adjusted = structuredClone(report)
  const kind = adjusted.retailers[0].shapes[0]
  const accepted = kind.acceptedSources
  adjusted.historicalAcceptedShapes--
  adjusted.missingHistoricalShapeCount++
  adjusted.retailers[0].acceptedHistoricalShapes--
  kind.acceptedSources = 0
  kind.rejectedSources += accepted
  kind.staleHistoricalCaptures = 0
  kind.historicalObservations = 0
  kind.unknownPriceObservations = 0
  kind.latestArchivedCapturedAt = null
  kind.status = 'no-accepted-historical-capture'
  adjusted.staleHistoricalCaptures -= report.retailers[0].shapes[0].staleHistoricalCaptures
  adjusted.retailers[0].nextActions = [
    'obtain-and-verify-retailer-source-rights',
    'review-missing-offline-source-shapes',
    'review-rejected-adapter-evidence',
    ...(adjusted.retailers[0].shapes.some(shape => shape.staleHistoricalCaptures > 0)
      ? ['review-historical-capture-freshness'] : []),
    'validate-new-captures-offline-before-separate-release-approval',
  ]
  const brief = renderPrivateRetailerOperatorBrief(adjusted)
  assert.match(brief, /geen goedgekeurde historische invoer/)
  assert.match(brief, /ontbrekende bronvormen onderzoeken/)
  assert.match(brief, /afgekeurde broninvoer beoordelen/)
  assert.doesNotMatch(brief, /https?:|sourceProductId|currentPriceCents/)
})

test('unknown historical prices are explicitly visible but never treated as current evidence', async () => {
  const { report } = await historicalReport()
  const withUnknown = structuredClone(report)
  const bucket = withUnknown.retailers[0].shapes.find(shape => shape.historicalObservations > 0)
  assert.ok(bucket)
  bucket.unknownPriceObservations = 1
  const text = renderPrivateRetailerOperatorBrief(withUnknown)
  assert.match(text, /1 historische prijswaarnemingen onbekend/)
  assert.match(text, /controleer bronextractie handmatig/)
  assert.match(text, /geen live ophalen/i)
  assert.doesNotMatch(text, /https?:|sourceProductId|currentPriceCents|€/)
  const forged = structuredClone(withUnknown)
  const corrupt = forged.retailers[0].shapes.find(shape => shape.kind === bucket.kind)
  corrupt.unknownPriceObservations = corrupt.historicalObservations + 1
  assert.throws(() => renderPrivateRetailerOperatorBrief(forged), /geweigerd/)
})

test('direct operator boundary rejects getters, Proxy traps and sparse arrays without executing them', async () => {
  const { report } = await historicalReport()
  let executed = 0
  const getter = structuredClone(report)
  Object.defineProperty(getter.retailers[0], 'permissionStatus', {
    enumerable: true,
    get() { executed++; throw new Error('SECRET SHOULD NEVER RUN') },
  })
  assert.throws(() => renderPrivateRetailerOperatorBrief(getter), /geweigerd/)
  assert.equal(executed, 0)
  const nested = structuredClone(report)
  Object.defineProperty(nested.retailers[1].shapes[0], 'historicalSources', {
    enumerable: true,
    get() { executed++; return 999 },
  })
  assert.throws(() => renderPrivateRetailerOperatorBrief(nested), /geweigerd/)
  assert.equal(executed, 0)
  const proxied = new Proxy(report, {
    get() { executed++; throw new Error('SECRET PROXY EXECUTED') },
    ownKeys() { executed++; return [] },
  })
  assert.throws(() => renderPrivateRetailerOperatorBrief(proxied), /geweigerd/)
  const revoked = Proxy.revocable(structuredClone(report), {})
  revoked.revoke()
  assert.throws(() => renderPrivateRetailerOperatorBrief(revoked.proxy), /geweigerd/)
  assert.equal(executed, 0)
  const sparse = structuredClone(report)
  delete sparse.retailers[0].nextActions[0]
  assert.throws(() => renderPrivateRetailerOperatorBrief(sparse), /geweigerd/)
})

test('direct operator copy has bounded depth and cannot silently omit extra array members', async () => {
  const { report } = await historicalReport()
  const cyclic = structuredClone(report)
  cyclic.retailers[0].self = cyclic
  assert.throws(() => renderPrivateRetailerOperatorBrief(cyclic), /geweigerd/)
  const huge = structuredClone(report)
  huge.retailers[0].nextActions.length = 513
  assert.throws(() => renderPrivateRetailerOperatorBrief(huge), /geweigerd/)
  const inherited = structuredClone(report)
  Object.setPrototypeOf(inherited.retailers[1], { permissionStatus: 'permitted' })
  assert.throws(() => renderPrivateRetailerOperatorBrief(inherited), /geweigerd/)
})

test('operator refuses impossible civil review and source calendars before displaying status', async () => {
  const { report } = await historicalReport()
  for (const impossible of [
    '2025-02-29T12:00:00Z', '2026-02-30T12:00:00Z',
    '2026-13-01T12:00:00Z', '2026-10-16T25:00:00Z',
    '2030-01-01T12:00:00Z',
  ]) {
    const altered = structuredClone(report)
    altered.referenceTime = impossible
    assert.throws(() => renderPrivateRetailerOperatorBrief(altered), /geweigerd/, impossible)
  }
  const acceptedIndex = report.retailers[0].shapes.findIndex(s => s.acceptedSources > 0)
  assert.ok(acceptedIndex >= 0)
  for (const impossible of [
    'not-a-capture-clock', '2026-02-30T00:00:00Z',
    '2025-02-29T00:00:00Z', '2026-12-01T00:00:00+14:01',
    '2026-12-01T00:00:00-15:00', '2030-01-01T00:00:00Z',
  ]) {
    const altered = structuredClone(report)
    altered.retailers[0].shapes[acceptedIndex].latestArchivedCapturedAt = impossible
    assert.throws(() => renderPrivateRetailerOperatorBrief(altered), /geweigerd/, impossible)
  }
})

test('operator compares archive and reference physical nanoseconds with timezone offsets', async () => {
  const { report } = await historicalReport()
  const accepted = report.retailers.flatMap(r => r.shapes).find(s => s.acceptedSources > 0)
  assert.ok(accepted)
  report.referenceTime = '2026-10-16T00:00:00.000000001Z'
  accepted.latestArchivedCapturedAt = '2026-10-15T23:59:59.999999999Z'
  assert.match(renderPrivateRetailerOperatorBrief(report), /ALLEEN HISTORISCHE BRONNEN/)
  accepted.latestArchivedCapturedAt = '2026-10-16T02:00:00.000000001+02:00'
  assert.match(renderPrivateRetailerOperatorBrief(report), /geen live ophalen/i)
  accepted.latestArchivedCapturedAt = '2026-10-16T00:00:00.000000002Z'
  assert.throws(() => renderPrivateRetailerOperatorBrief(report), /geweigerd/)
  accepted.latestArchivedCapturedAt = '2026-10-15T20:00:00.000000001-04:00'
  assert.match(renderPrivateRetailerOperatorBrief(report), /offline winkelbron-startcontrole/)
})

test('operator accepts real Gregorian leap day without implying recent live-price permission', async () => {
  const { report } = await historicalReport()
  report.referenceTime = '2028-02-29T00:00:00.000000001Z'
  // The review clock cannot be later than the actual operator clock, so
  // use a valid leap-day archived capture against today's genuine reference.
  report.referenceTime = '2026-10-16T00:00:00Z'
  const accepted = report.retailers.flatMap(r => r.shapes).find(s => s.acceptedSources > 0)
  assert.ok(accepted)
  accepted.latestArchivedCapturedAt = '2024-02-29T08:30:00.123456789Z'
  const brief = renderPrivateRetailerOperatorBrief(report)
  assert.match(brief, /live-ingestie en publieke prijzen blijven UIT/)
  assert.doesNotMatch(brief, /2024-02-29|prijs: €|https?:/)
})

test('exported zero-argument operator refuses active and revoked Proxy argv inertly', async () => {
  let trapped = 0
  const caller = new Proxy([], {
    get() { trapped++; throw new Error('caller get trap must not execute') },
    getOwnPropertyDescriptor() { trapped++; throw new Error('caller descriptor trap') },
  })
  await assert.rejects(main(caller, () => {}), /startcontrole geweigerd/)
  assert.equal(trapped, 0)
  const revoked = Proxy.revocable([], {})
  revoked.revoke()
  await assert.rejects(main(revoked.proxy, () => {}), error =>
    !(error instanceof TypeError) && /startcontrole geweigerd/.test(String(error)))
  const spoofed = new Proxy(['--not-empty'], {
    get(target, key) { trapped++; return key === 'length' ? 0 : target[key] },
  })
  await assert.rejects(main(spoofed, () => {}), /startcontrole geweigerd/)
  assert.equal(trapped, 0)
  await assert.rejects(main(['--unexpected'], () => {}), /startcontrole geweigerd/)
  const report = await main([], () => {})
  assert.match(report, /ALLEEN HISTORISCHE BRONNEN/)
})
