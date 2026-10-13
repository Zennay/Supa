import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import { assessRetailerDiscovery } from '../scripts/m5-audit-retailer-discovery.mjs'
import {
  buildRetailerReviewPack,
  renderReviewPackCsv,
  renderReviewPackMarkdown,
} from '../scripts/m5-build-retailer-review-pack.mjs'
import { reconcileRetailerRights } from '../scripts/m5-reconcile-retailer-rights.mjs'

const discoveryBytes = await readFile(new URL('../docs/m5-retailer-discovery.v1.json', import.meta.url), 'utf8')
const m1Bytes = await readFile(new URL('../evidence/m1/source-permission-gate.v1.json', import.meta.url), 'utf8')
const discovery = JSON.parse(discoveryBytes)
const m1 = JSON.parse(m1Bytes)
const clone = (value) => structuredClone(value)

// Decode the actual RFC4180-style CSV cells, not naive comma splitting.
// This oracle is deliberately independent of the review-pack CSV renderer.
function parseQuotedRow(line) {
  const fields = []
  let cursor = 0
  while (cursor < line.length) {
    assert.equal(line[cursor++], '"', 'each CSV field must be quoted')
    let value = ''
    let closed = false
    while (cursor < line.length) {
      if (line[cursor] !== '"') {
        value += line[cursor++]
        continue
      }
      if (line[cursor + 1] === '"') {
        value += '"'
        cursor += 2
        continue
      }
      cursor++
      closed = true
      break
    }
    assert.equal(closed, true, 'CSV field must be terminated')
    fields.push(value)
    if (cursor === line.length) break
    assert.equal(line[cursor++], ',', 'expected comma after CSV cell')
  }
  return fields
}

test('independent M5 rights oracle: audit, review pack and M1 reconciliation use the same 17 market identities', () => {
  const input = clone(discovery)
  const gate = clone(m1)
  const original = JSON.stringify(input)
  const gateOriginal = JSON.stringify(gate)
  const audit = assessRetailerDiscovery(input)
  const pack = buildRetailerReviewPack(input)
  const rights = reconcileRetailerRights(input, gate)

  const ids = audit.sources.map((source) => source.id)
  assert.equal(ids.length, 17)
  assert.deepEqual(pack.items.map((item) => item.retailerId), ids)
  assert.deepEqual(rights.sourceStatuses.map((source) => source.supermarket), ids)
  assert.deepEqual(ids, [...ids].sort(), 'stable locale-independent ordering on canonical names')

  assert.equal(audit.productionReady, false)
  assert.equal(pack.productionReady, false)
  assert.equal(rights.productionReady, false)
  assert.equal(rights.m5Eligible, false)
  assert.equal(rights.blockedForM5, 17)
  assert.equal(pack.items.filter((row) => row.existingM1ProofPair).length, 2)
  assert.deepEqual(pack.items.filter((row) => row.existingM1ProofPair).map((row) => row.retailerId),
    ['dekamarkt', 'plus'])
  assert.ok(pack.items.every((item) => item.productionEnabled === false &&
    item.permissionEvidence === null))
  assert.ok(rights.sourceStatuses.every((item) => item.m5ProductionEnabled === false))
  assert.equal(JSON.stringify(input), original)
  assert.equal(JSON.stringify(gate), gateOriginal)
})

test('independent M5 CSV oracle: every exported row round-trips to the same reviewed-disabled JSON facts', () => {
  const pack = buildRetailerReviewPack(clone(discovery))
  const csv = renderReviewPackCsv(pack)
  assert.ok(csv.endsWith('\r\n'))
  assert.equal(csv.replaceAll('\r\n', '').includes('\n'), false, 'only CRLF record breaks')
  const rows = csv.slice(0, -2).split('\r\n').map(parseQuotedRow)
  assert.equal(rows.length, pack.sourceCount + 1)
  const keys = rows.shift()
  const expectedColumns = [
    'retailerId', 'retailerName', 'marketListReference', 'existingM1ProofPair',
    'permissionStatus', 'sourceMechanism', 'regionScope', 'assortmentScope',
    'termsStatus', 'robotsStatus', 'dataOwner', 'permissionEvidence',
    'productionEnabled', 'nextAction',
  ]
  assert.deepEqual(keys, expectedColumns)
  for (let index = 0; index < pack.items.length; index++) {
    const item = pack.items[index]
    const decoded = Object.fromEntries(keys.map((key, cell) => [key, rows[index][cell]]))
    assert.equal(rows[index].length, keys.length)
    assert.equal(decoded.retailerId, item.retailerId)
    assert.equal(decoded.retailerName, item.retailerName)
    assert.equal(decoded.marketListReference, item.marketListReference)
    assert.equal(decoded.existingM1ProofPair, String(item.existingM1ProofPair))
    assert.equal(decoded.permissionStatus, 'unreviewed')
    assert.equal(decoded.sourceMechanism, 'unassessed')
    assert.equal(decoded.productionEnabled, 'false')
    assert.equal(decoded.permissionEvidence, '')
    assert.match(decoded.nextAction, /written permission|official license/i)
  }
})

test('independent M5 Markdown oracle: exactly one disabled market listing per research candidate', () => {
  const pack = buildRetailerReviewPack(clone(discovery))
  const markdown = renderReviewPackMarkdown(pack)
  const listingLines = markdown.split('\n').filter((line) => line.endsWith(' | disabled |'))
  assert.equal(listingLines.length, 17)
  for (const [index, item] of pack.items.entries()) {
    const row = listingLines[index]
    assert.ok(row.startsWith(`| ${item.retailerName} | ${item.marketListReference} |`),
      'review row must show the real market-list reference without granting source access')
    assert.ok(row.includes('| unreviewed | disabled |'))
    assert.ok(row.includes(item.existingM1ProofPair ? '| existing M1 research only |' : '| no |'))
  }
  assert.match(markdown, /M3 is still open; M4\/M5 not authorized/)
  assert.match(markdown, /market-list mentions are NOT a license/)
  assert.match(markdown, /No human review or official permission has been completed/)
})

test('independent M5 fail-closed status oracle: a market-list candidate is not a reviewed permission record', () => {
  for (const value of ['approved', 'permitted', 'permission-requested', 'denied', true, null]) {
    const copy = clone(discovery)
    copy.sources[0].permissionStatus = value
    assert.throws(() => assessRetailerDiscovery(copy), /permission status/i,
      'discovery must not store a review decision or imply production rights')
    assert.throws(() => buildRetailerReviewPack(copy), /permission status/i)
    assert.throws(() => reconcileRetailerRights(copy, clone(m1)), /permission status/i)
  }
})
