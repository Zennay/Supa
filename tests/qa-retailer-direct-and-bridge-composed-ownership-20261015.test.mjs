import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { captureApprovedRetailerPage } from '../scripts/retailer-approved-snapshot-capture.mjs'
import { captureToPrivateSelectorReview } from '../scripts/retailer-approved-capture-selector-bridge.mjs'

// Independent QA-only COMPOSITION proof on frozen product owners #3048 +
// #3051. No real written retailer rights, no HTTP traffic, no public prices.
// All allowed examples use in-memory Response with explicitly FICTIONAL grants.
const plus = 'https://www.plus.nl/producten'
const capturedAt = '2026-10-14T12:00:00.000Z'
const html = '<html><body><article class="product-card product-privatefictionalid987"><span data-testid="price-987654321" class="price-label">NOT_REAL</span></article></body></html>'
const syntheticRights = () => ({
  version: 1,
  milestone: 'M1 Data Feasibility',
  reviewedAt: '2026-10-14',
  sources: ['plus', 'dekamarkt'].map(supermarket => ({
    supermarket,
    technicalStatus: 'proven',
    permissionStatus: 'permitted',
    productionEnabled: true,
    evidence: [{
      kind: 'written_permission',
      url: 'https://example.test/qa-synthetic-permission-not-license',
      finding: 'FICTIONAL TEST ONLY — no genuine PLUS/DekaMarkt authorization.',
    }],
  })),
})
const grant = (supermarket='plus', kind='catalog', url=plus) => ({
  supermarket, kind, sourceUrl: url,
  reviewed: true, termsReviewed: true,
  robotsReviewed: true, noAntiBotBypass: true,
})
const options = () => ({
  source: { supermarket: 'plus', kind: 'catalog', url: plus },
  permissionGate: syntheticRights(),
  grant: grant(),
  capturedAt,
})
const fetchMock = counter => async () => {
  counter.count++
  return new Response(html, { status: 200, headers: { 'content-type': 'text/html' } })
}

test('composed owners: BOTH direct capture and bridge reject real PLUS/Deka rights before mock transport', async () => {
  const actual = JSON.parse(await readFile(new URL('../evidence/m1/source-permission-gate.v1.json', import.meta.url), 'utf8'))
  for (const capture of [captureApprovedRetailerPage, captureToPrivateSelectorReview]) {
    const counter = { count: 0 }
    for (const [supermarket, kind, url] of [
      ['plus', 'catalog', plus],
      ['dekamarkt', 'offers', 'https://www.dekamarkt.nl/aanbiedingen'],
    ]) {
      await assert.rejects(() => capture({
        ...options(),
        source: { supermarket, kind, url },
        permissionGate: actual,
        grant: grant(supermarket, kind, url),
        fetchFn: fetchMock(counter),
      }), /Explicit retailer source permission required/u)
    }
    assert.equal(counter.count, 0)
  }
})

test('composed owners: attacker getters in authorization input execute neither at direct nor bridged boundary', async () => {
  for (const capture of [captureApprovedRetailerPage, captureToPrivateSelectorReview]) {
    for (const mutate of [
      opts => Object.defineProperty(opts.grant, 'reviewed', {
        get() { throw Error('QA_GETTER_MUST_NOT_RUN') },
      }),
      opts => Object.defineProperty(opts.permissionGate.sources[0], 'permissionStatus', {
        get() { throw Error('QA_GETTER_MUST_NOT_RUN') },
      }),
      opts => Object.defineProperty(opts.source, 'kind', {
        get() { throw Error('QA_GETTER_MUST_NOT_RUN') },
      }),
    ]) {
      const counter = { count: 0 }, opts = options()
      mutate(opts)
      await assert.rejects(
        () => capture({ ...opts, fetchFn: fetchMock(counter) }),
        err => !String(err).includes('QA_GETTER_MUST_NOT_RUN'),
      )
      assert.equal(counter.count, 0)
    }
  }
})

test('composed owners: both permitted fictional paths retain SHA/time/retailer despite caller mutation in transport', async () => {
  const sha = createHash('sha256').update(html).digest('hex')
  for (const capture of [captureApprovedRetailerPage, captureToPrivateSelectorReview]) {
    const opts = options()
    let calls = 0
    opts.fetchFn = async () => {
      calls++
      opts.source.supermarket = 'dekamarkt'
      opts.source.kind = 'offers'
      opts.permissionGate.sources[0].permissionStatus = 'unresolved'
      opts.grant.sourceUrl = 'https://www.dekamarkt.nl/aanbiedingen'
      return new Response(html, { status: 200, headers: { 'content-type': 'text/html' } })
    }
    const result = await capture(opts)
    assert.equal(calls, 1)
    assert.equal(result.source.retailerId, 'plus')
    assert.equal(result.source.kind, 'catalog')
    assert.equal(result.source.capturedAt, capturedAt)
    assert.equal(result.source.sha256, sha)
    assert.equal(result.readyForIngestion, false)
    assert.equal(result.published ?? false, false)
    if (capture === captureToPrivateSelectorReview) {
      const out = JSON.stringify(result)
      assert.equal(out.includes(plus), false)
      assert.equal(out.includes('privatefictionalid987'), false)
      assert.equal(out.includes('987654321'), false)
      assert.equal(out.includes('NOT_REAL'), false)
      assert.equal(result.humanSelectorApprovalRequired, true)
      assert.equal(result.approvedSelectors, 0)
      assert.equal(result.currentPricesExtracted, false)
      assert.equal(result.publicSavingsClaimEligible, false)
      assert.equal(result.productionEnabled, false)
    }
  }
})

test('composed owners: absence of injected transport never enables a default network client', async () => {
  for (const capture of [captureApprovedRetailerPage, captureToPrivateSelectorReview]) {
    await assert.rejects(() => capture(options()), /Approved fetch transport required|refused/u)
  }
})
