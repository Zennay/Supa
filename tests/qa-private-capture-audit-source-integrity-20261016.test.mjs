import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import {
  auditPhysicalRetailerCaptures,
  auditBundledHistoricalRetailerCaptures,
} from '../scripts/retailer-private-capture-identity-audit.mjs'

// Independent exact-source QA for private operator-only physical identity audit.
// All input is sanitized checked-in historical captures with *fictional*
// mutations in memory. No external URL is requested and no price is published.
async function fixture(name = 'plus-rendered-product-halfvolle-melk.v1.json') {
  return JSON.parse(await readFile(new URL('../fixtures/m1/' + name, import.meta.url), 'utf8'))
}

test('all six checked-in historical reviewed source identities remain privately auditable', async () => {
  const report = await auditBundledHistoricalRetailerCaptures()
  assert.equal(report.uniquePhysicalCaptures, 6)
  assert.equal(report.reviewedSources, 6)
  assert.equal(report.productionEnabled, false)
  assert.equal(report.permissionVerified, false)
  assert.equal(report.publicSavingsClaimEligible, false)
})

test('synthetic capture in year 2099 is not a physically reviewed historical source', async () => {
  const record = await fixture()
  record.source.capturedAt = '2099-10-16T18:08:57.837Z'
  assert.throws(
    () => auditPhysicalRetailerCaptures([record]),
    /Invalid private retailer capture identity/,
  )
})

test('fictional non-existent Gregorian day must not count as real retailer capture', async () => {
  const record = await fixture()
  record.source.capturedAt = '2026-02-30T18:08:57.837Z'
  assert.throws(
    () => auditPhysicalRetailerCaptures([record]),
    /Invalid private retailer capture identity/,
  )
})

test('PLUS physical source must not be auditable after retailer origin is replaced', async () => {
  const record = await fixture()
  record.source.url = record.source.url.replace('www.plus.nl', 'unapproved.example.invalid')
  assert.match(record.source.url, /^https:\/\/unapproved[.]example[.]invalid/)
  assert.throws(
    () => auditPhysicalRetailerCaptures([record]),
    /Invalid private retailer capture identity/,
  )
})

test('fictitious credential-bearing source URL must not count as vetted archived identity', async () => {
  const record = await fixture()
  record.source.url += '?access_token=FICTIONAL_NOT_A_TOKEN'
  assert.throws(
    () => auditPhysicalRetailerCaptures([record]),
    /Invalid private retailer capture identity/,
  )
})

test('two genuinely distinct checked-in PLUS and Deka product sources remain separate', async () => {
  const plus = await fixture()
  const deka = await fixture('dekamarkt-product-halfvolle-melk.v1.json')
  const report = auditPhysicalRetailerCaptures([plus, deka])
  assert.equal(report.uniquePhysicalCaptures, 2)
  assert.deepEqual(report.retailerSourceCounts, { plus: 1, dekamarkt: 1 })
  assert.equal(report.publicSavingsClaimEligible, false)
})
