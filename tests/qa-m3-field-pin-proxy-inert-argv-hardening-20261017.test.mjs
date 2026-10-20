import assert from 'node:assert/strict'
import test from 'node:test'
import { buildFictionalPricedSheet } from '../scripts/m3-rehearse-field-run.mjs'
import { buildWeeklyBasketStudyFromObservationSheet } from '../scripts/m3-build-observed-study.mjs'
import { buildObservedWeekReport } from '../scripts/m3-assess-observed-week.mjs'
import { auditPrivateM3FieldRunCodePin } from '../scripts/qa-m3-field-run-code-pin-20261017.mjs'
import { main as privateCliMain } from '../scripts/qa-m3-field-run-code-pin-cli-20261017.mjs'

const SHA = 'a'.repeat(40)
const REFUSE_PROOF = 'M3 private field-run code pin refused'
const REFUSE_CLI = 'M3 private field-run pin proof refused'

function fixture() {
  const sheet = buildFictionalPricedSheet(90)
  const study = buildWeeklyBasketStudyFromObservationSheet(sheet)
  const report = buildObservedWeekReport(study)
  sheet.study.fieldRunCommitSha = SHA
  study.fieldRunCommitSha = SHA
  report.fieldRunCommitSha = SHA
  return { sheet, study, report }
}
const audit = f => auditPrivateM3FieldRunCodePin(f.sheet, f.study, f.report, SHA)
function makePoison(value) {
  let invoked = 0
  const poison = new Proxy(value, {
    get() { invoked++; throw new Error('PRIVATE_PROXY_GET_TRAP') },
    getPrototypeOf() { invoked++; throw new Error('PRIVATE_PROXY_PROTO_TRAP') },
    ownKeys() { invoked++; throw new Error('PRIVATE_PROXY_KEYS_TRAP') },
    getOwnPropertyDescriptor() { invoked++; throw new Error('PRIVATE_PROXY_DESCRIPTOR_TRAP') },
  })
  return { poison, get calls() { return invoked } }
}
function refuses(f, label) {
  assert.throws(() => audit(f), err =>
    err instanceof Error && err.message === REFUSE_PROOF, label)
}

test('M3 pin auditor refuses root and study/summary Proxy objects without executing any traps', () => {
  let count = 0
  for (const [field, inner] of [
    ['sheet', null], ['study', null], ['report', null],
    ['sheet', 'study'], ['sheet', 'baseline'], ['sheet', 'candidate'],
    ['study', 'baseline'], ['study', 'candidate'],
    ['report', 'baseline'], ['report', 'candidate'],
  ]) {
    const f = fixture()
    const original = inner === null ? f[field] : f[field][inner]
    const p = makePoison(original)
    if (inner === null) f[field] = p.poison
    else f[field][inner] = p.poison
    refuses(f, field + '.' + inner)
    assert.equal(p.calls, 0, 'must reject proxies before any JS trap')
    count++
  }
  assert.equal(count, 10)
})

test('every 11x2 original and converted line Proxy is refused without reading getter or iterator', () => {
  let count = 0
  for (const side of ['baseline', 'candidate']) {
    for (let index = 0; index < 11; index++) {
      for (const location of ['sheet', 'study']) {
        const f = fixture()
        const lines = location === 'sheet' ? f.sheet[side].lines : f.study[side].basket.lines
        const p = makePoison(lines[index])
        lines[index] = p.poison
        refuses(f, location + '.' + side + ':' + index)
        assert.equal(p.calls, 0)
        count++
      }
      for (const inner of ['observedProduct', 'requirement']) {
        const f = fixture()
        const line = f.sheet[side].lines[index]
        const p = makePoison(line[inner])
        line[inner] = p.poison
        refuses(f, 'sheet.' + side + ':' + index + ':' + inner)
        assert.equal(p.calls, 0)
        count++
      }
    }
  }
  assert.equal(count, 88)
})

test('non-Proxy own accessor is never evaluated anywhere in nested physical source', () => {
  let count = 0
  for (const side of ['baseline', 'candidate']) for (let index = 0; index < 11; index++) {
    const f = fixture()
    let calls = 0
    Object.defineProperty(f.sheet[side].lines[index].observedProduct, 'priceCents', {
      get() { calls++; throw new Error('PRIVATE_GETTER_SHOULD_NOT_EXECUTE') },
      enumerable: true, configurable: true,
    })
    refuses(f, side + ':' + index)
    assert.equal(calls, 0)
    count++
  }
  assert.equal(count, 22)
})

test('programmatic private CLI rejects Proxy argv without reading .length/.some/indexes', async () => {
  const arguments_ = ['--sheet', '/untrusted/sheet', '--study', '/untrusted/study',
    '--assessment', '/untrusted/assessment', '--expected-main-sha', SHA]
  const p = makePoison(arguments_)
  await assert.rejects(privateCliMain(p.poison), err =>
    err instanceof Error && err.message === REFUSE_CLI)
  assert.equal(p.calls, 0)
})

test('programmatic private CLI rejects own index getter, sparse, exotic, extra and inherited argv', async () => {
  let cases = 0
  const valid = ['--sheet', '/untrusted/sheet', '--study', '/untrusted/study',
    '--assessment', '/untrusted/assessment', '--expected-main-sha', SHA]
  for (const i of [0, 1, 2, 3, 4, 5, 6, 7]) {
    const arr = [...valid]
    let reads = 0
    Object.defineProperty(arr, String(i), {
      enumerable: true, configurable: true,
      get() { reads++; throw new Error('PRIVATE_CLI_ARG_GETTER') },
    })
    await assert.rejects(privateCliMain(arr), err =>
      err instanceof Error && err.message === REFUSE_CLI)
    assert.equal(reads, 0, 'must inspect own descriptors only')
    cases++
  }
  for (const mutate of [
    a => { delete a[3] },
    a => { Object.setPrototypeOf(a, { length: 8, 0: '--sheet' }) },
    a => { a.extra = 'unexpected' },
    a => { a[Symbol.toStringTag] = 'Array' },
    a => { a.length = 9 },
  ]) {
    const arr = [...valid]
    mutate(arr)
    await assert.rejects(privateCliMain(arr), err =>
      err instanceof Error && err.message === REFUSE_CLI)
    cases++
  }
  assert.equal(cases, 13)
})
