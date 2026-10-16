import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { evaluateSourcePermissionGate } from
  '../scripts/m1-check-source-permission-gate.mjs'
import { captureApprovedRetailerPage } from
  '../scripts/retailer-approved-snapshot-capture.mjs'

// Independent quality-validation for the actual reviewed rights document.
// All targets are fictional retailer-path examples; an injected transport
// throws if called. This suite never performs retailer HTTP or grants rights.
const rights = JSON.parse(await readFile(
  new URL('../evidence/m1/source-permission-gate.v1.json', import.meta.url), 'utf8'))
const urls = {
  plus: {
    product: 'https://www.plus.nl/product/qa-fictional-no-item-20261016',
    catalog: 'https://www.plus.nl/producten',
    offers: 'https://www.plus.nl/aanbiedingen',
  },
  dekamarkt: {
    product: 'https://www.dekamarkt.nl/producten/qa-fictional-no-item-20261016',
    catalog: 'https://www.dekamarkt.nl/producten/qa-fictional-no-list',
    offers: 'https://www.dekamarkt.nl/aanbiedingen',
  },
}
function request(supermarket, kind, permissionGate, calls) {
  const url = urls[supermarket][kind]
  return {
    source: { supermarket, kind, url },
    permissionGate,
    grant: {
      supermarket, kind, sourceUrl: url, reviewed: true,
      termsReviewed: true, robotsReviewed: true, noAntiBotBypass: true,
    },
    capturedAt: new Date(Date.now() - 60_000).toISOString(),
    fetchFn: async () => { calls.count++; throw Error('UNAUTHORIZED_HTTP_MUST_NOT_RUN') },
  }
}

test('canonical source gate retains both independent real rights blockers', () => {
  const report = evaluateSourcePermissionGate(rights)
  assert.equal(report.productionReady, false)
  assert.deepEqual(report.expectedSources, ['dekamarkt', 'plus'])
  assert.deepEqual(report.blockers.map(x => [x.supermarket, x.permissionStatus,
    x.productionEnabled]), [
    ['plus', 'permission_required', false],
    ['dekamarkt', 'unresolved', false],
  ])
})

test('all six product/catalog/offer routes deny transport under the actual current repo rights', async () => {
  const calls = { count: 0 }
  for (const supermarket of ['plus', 'dekamarkt']) {
    for (const kind of ['product', 'catalog', 'offers']) {
      const options = request(supermarket, kind, rights, calls)
      await assert.rejects(captureApprovedRetailerPage(options),
        /Explicit retailer source permission required/)
      assert.equal(calls.count, 0, supermarket + ' ' + kind + ' must never transport')
    }
  }
})

test('published conditions cannot be relabelled as permission for either retailer or any route', async () => {
  const calls = { count: 0 }
  for (const supermarket of ['plus', 'dekamarkt']) {
    const forged = structuredClone(rights)
    const record = forged.sources.find(x => x.supermarket === supermarket)
    record.permissionStatus = 'permitted'
    record.productionEnabled = true
    // Both existing records contain published terms / analysis, not
    // written_permission or official_license. No new evidence is introduced.
    assert.ok(record.evidence.length > 0)
    assert.ok(record.evidence.every(x =>
      !['written_permission', 'official_license'].includes(x.kind)))
    assert.throws(() => evaluateSourcePermissionGate(forged),
      /without explicit authorization evidence/)
    for (const kind of ['product', 'catalog', 'offers']) {
      await assert.rejects(captureApprovedRetailerPage(
        request(supermarket, kind, forged, calls)),
      /without explicit authorization evidence/)
    }
  }
  assert.equal(calls.count, 0)
})

test('truthy but noncanonical permission statuses cannot enable approved capture', async () => {
  const calls = { count: 0 }
  for (const fakeStatus of ['granted', 'approved', 'true', true, 1]) {
    const forged = structuredClone(rights)
    forged.sources[0].permissionStatus = fakeStatus
    forged.sources[0].productionEnabled = true
    assert.throws(() => evaluateSourcePermissionGate(forged),
      /invalid permission status/)
    await assert.rejects(captureApprovedRetailerPage(
      request('plus', 'product', forged, calls)), /invalid permission status/)
  }
  assert.equal(calls.count, 0)
})

test('inherited/getter permission data cannot execute callback or reach transport', async () => {
  const calls = { count: 0, getters: 0 }
  const hostile = structuredClone(rights)
  Object.defineProperty(hostile.sources[0], 'permissionStatus', {
    enumerable: true, get() {
      calls.getters++
      throw Error('MUST_NOT_RUN_PERMISSION_GETTER')
    },
  })
  await assert.rejects(captureApprovedRetailerPage(
    request('plus', 'product', hostile, calls)),
  /inert permission data/)
  assert.equal(calls.getters, 0)
  assert.equal(calls.count, 0)
})
