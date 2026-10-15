import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { captureApprovedRetailerPage } from '../scripts/retailer-approved-snapshot-capture.mjs'

const url = 'https://www.plus.nl/producten'
const clock = '2026-10-14T12:00:00.000Z'
const gate = () => ({
  version: 1, milestone: 'M1 Data Feasibility', reviewedAt: '2026-10-14',
  sources: ['plus', 'dekamarkt'].map(supermarket => ({
    supermarket, technicalStatus: 'proven', productionEnabled: true,
    permissionStatus: 'permitted', evidence: [{
      kind: 'written_permission',
      url: 'https://example.test/fictional-not-real-license',
      finding: 'SYNTHETIC ONLY, no actual store permission.',
    }],
  })),
})
const grant = () => ({
  supermarket: 'plus', kind: 'catalog', sourceUrl: url,
  reviewed: true, termsReviewed: true,
  robotsReviewed: true, noAntiBotBypass: true,
})
const input = () => ({
  source: { supermarket: 'plus', kind: 'catalog', url },
  permissionGate: gate(), grant: grant(), capturedAt: clock,
})
const mock = counter => async () => {
  counter.calls++
  return new Response('<div class="product-card">no-real-data</div>', {
    status: 200, headers: { 'content-type': 'text/html' },
  })
}

test('direct capture: real checked-in unlicensed PLUS and DekaM1 never call injected transport', async () => {
  const rights = JSON.parse(await readFile(new URL('../evidence/m1/source-permission-gate.v1.json', import.meta.url), 'utf8'))
  const count = { calls: 0 }
  for (const [supermarket, kind, page] of [
    ['plus', 'catalog', url],
    ['dekamarkt', 'offers', 'https://www.dekamarkt.nl/aanbiedingen'],
  ]) {
    await assert.rejects(() => captureApprovedRetailerPage({
      source: { supermarket, kind, url: page },
      permissionGate: rights,
      grant: { ...grant(), supermarket, kind, sourceUrl: page },
      capturedAt: clock, fetchFn: mock(count),
    }), /Explicit retailer source permission required/)
  }
  assert.equal(count.calls, 0)
})

test('direct capture: getters in any nested authority value never execute before refusal', async () => {
  for (const mutate of [
    x => Object.defineProperty(x, 'grant', { get() { throw Error('GETTER_EXECUTED') } }),
    x => Object.defineProperty(x.grant, 'reviewed', { get() { throw Error('GETTER_EXECUTED') } }),
    x => Object.defineProperty(x.source, 'url', { get() { throw Error('GETTER_EXECUTED') } }),
    x => Object.defineProperty(x.permissionGate.sources[0], 'permissionStatus',
      { get() { throw Error('GETTER_EXECUTED') } }),
    x => Object.defineProperty(x.permissionGate.sources[0].evidence[0], 'kind',
      { get() { throw Error('GETTER_EXECUTED') } }),
  ]) {
    const opts = input(), count = { calls: 0 }
    opts.fetchFn = mock(count)
    mutate(opts)
    await assert.rejects(() => captureApprovedRetailerPage(opts),
      error => /inert permission data/.test(String(error)) &&
        !String(error).includes('GETTER_EXECUTED'))
    assert.equal(count.calls, 0)
  }
})

test('direct capture: Proxy, sparse evidence and modified array prototype refuse before transport', async () => {
  for (const mutate of [
    x => { x.grant = new Proxy(x.grant, {}) },
    x => { x.permissionGate.sources[0].evidence = new Proxy(x.permissionGate.sources[0].evidence, {}) },
    x => { x.permissionGate.sources = new Array(2); x.permissionGate.sources[0] = gate().sources[0] },
    x => { Object.setPrototypeOf(x.permissionGate.sources, []) },
  ]) {
    const opts = input(), count = { calls: 0 }
    opts.fetchFn = mock(count)
    mutate(opts)
    await assert.rejects(() => captureApprovedRetailerPage(opts))
    assert.equal(count.calls, 0)
  }
})

test('direct capture: ordinary fictional license still returns SHA-bound review-only HTML', async () => {
  const count = { calls: 0 }, opts = input()
  opts.fetchFn = mock(count)
  const result = await captureApprovedRetailerPage(opts)
  assert.equal(count.calls, 1)
  assert.equal(result.source.url, url)
  assert.equal(result.source.capturedAt, clock)
  assert.equal(result.source.sha256, createHash('sha256').update(result.html).digest('hex'))
  assert.equal(result.mode, 'authorized-one-page-capture-needs-review')
  assert.equal(result.readyForIngestion, false)
  assert.equal(result.normalized, false)
  assert.equal(result.published, false)
})

test('direct capture: mutation inside injected response cannot falsify returned source provenance', async () => {
  const opts = input()
  opts.fetchFn = async () => {
    opts.source.supermarket = 'dekamarkt'
    opts.source.kind = 'offers'
    opts.permissionGate.sources[0].permissionStatus = 'unresolved'
    opts.grant.sourceUrl = 'https://www.dekamarkt.nl/aanbiedingen'
    return new Response('<p>FICTIONAL</p>', {
      status: 200, headers: { 'content-type': 'text/html' },
    })
  }
  const result = await captureApprovedRetailerPage(opts)
  assert.equal(result.source.retailerId, 'plus')
  assert.equal(result.source.kind, 'catalog')
  assert.equal(result.source.url, url)
  assert.equal(result.readyForIngestion, false)
  assert.equal(result.published, false)
})
