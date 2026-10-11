import assert from 'node:assert/strict'
import test from 'node:test'
import { reviewDomProbe } from '../scripts/m1-dom-candidate-review.mjs'
import { RESEARCH_SOURCES } from '../scripts/m1-multistore-research.mjs'

const source = RESEARCH_SOURCES.find(item => item.id === 'dirk-halvarine')
const nowMs = Date.parse('2026-10-11T00:00:00.000Z')
const selector = () => ({ role: 'product-name', selector: 'h1', count: 1,
  groundedInCurrentDom: true, semanticVerified: false })
const classCandidate = () => ({ selector: 'span.price-main', observedNodes: 1,
  semanticVerified: false })

function probe(overrides = {}) {
  return {
    version: 1, kind: 'rendered-dom-candidate-only',
    originHost: new URL(source.url).hostname,
    capturedAt: new Date(nowMs - 60_000).toISOString(),
    selectors: [selector()],
    actualClassCandidates: [classCandidate()],
    ...overrides,
  }
}
function rejected(candidate) {
  assert.throws(() => reviewDomProbe(candidate, { sourceId: source.id, nowMs }),
    /^Error: private DOM candidate report rejected$/)
}

test('ordinary dense arrays still produce only unverified candidates', () => {
  for (const candidate of [probe(), probe({ selectors: [], actualClassCandidates: [] })]) {
    const result = reviewDomProbe(candidate, { sourceId: source.id, nowMs })
    assert.equal(result.semanticVerified, false)
    assert.equal(result.retailerPermissionVerified, false)
    assert.equal(result.livePriceVerified, false)
    assert.equal(result.domCaptureIdentityVerified, false)
    assert.equal(result.publicSavingsClaimEligible, false)
  }
})

test('numeric accessor slots never execute in either candidate array', () => {
  for (const key of ['selectors', 'actualClassCandidates']) {
    let invoked = 0
    const candidate = probe()
    Object.defineProperty(candidate[key], '0', {
      configurable: true, enumerable: true,
      get() { invoked++; throw new Error('PRIVATE-DOM-GETTER-SHOULD-NOT-RUN') },
    })
    rejected(candidate)
    assert.equal(invoked, 0, key + ' getter must not run')
  }
})

test('custom array iterators cannot forge review rows or run side effects', () => {
  for (const key of ['selectors', 'actualClassCandidates']) {
    let invoked = 0
    const candidate = probe()
    Object.defineProperty(candidate[key], Symbol.iterator, {
      value: function* () { invoked++; yield key === 'selectors' ? selector() : classCandidate() },
      configurable: true,
    })
    rejected(candidate)
    assert.equal(invoked, 0, key + ' iterator must not run')
  }
})

test('holes and non-index own keys never pass as a canonical JSON array', () => {
  for (const key of ['selectors', 'actualClassCandidates']) {
    const withHole = probe()
    delete withHole[key][0]
    rejected(withHole)
    const extra = probe()
    extra[key].hidden = 'unreviewed metadata'
    rejected(extra)
  }
})

test('array subclasses and nonstandard array prototype cannot become approved candidate lists', () => {
  for (const key of ['selectors', 'actualClassCandidates']) {
    const candidate = probe()
    class AlteredArray extends Array {}
    candidate[key] = AlteredArray.from(candidate[key])
    rejected(candidate)
  }
})

test('revoked or throwing array proxies yield sanitized rejection, not trap exceptions', () => {
  for (const key of ['selectors', 'actualClassCandidates']) {
    const { proxy, revoke } = Proxy.revocable(probe()[key], {})
    revoke()
    rejected(probe({ [key]: proxy }))
    const hostile = new Proxy(probe()[key], {
      ownKeys() { throw new Error('PRIVATE-DOM-OWNKEYS-SHOULD-NOT-LEAK') },
    })
    rejected(probe({ [key]: hostile }))
  }
})
