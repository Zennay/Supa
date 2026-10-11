import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import vm from 'node:vm'
import test from 'node:test'
import { reviewDomProbe } from '../scripts/m1-dom-candidate-review.mjs'
import { RESEARCH_SOURCES } from '../scripts/m1-multistore-research.mjs'

const source = RESEARCH_SOURCES.find(source => source.id === 'dirk-boodschappen')
const snippet = readFileSync(resolve('scripts/m1-dom-candidate-probe.js'), 'utf8')
const secret = 'PRIVATE-LARGE-DOM-PRICE-1999'
const collectionSelector = 'h1, [itemprop="price"], [data-testid*="price" i], [class*="price" i], a[href*="/product"]'

function guardedCollection(size, safeMaximum, item) {
  const counters = { indexed: 0, iterated: 0 }
  const collection = new Proxy({
    length: size,
    [Symbol.iterator]: function* () {
      for (let i = 0; i < size; i++) {
        counters.iterated++
        if (i >= safeMaximum) throw new Error('UNBOUNDED-ITERATOR-PRIVATE-DOM')
        yield typeof item === 'function' ? item(i) : item
      }
    },
  }, {
    get(target, key) {
      if (typeof key === 'string' && /^(0|[1-9][0-9]*)$/.test(key)) {
        const index = Number(key)
        counters.indexed++
        if (index >= safeMaximum) throw new Error('UNBOUNDED-INDEX-PRIVATE-DOM')
        return typeof item === 'function' ? item(index) : item
      }
      return Reflect.get(target, key)
    },
  })
  return { collection, counters }
}

function run(elements) {
  const logs = []
  const doc = { querySelectorAll(selector) {
    if (selector === collectionSelector) return elements
    if (selector === 'h1') return { length: 1 }
    return { length: 0 }
  } }
  const ctx = { document: doc, location: { hostname: new URL(source.url).hostname, protocol: 'https:' },
    Date, console: { log: (...args) => logs.push(args) } }
  ctx.globalThis = ctx
  const report = JSON.parse(JSON.stringify(vm.runInNewContext(snippet, ctx)))
  const reviewed = reviewDomProbe(report, { sourceId: source.id, nowMs: Date.parse(report.capturedAt) })
  assert.equal(reviewed.status, 'human-semantic-review-required')
  assert.equal(reviewed.domCaptureIdentityVerified, false)
  assert.equal(reviewed.livePriceVerified, false)
  assert.equal(reviewed.publicSavingsClaimEligible, false)
  assert.doesNotMatch(JSON.stringify(report) + JSON.stringify(logs), /PRIVATE-LARGE-DOM|1999/)
  return report
}

test('500-node browser sampling avoids copying or iterating an entire oversized DOM NodeList', () => {
  const element = { tagName: 'SPAN', classList: ['price-main'], textContent: secret }
  const { collection, counters } = guardedCollection(10_000, 500, element)
  const report = run(collection)
  assert.equal(report.actualClassCandidates.find(item => item.selector === 'span.price-main').observedNodes, 500)
  assert.equal(counters.indexed, 500)
  assert.equal(counters.iterated, 0)
})

test('five classes per element are indexed without materializing an oversized DOMTokenList', () => {
  const { collection, counters } = guardedCollection(1000, 5, i => 'active-' + i)
  const report = run([{ tagName: 'SPAN', classList: collection, textContent: secret }])
  assert.equal(report.actualClassCandidates.length, 5)
  assert.equal(report.actualClassCandidates.some(row => row.selector === 'span.active-4'), true)
  assert.equal(counters.indexed, 5)
  assert.equal(counters.iterated, 0)
})

test('small ordinary indexable DOM collections keep real candidate names and counts', () => {
  const report = run([
    { tagName: 'H1', classList: ['headline'], textContent: secret },
    { tagName: 'SPAN', classList: ['price-main'], textContent: secret },
  ])
  assert.equal(report.selectors.find(row => row.selector === 'h1').count, 1)
  assert.equal(report.actualClassCandidates.some(row => row.selector === 'span.price-main'), true)
})
