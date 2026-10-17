import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { renderOfflineM3Dashboard, main } from '../scripts/retailer-m3-operator-dashboard.mjs'
import { assessPrivateM3RetailerIngestion } from '../scripts/retailer-private-m3-ingestion-preflight.mjs'
import { loadReviewedRepositoryFixtures } from '../scripts/retailer-reviewed-ingest-engine.mjs'

const AT = '2026-10-16T12:00:00.000Z'
async function reviewedReport() {
  const policy = JSON.parse(await readFile(
    new URL('../evidence/m1/source-permission-gate.v1.json', import.meta.url), 'utf8'))
  const batch = await loadReviewedRepositoryFixtures()
  return assessPrivateM3RetailerIngestion(policy, batch, { referenceTime: AT,
    inputMode: 'bundled-historical-fixtures' })
}

test('actual six historical adapters render a private, read-only HOLD dashboard', async () => {
  const report = await reviewedReport()
  const html = renderOfflineM3Dashboard(report)
  assert.match(html, /<!doctype html>/i)
  assert.match(html, /lang="nl"/)
  assert.match(html, /Content-Security-Policy/)
  assert.match(html, /HOLD/)
  assert.match(html, /PLUS/)
  assert.match(html, /DekaMarkt/)
  assert.match(html, /Historische aanbiedingen/)
  assert.match(html, /Historische basisprijzen technisch gekoppeld/)
  assert.match(html, /Oudere aanbiedingen niet vergeleken/)
  assert.match(html, /géén actuele korting/)
  for (const kind of ['product', 'catalog', 'offers']) {
    assert.equal((html.match(new RegExp('<th scope="row">' + kind + '<\\/th>', 'g')) ?? []).length, 2)
  }
  assert.match(html, /Schriftelijke bronrechten/)
  assert.match(html, /11 PLUS- en 11 DekaMarkt-observaties/)
  assert.doesNotMatch(html, /https?:\/\//i)
  assert.doesNotMatch(html, /sourceProductId|snapshotSha256|currentPriceCents|sourceUrl/i)
  assert.doesNotMatch(html, /<script|<iframe|<form|<img/i)
})

test('CLI delegates exact six-source real preflight and never writes external evidence', async () => {
  const output = []
  const result = await main(['--at', AT], html => output.push(html))
  assert.deepEqual(result, { status: 'hold', shapeCount: 6,
    htmlBytes: Buffer.byteLength(output[0]) })
  assert.equal(output.length, 1)
  assert.match(output[0], /2026-10-16T12:00:00.000Z/)
  assert.doesNotMatch(output[0], /"sourceUrl":|priceCents|https?:\/\//i)
})

test('node CLI emits just HTML and rejects an unsupported mode with bounded stderr', () => {
  const script = fileURLToPath(new URL('../scripts/retailer-m3-operator-dashboard.mjs', import.meta.url))
  const ok = spawnSync(process.execPath, ['--experimental-strip-types', script, '--at', AT],
    { encoding: 'utf8', timeout: 30000 })
  assert.equal(ok.status, 0, ok.stderr)
  assert.match(ok.stdout, /^<!doctype html>/)
  assert.doesNotMatch(ok.stdout, /sourceProductId|sourceUrl/i)
  const bad = spawnSync(process.execPath, ['--experimental-strip-types', script, '--remote'],
    { encoding: 'utf8', timeout: 30000 })
  assert.equal(bad.status, 2)
  assert.equal(bad.stdout, '')
  assert.match(bad.stderr, /Private M3 operator dashboard refused/)
  assert.doesNotMatch(bad.stderr, /https?:\/\//)
})

test('no accessor or Proxy may execute at the dashboard input boundary', async () => {
  const report = await reviewedReport()
  let getterCalls = 0
  Object.defineProperty(report, 'reviewedAt', {
    enumerable: true, get() { getterCalls++; throw Error('NEVER_EXECUTE') },
  })
  assert.throws(() => renderOfflineM3Dashboard(report), /dashboard refused/)
  assert.equal(getterCalls, 0)
  const other = await reviewedReport()
  let nestedCalls = 0
  Object.defineProperty(other.perSourceShape[0], 'archivedObservations', {
    enumerable: true, get() { nestedCalls++; throw Error('NEVER_EXECUTE') },
  })
  assert.throws(() => renderOfflineM3Dashboard(other), /dashboard refused/)
  assert.equal(nestedCalls, 0)
  const proxyBase = await reviewedReport()
  assert.throws(() => renderOfflineM3Dashboard(new Proxy(proxyBase, {
    get() { throw Error('NEVER_EXECUTE') },
  })), /dashboard refused/)
  const fake = await reviewedReport()
  fake.perSourceShape = new Proxy(fake.perSourceShape, {
    get() { throw Error('NEVER_EXECUTE') },
  })
  assert.throws(() => renderOfflineM3Dashboard(fake), /dashboard refused/)
})

test('no forged publication readiness, price input, HTML, unknown action or inconsistent totals', async () => {
  const base = await reviewedReport()
  for (const [field, value] of [
    ['permissionVerified', true], ['publicSavingsClaimEligible', true],
    ['liveRequests', 1], ['releaseDecision', 'approved'],
    ['productionEnabled', true], ['currentStockCoverageVerified', true],
  ]) {
    const copy = structuredClone(base)
    copy[field] = value
    assert.throws(() => renderOfflineM3Dashboard(copy), /dashboard refused/, field)
  }
  const badStatus = structuredClone(base)
  badStatus.perSourceShape[0].historicalStatus = '<script>alert(1)</script>'
  assert.throws(() => renderOfflineM3Dashboard(badStatus), /dashboard refused/)
  const badDate = structuredClone(base)
  badDate.perSourceShape[0].latestArchivedCapturedAt = '"><img src=x onerror=alert(1)>'
  assert.throws(() => renderOfflineM3Dashboard(badDate), /dashboard refused/)
  const badAction = structuredClone(base)
  badAction.operatorActions.push('<img src=x onerror=alert(1)>')
  assert.throws(() => renderOfflineM3Dashboard(badAction), /dashboard refused/)
  const badTotals = structuredClone(base)
  badTotals.historicalStockAvailableObservations++
  assert.throws(() => renderOfflineM3Dashboard(badTotals), /dashboard refused/)
  const badRows = structuredClone(base)
  badRows.perSourceShape.push(badRows.perSourceShape[0])
  assert.throws(() => renderOfflineM3Dashboard(badRows), /dashboard refused/)
})

test('operator offer accounting cannot hide unreviewed history or misstate baselines', async () => {
  const baseline = await reviewedReport()
  const safeHtml = renderOfflineM3Dashboard(baseline)
  assert.match(safeHtml, /Basisprijs niet bevestigd/)
  assert.match(safeHtml, /Ongeldige kortingsclaims/)
  assert.match(safeHtml, /Een echte 11×2-veldmand/)
  assert.doesNotMatch(safeHtml, /<script|sourceProductId|snapshotSha256/i)
  for (const [field, shift] of [
    ['archivedOfferRows', 1],
    ['corroboratedHistoricalOfferBaselines', 1],
    ['olderHistoricalOfferRowsNotCompared', 1],
    ['sourceEventsOutsideOfferReview', 1],
    ['selectedSourceEventsForOfferReview', 1],
  ]) {
    const forged = structuredClone(baseline)
    forged[field] += shift
    assert.throws(() => renderOfflineM3Dashboard(forged),
      /dashboard refused/, field)
  }
  const invalid = structuredClone(baseline)
  invalid.unknownOfferWindows = invalid.archivedOfferRows + 1
  assert.throws(() => renderOfflineM3Dashboard(invalid), /dashboard refused/)
})
