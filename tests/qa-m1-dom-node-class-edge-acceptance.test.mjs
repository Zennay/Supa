import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import vm from 'node:vm'
import test from 'node:test'
import { reviewDomProbe } from '../scripts/m1-dom-candidate-review.mjs'

const snippet = readFileSync(resolve('scripts/m1-dom-candidate-probe.js'), 'utf8')
const union = 'h1, [itemprop="price"], [data-testid*="price" i], [class*="price" i], a[href*="/product"]'
const secret = 'SECRET-NON-EVIDENCE-PRICE-8888'

function inspect(collection) {
  const logs = []
  const doc = { querySelectorAll(selector) {
    if (selector === union) return collection
    if (selector === 'h1') return { length: 1 }
    return { length: 0 }
  } }
  const context = { document: doc, location: { protocol: 'https:', hostname: 'www.dirk.nl' },
    Date, console: { log: (...message) => logs.push(message) } }
  context.globalThis = context
  const report = JSON.parse(JSON.stringify(vm.runInNewContext(snippet, context)))
  const reviewed = reviewDomProbe(report, { sourceId: 'dirk-boodschappen', nowMs: Date.parse(report.capturedAt) })
  assert.equal(reviewed.status, 'human-semantic-review-required')
  assert.equal(reviewed.livePriceVerified, false)
  assert.equal(reviewed.domCaptureIdentityVerified, false)
  assert.equal(reviewed.publicSavingsClaimEligible, false)
  assert.doesNotMatch(JSON.stringify(report) + JSON.stringify(logs), /SECRET-NON-EVIDENCE|8888/)
  assert.equal(report.actualClassCandidates.every(row => row.semanticVerified === false), true)
  return report
}

test('501st DOM node remains untouched at inclusive 500-node sampling boundary', () => {
  let indexes = 0
  let iterations = 0
  const nodes = new Proxy({
    length: 501,
    [Symbol.iterator]() { iterations++; throw new Error('full DOM traversal forbidden') },
  }, {
    get(target, property) {
      if (typeof property === 'string' && /^(0|[1-9][0-9]*)$/.test(property)) {
        const index = Number(property)
        if (index >= 500) throw new Error('501st DOM node accessed')
        indexes++
        return { tagName: 'SPAN', classList: ['price-main'], textContent: secret }
      }
      return Reflect.get(target, property)
    },
  })
  const report = inspect(nodes)
  assert.equal(indexes, 500)
  assert.equal(iterations, 0)
  assert.equal(report.actualClassCandidates.find(row => row.selector === 'span.price-main')?.observedNodes, 500)
})

test('6th DOM class token remains untouched at inclusive 5-class sampling boundary', () => {
  let accessed = 0
  let iterations = 0
  const classes = new Proxy({
    length: 6,
    [Symbol.iterator]() { iterations++; throw new Error('full class traversal forbidden') },
  }, {
    get(target, property) {
      if (typeof property === 'string' && /^(0|[1-9][0-9]*)$/.test(property)) {
        const index = Number(property)
        if (index >= 5) throw new Error('6th DOM class accessed')
        accessed++
        return 'candidate-' + index
      }
      return Reflect.get(target, property)
    },
  })
  const report = inspect([{ tagName: 'SPAN', classList: classes, textContent: secret }])
  assert.equal(accessed, 5)
  assert.equal(iterations, 0)
  assert.deepEqual(report.actualClassCandidates.map(row => row.selector).sort(),
    ['span.candidate-0', 'span.candidate-1', 'span.candidate-2', 'span.candidate-3', 'span.candidate-4'])
})

test('over 25 different observed classes yield deterministic bounded review-only candidates', () => {
  const elements = Array.from({ length: 40 }, (_, index) => ({
    tagName: 'SPAN', classList: ['candidate-' + String(index).padStart(2, '0')], textContent: secret,
  }))
  const report = inspect(elements)
  assert.equal(report.actualClassCandidates.length, 25)
  assert.deepEqual(report.actualClassCandidates.map(row => row.selector),
    Array.from({ length: 25 }, (_, i) => 'span.candidate-' + String(i).padStart(2, '0')))
  assert.equal(report.actualClassCandidates.every(row => row.observedNodes === 1), true)
})
