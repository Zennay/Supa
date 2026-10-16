import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import {
  auditPhysicalRetailerCaptures,
  auditBundledHistoricalRetailerCaptures,
  ingestPhysicallyDistinctReviewedBatch,
  main,
} from '../scripts/retailer-private-capture-identity-audit.mjs'

const plusFile = 'plus-rendered-product-halfvolle-melk.v1.json'
const dekaFile = 'dekamarkt-product-halfvolle-melk.v1.json'
const read = async file => JSON.parse(await readFile(new URL('../fixtures/m1/' + file, import.meta.url), 'utf8'))

test('six real sanitized historical reviewed sources remain private and distinct', async () => {
  const report = await auditBundledHistoricalRetailerCaptures()
  assert.equal(report.reviewedSources, 6)
  assert.equal(report.uniquePhysicalCaptures, 6)
  assert.deepEqual(report.retailerSourceCounts, { plus: 3, dekamarkt: 3 })
  assert.equal(report.productionEnabled, false)
  assert.equal(report.permissionVerified, false)
  assert.equal(report.publicSavingsClaimEligible, false)
  assert.equal(JSON.stringify(report).includes('https://'), false)
  assert.equal(JSON.stringify(report).includes('price'), false)
})

test('one renamed internal ID still describes one valid physical capture', async () => {
  const a = await read(plusFile)
  const copy = structuredClone(a)
  copy.source.id += '-alias'
  assert.equal(auditPhysicalRetailerCaptures([copy]).uniquePhysicalCaptures, 1)
})

for (const file of [plusFile, dekaFile]) {
  test('refuses a second logical ID for the identical retailer URL, timestamp and immutable bytes: ' + file, async () => {
    const a = await read(file)
    const b = structuredClone(a)
    b.source.id += '-alias'
    assert.throws(() => auditPhysicalRetailerCaptures([a, b]), /Duplicate physical/)
  })
  test('refuses identical labeled record even if the same identity is passed twice: ' + file, async () => {
    const a = await read(file)
    assert.throws(() => auditPhysicalRetailerCaptures([a, structuredClone(a)]), /Duplicate physical/)
  })
}

test('mixed PLUS and Deka with hidden third PLUS ID cannot inflate private evidence counts', async () => {
  const plus = await read(plusFile)
  const deka = await read(dekaFile)
  const alias = structuredClone(plus)
  alias.source.id = 'fictional-third-reviewed-source'
  assert.throws(() => auditPhysicalRetailerCaptures([plus, deka, alias]), /Duplicate physical/)
  const valid = auditPhysicalRetailerCaptures([plus, deka])
  assert.deepEqual(valid.retailerSourceCounts, { plus: 1, dekamarkt: 1 })
})

test('one physical page cannot impersonate independent product and catalog proof', async () => {
  const product = await read(plusFile)
  const fakeCatalog = structuredClone(product)
  fakeCatalog.source.id = 'fictional-other-shape'
  fakeCatalog.source.kind = 'catalog'
  fakeCatalog.evidenceType = 'plus-browser-rendered-catalog'
  assert.throws(
    () => auditPhysicalRetailerCaptures([product, fakeCatalog]),
    /Duplicate physical|Invalid private retailer capture identity/,
  )
})

test('independent captures with a distinct hash and source ID are not mistaken for an alias', async () => {
  const first = await read(plusFile)
  const second = structuredClone(first)
  second.source.id += '-second-capture'
  second.source.sha256 = 'a'.repeat(64) // synthetic identity only, not accepted price evidence
  const result = auditPhysicalRetailerCaptures([first, second])
  assert.equal(result.uniquePhysicalCaptures, 2)
  assert.equal(result.productionEnabled, false)
})

test('rejects unapproved retailer/shape, malformed digests, empty batch and huge batch', async () => {
  const first = await read(plusFile)
  assert.throws(() => auditPhysicalRetailerCaptures([]), /Invalid/)
  assert.throws(() => auditPhysicalRetailerCaptures(Array(33).fill(first)), /Invalid/)
  for (const mutate of [
    x => { x.source.supermarket = 'another' },
    x => { x.evidenceType = 'dekamarkt-public-ssr-nuxt-product' },
    x => { x.source.sha256 = 'not-a-digest' },
    x => { x.source.id = 'unexpected/key' },
  ]) {
    const item = structuredClone(first)
    mutate(item)
    assert.throws(() => auditPhysicalRetailerCaptures([item]), /Invalid/)
  }
})

test('never counts impossible Gregorian and physically future clocks as reviewed sources', async () => {
  const original = await read(plusFile)
  for (const fakeClock of [
    '2026-02-30T18:08:57.837Z',
    '2026-04-31T18:08:57.837Z',
    '2099-10-16T18:08:57.837Z',
    '2026-10-04T18:08:57.837+15:00',
    '2026-10-04T18:08:57.837-13:00',
    '2026-10-04T18:08:57.837-14:00',
    '2026-10-04T18:08:57.837-12:01',
    '2026-10-04T18:08:57.837+14:01',
  ]) {
    const sample = structuredClone(original)
    sample.source.capturedAt = fakeClock
    assert.throws(() => auditPhysicalRetailerCaptures([sample]),
      /Invalid private retailer capture identity/)
  }
})

test('unreviewed retailer origin, credential-named query, fragment and raw delimiters fail closed', async () => {
  const original = await read(plusFile)
  const cases = [
    original.source.url.replace('www.plus.nl', 'unapproved.example.invalid'),
    original.source.url + '?access_token=FICTIONAL',
    original.source.url + '#fictional',
    original.source.url + '?',
    original.source.url + '#',
    original.source.url.replace('https://', 'http://'),
  ]
  for (const url of cases) {
    const sample = structuredClone(original)
    sample.source.url = url
    assert.throws(() => auditPhysicalRetailerCaptures([sample]),
      /Invalid private retailer capture identity/)
  }
})

test('equivalent Z, +00:00 and +02:00 instants are one physical capture', async () => {
  const original = await read(plusFile)
  for (const clock of [
    original.source.capturedAt.replace('Z', '+00:00'),
    '2026-10-04T20:08:57.837+02:00',
  ]) {
    const alias = structuredClone(original)
    alias.source.id += '-alternate-clock'
    alias.source.capturedAt = clock
    assert.throws(() => auditPhysicalRetailerCaptures([original, alias]),
      /Duplicate physical/)
  }
})

test('genuinely distinct offset instants and nanoseconds remain independently auditable', async () => {
  const original = await read(plusFile)
  const later = structuredClone(original)
  later.source.id += '-later-offset'
  later.source.capturedAt = '2026-10-04T20:08:57.837+01:00'
  assert.equal(auditPhysicalRetailerCaptures([original, later]).uniquePhysicalCaptures, 2)
  const oneNanosecondLater = structuredClone(original)
  oneNanosecondLater.source.id += '-one-nano'
  oneNanosecondLater.source.capturedAt = '2026-10-04T18:08:57.837000001Z'
  assert.equal(auditPhysicalRetailerCaptures([original, oneNanosecondLater]).uniquePhysicalCaptures, 2)
})

test('detaches inert input without executing getters or traversing non-enumerable source', async () => {
  const sample = await read(plusFile)
  let called = false
  Object.defineProperty(sample.source, 'sha256', {
    enumerable: true, configurable: true, get() { called = true; throw Error('getter executed') },
  })
  assert.throws(() => auditPhysicalRetailerCaptures([sample]), /inert JSON/)
  assert.equal(called, false)
  const hidden = await read(plusFile)
  Object.defineProperty(hidden, 'source', { value: hidden.source, enumerable: false })
  assert.throws(() => auditPhysicalRetailerCaptures([hidden]), /inert JSON/)
})

test('opt-in private batch entrypoint accepts genuine historical cross-store captures with rights disabled', async () => {
  const result = ingestPhysicallyDistinctReviewedBatch([await read(plusFile), await read(dekaFile)])
  assert.equal(result.summary.acceptedSources, 2)
  assert.equal(result.summary.rejectedSources, 0)
  assert.equal(result.summary.productionEnabled, false)
  assert.equal(result.summary.permissionVerified, false)
  assert.equal(result.summary.publicSavingsClaimEligible, false)
})

test('opt-in private batch entrypoint refuses a second ID for one physical page before ingestion', async () => {
  const plus = await read(plusFile)
  const alias = structuredClone(plus)
  alias.source.id += '-fictional-second-id'
  assert.throws(
    () => ingestPhysicallyDistinctReviewedBatch([plus, alias]),
    /Duplicate physical/,
  )
})

test('exported CLI refuses hostile argv without triggering Proxy traps', async () => {
  let accessed = false
  const hostile = new Proxy([], {
    get() { accessed = true; throw Error('executed argv trap') },
  })
  await assert.rejects(() => main(hostile), /inert JSON/)
  assert.equal(accessed, false)
})

test('fixed-fixture CLI emits no URL, amount, product, personal value or permission elevation', async () => {
  let actual = ''
  const report = await main([], chunk => { actual += chunk })
  assert.equal(JSON.parse(actual).uniquePhysicalCaptures, 6)
  assert.deepEqual(JSON.parse(actual), report)
  assert.equal(/https:|zuivel|melk|€|product\/|sha256|capturedAt/i.test(actual), false)
  await assert.rejects(() => main(['--url', 'https://example.invalid']), /Usage/)
})
