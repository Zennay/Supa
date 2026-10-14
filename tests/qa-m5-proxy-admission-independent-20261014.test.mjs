import assert from 'node:assert/strict'
import test from 'node:test'
import { createHash } from 'node:crypto'
import { inspectHtml } from '../scripts/m1-inspect-captures.mjs'
import { captureShape, compareInspections } from '../scripts/m5-compare-capture-signatures.mjs'
import { buildOfflineSelectorReviewQueue } from '../scripts/m5-build-selector-review-queue.mjs'

// Independent quality-validation 2/2. All HTML, hashes and captures fictional,
// constructed only in memory. No retailer HTTP, price, user record or filesystem.
const HTML = '<script type="application/ld+json">{"@type":"Product","offers":{}}</script>'
const SECRET = 'PRIVATE-QA-PROXY-TRAP-NO-OUTPUT'
const digest = text => createHash('sha256').update(text).digest('hex')
const cohort = sources => ({ sourceCount: sources.length, sources })
function product(id = 'fictional-src') {
  return {
    id, supermarket: 'fictional', kind: 'product', success: true,
    integrity: 'verified', manifestSha256: digest(HTML),
    html: inspectHtml(HTML),
    schemaOrgProduct: {
      type: 'observation',
      observation: { privatePrice: SECRET },
    },
  }
}
function failed() {
  return { id: 'unavailable-src', supermarket: 'fictional', kind: 'product', success: false }
}
function transparentTrap(target) {
  let calls = 0
  const touch = () => { calls += 1; throw new Error(SECRET) }
  // A Proxy is not a canonical M1 own-data source even when a handler could
  // provide plausible own descriptors. Prove zero traps run.
  return {
    value: new Proxy(target, {
      get: touch, has: touch, ownKeys: touch, getOwnPropertyDescriptor: touch,
      getPrototypeOf: touch, set: touch,
    }),
    calls: () => calls,
  }
}
function revoked(target) {
  const { proxy, revoke } = Proxy.revocable(target, {})
  revoke()
  return proxy
}
function rejected(run, expected, trap) {
  assert.throws(run, error =>
    error instanceof Error && error.message === expected &&
    !error.message.includes(SECRET) &&
    !error.message.includes('fictional-src'))
  if (trap) assert.equal(trap.calls(), 0, 'QA: no untrusted Proxy trap evaluated')
}
function review(result, expectedPriority) {
  const q = buildOfflineSelectorReviewQueue(result)
  assert.equal(q.actions.length, 1)
  assert.equal(q.actions[0].priority, expectedPriority)
  assert.match(q.actions[0].sourceToken, /^[a-f0-9]{64}$/)
  for (const guard of ['rightsVerified', 'selectorVerified', 'productionReady', 'm5Eligible']) {
    assert.equal(q[guard], false)
  }
  assert.doesNotMatch(JSON.stringify(q), /PRIVATE-QA|fictional-src/)
  return q
}

test('QA positive: actual fictional M1 HTML Product becomes human P2', () => {
  review(compareInspections(cohort([product()])), 'P2')
})
test('QA positive: independently cloned M1 HTML Product is P3 but cannot release', () => {
  const s = product()
  review(compareInspections(cohort([s]), cohort([structuredClone(s)])), 'P3')
})
test('QA positive: no baseline and failed capture remains human P1', () => {
  review(compareInspections(cohort([failed()])), 'P1')
})
test('QA positive: baseline removal stays high-priority manual P1', () => {
  const q = review(compareInspections(cohort([]), cohort([product()])), 'P1')
  assert.equal(q.actions[0].status, 'removed')
})
test('QA positive: distinct empty cohorts preserve baseline supplied and rights disabled', () => {
  const c = compareInspections(cohort([]), cohort([]))
  assert.equal(c.baselineProvided, true)
  assert.equal(c.productionReady, false)
  assert.equal(c.m5Eligible, false)
})
test('QA positive: old shared source-object identity guard remains active', () => {
  const s = product()
  rejected(() => compareInspections(cohort([s]), cohort([s])),
    'Invalid or unbounded baseline inspection')
})

for (const entry of [
  ['current cohort root', () => cohort([product()]), p => compareInspections(p),
    'Invalid or unbounded current inspection'],
  ['historical cohort root', () => cohort([product()]), p =>
    compareInspections(cohort([product()]), p), 'Invalid or unbounded baseline inspection'],
  ['current cohort source-array', () => [product()], p =>
    compareInspections({ sourceCount: 1, sources: p }), 'Invalid or unbounded current inspection'],
  ['historical cohort source-array', () => [product()], p =>
    compareInspections(cohort([product()]), { sourceCount: 1, sources: p }),
    'Invalid or unbounded baseline inspection'],
  ['current Product source object', () => product(), p =>
    compareInspections(cohort([p])), 'Invalid inspected source'],
  ['historical Product source object', () => product(), p =>
    compareInspections(cohort([product()]), cohort([p])), 'Invalid inspected source'],
  ['unavailable source record', () => failed(), p =>
    compareInspections(cohort([p])), 'Invalid inspected source'],
]) {
  test('QA trap-free rejection: ' + entry[0], () => {
    const trap = transparentTrap(entry[1]())
    rejected(() => entry[2](trap.value), entry[3], trap)
  })
}
for (const entry of [
  ['successful HTML root', s => { const old=s.html; return { target:old, set:p=>{s.html=p} } }],
  ['JSON-LD container', s => {
    const old=s.html.jsonLd; return { target:old, set:p=>{s.html.jsonLd=p} }
  }],
  ['application JSON container', s => {
    const old=s.html.applicationJsonScripts
    return { target:old, set:p=>{s.html.applicationJsonScripts=p} }
  }],
  ['JSON-LD descriptor row', s => {
    const old=s.html.jsonLd[0]; return { target:old, set:p=>{s.html.jsonLd[0]=p} }
  }],
  ['JSON-LD type terms array', s => {
    const old=s.html.jsonLd[0].type
    return { target:old, set:p=>{s.html.jsonLd[0].type=p} }
  }],
  ['JSON-LD keys terms array', s => {
    const old=s.html.jsonLd[0].keys
    return { target:old, set:p=>{s.html.jsonLd[0].keys=p} }
  }],
  ['application JSON descriptor row', s => {
    s.html.applicationJsonScripts.push({id:null,bytes:0})
    const old=s.html.applicationJsonScripts[0]
    return { target:old, set:p=>{s.html.applicationJsonScripts[0]=p} }
  }],
]) {
  test('QA trap-free nested M1 shape rejection: ' + entry[0], () => {
    const s=product()
    const part=entry[1](s)
    const trap=transparentTrap(part.target)
    part.set(trap.value)
    rejected(() => captureShape(s), 'Invalid or unbounded inspected HTML shape', trap)
  })
}
for(const entry of [
  ['schema decision envelope', s => {
    const old=s.schemaOrgProduct
    return {target:old,set:p=>{s.schemaOrgProduct=p}}
  }],
  ['schema observation payload', s => {
    const old=s.schemaOrgProduct.observation
    return {target:old,set:p=>{s.schemaOrgProduct.observation=p}}
  }],
]) {
  test('QA trap-free nested Schema.org rejection: '+entry[0], () => {
    const s=product()
    const part=entry[1](s)
    const trap=transparentTrap(part.target)
    part.set(trap.value)
    rejected(() => captureShape(s), 'Invalid inspected Schema.org parse result', trap)
  })
}
for(const entry of [
  ['revoked current root', () => compareInspections(revoked(cohort([product()]))),
    'Invalid or unbounded current inspection'],
  ['revoked previous root', () => compareInspections(cohort([product()]), revoked(cohort([product()]))),
    'Invalid or unbounded baseline inspection'],
  ['revoked current sources array', () => compareInspections({
    sourceCount:1,sources:revoked([product()]),
  }), 'Invalid or unbounded current inspection'],
  ['revoked previous sources array', () => compareInspections(cohort([product()]), {
    sourceCount:1,sources:revoked([product()]),
  }), 'Invalid or unbounded baseline inspection'],
  ['revoked source inside valid current array', () => captureShape(revoked(product())),
    'Invalid inspected source'],
  ['revoked HTML', () => {const s=product();s.html=revoked(s.html);return captureShape(s)},
    'Invalid or unbounded inspected HTML shape'],
  ['revoked JSON-LD terms', () => {
    const s=product();s.html.jsonLd[0].type=revoked(s.html.jsonLd[0].type)
    return captureShape(s)
  }, 'Invalid or unbounded inspected HTML shape'],
  ['revoked Schema.org observation', () => {
    const s=product();s.schemaOrgProduct.observation=revoked(s.schemaOrgProduct.observation)
    return captureShape(s)
  }, 'Invalid inspected Schema.org parse result'],
]) {
  test('QA revoked Proxy has exact privacy-safe error: '+entry[0], () => {
    rejected(entry[1], entry[2])
  })
}
