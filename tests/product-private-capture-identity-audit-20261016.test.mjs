import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import {
  auditPhysicalRetailerCaptures,
  auditBundledHistoricalRetailerCaptures,
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

test('fixed-fixture CLI emits no URL, amount, product, personal value or permission elevation', async () => {
  let actual = ''
  const report = await main([], chunk => { actual += chunk })
  assert.equal(JSON.parse(actual).uniquePhysicalCaptures, 6)
  assert.deepEqual(JSON.parse(actual), report)
  assert.equal(/https:|zuivel|melk|€|product\/|sha256|capturedAt/i.test(actual), false)
  await assert.rejects(() => main(['--url', 'https://example.invalid']), /Usage/)
})
