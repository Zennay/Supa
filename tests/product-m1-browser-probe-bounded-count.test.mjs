import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import vm from 'node:vm'
import test from 'node:test'
import { reviewDomProbe } from '../scripts/m1-dom-candidate-review.mjs'
import { RESEARCH_SOURCES } from '../scripts/m1-multistore-research.mjs'

const snippet = readFileSync(resolve('scripts/m1-dom-candidate-probe.js'), 'utf8')
const source = RESEARCH_SOURCES.find(source => source.id === 'dirk-boodschappen')
const catalogSelector = 'a[href*="/product"]'
const secret = 'SYNTHETIC-PRICE-PRIVATE-999'

function inspect(catalogCount, nameCount = 1) {
  const logs = []
  const document = {
    querySelectorAll(selector) {
      if (selector === 'h1') return { length: nameCount }
      if (selector === catalogSelector) return { length: catalogCount }
      if (selector.startsWith('h1,')) return [{
        tagName: 'H1', classList: ['category'], textContent: secret,
      }]
      return { length: 0 }
    },
  }
  const sandbox = {
    location: { protocol: 'https:', hostname: new URL(source.url).hostname },
    document, Date, console: { log: (...args) => logs.push(args) },
  }
  sandbox.globalThis = sandbox
  const browserReport = vm.runInNewContext(snippet, sandbox)
  // Operators transfer the DevTools report as JSON to the offline Node reviewer.
  // Cross-realm VM arrays are not equivalent to parsed on-disk JSON arrays.
  const report = JSON.parse(JSON.stringify(browserReport))
  return { report, logs }
}

test('at the exact 500-match boundary keep actual structural count for manual review', () => {
  const { report } = inspect(500)
  const row = report.selectors.find(row => row.selector === catalogSelector)
  assert.equal(row.count, 500)
  assert.equal(row.semanticVerified, false)
  const reviewed = reviewDomProbe(report, { sourceId: source.id, nowMs: Date.parse(report.capturedAt) })
  assert.equal(reviewed.status, 'human-semantic-review-required')
  assert.equal(reviewed.selectors.some(row => row.count === 500), true)
  assert.equal(reviewed.retailerPermissionVerified, false)
})

test('a single 501-match selector is skipped, not truncated or allowed to invalidate safe candidates', () => {
  const { report, logs } = inspect(501)
  assert.equal(report.selectors.some(row => row.selector === catalogSelector), false)
  assert.equal(report.selectors.find(row => row.selector === 'h1').count, 1)
  const reviewed = reviewDomProbe(report, { sourceId: source.id, nowMs: Date.parse(report.capturedAt) })
  assert.equal(reviewed.selectors.length, 1)
  assert.equal(reviewed.actualClassCandidates.length, 1)
  assert.equal(reviewed.semanticVerified, false)
  assert.equal(reviewed.domCaptureIdentityVerified, false)
  assert.equal(reviewed.livePriceVerified, false)
  assert.equal(reviewed.publicSavingsClaimEligible, false)
  assert.doesNotMatch(JSON.stringify(report) + JSON.stringify(logs), /SYNTHETIC-PRICE|999/)
})

test('all oversized selectors result in empty unverified review rather than forged bounded counts', () => {
  const { report } = inspect(10_000, 900)
  assert.equal(report.selectors.length, 0)
  const reviewed = reviewDomProbe(report, { sourceId: source.id, nowMs: Date.parse(report.capturedAt) })
  assert.equal(reviewed.status, 'human-semantic-review-required')
  assert.equal(reviewed.selectors.length, 0)
  assert.equal(reviewed.livePriceVerified, false)
})
