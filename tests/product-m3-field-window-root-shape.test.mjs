import assert from 'node:assert/strict'
import test from 'node:test'
import { assessFieldWindow } from '../scripts/m3-field-window-preflight.mjs'

// Strictly synthetic clock fixtures. This clock NEVER proves retailer evidence.
const NOW = Date.parse('2026-10-10T23:00:00Z')
const BASELINE = '2026-10-09T23:00:00Z'
const CANDIDATE = '2026-10-10T22:00:00Z'
const VALID = { baselineAt: BASELINE, candidateAt: CANDIDATE, nowMs: NOW }

function assertInvalidSafely(input, label) {
  let result
  assert.doesNotThrow(() => { result = assessFieldWindow(input) }, label)
  assert.equal(result?.status, 'invalid', label)
  assert.equal('claimable' in result, false, label)
  assert.equal('remainingMinutes' in result, false, label)
  assert.equal('elapsedMinutes' in result, false, label)
  assert.match(result.reason, /^[a-z -]{5,100}$/, label)
}

test('exported field-window API rejects undefined root without a TypeError', () => {
  assertInvalidSafely(undefined, 'undefined root')
})

test('exported field-window API rejects null root without a TypeError', () => {
  assertInvalidSafely(null, 'null root')
})

test('exported field-window API rejects primitive root containers', () => {
  for (const input of [42, true, 'not a record', NaN, 0]) {
    assertInvalidSafely(input, String(input))
  }
})

test('exported field-window API rejects array roots even if decorated with valid timestamps', () => {
  const disguised = []
  Object.assign(disguised, VALID)
  assertInvalidSafely(disguised, 'decorated array')
})

test('exported field-window API rejects inherited timestamp values', () => {
  const disguised = Object.create(VALID)
  assertInvalidSafely(disguised, 'inherited timestamp root')
})

test('exported field-window API cannot trust own accessor timestamp properties', () => {
  let called = false
  const disguised = { candidateAt: CANDIDATE, nowMs: NOW }
  Object.defineProperty(disguised, 'baselineAt', {
    enumerable: true,
    get() { called = true; return BASELINE },
  })
  assertInvalidSafely(disguised, 'accessor timestamps')
  assert.equal(called, false, 'accessor must not be evaluated')
})

test('exported field-window API fails closed for throwing timestamp getter', () => {
  const disguised = { candidateAt: CANDIDATE, nowMs: NOW }
  Object.defineProperty(disguised, 'baselineAt', {
    get() { throw new Error('private captured value must not be echoed') },
  })
  assertInvalidSafely(disguised, 'throwing timestamp getter')
})

test('exported field-window API fails closed on revoked proxy input', () => {
  const { proxy, revoke } = Proxy.revocable(VALID, {})
  revoke()
  assertInvalidSafely(proxy, 'revoked proxy')
})

test('ordinary synthetic nonempty timestamp record stays WINDOW ONLY', () => {
  const result = assessFieldWindow(VALID)
  assert.deepEqual(result, { status: 'within-window', elapsedMinutes: 1380 })
  assert.equal('claimable' in result, false)
})

test('frozen own-data and null-prototype records remain accepted', () => {
  assert.equal(assessFieldWindow(Object.freeze({ ...VALID })).status, 'within-window')
  const nullProto = Object.assign(Object.create(null), VALID)
  assert.equal(assessFieldWindow(nullProto).status, 'within-window')
})

test('valid missing candidate is only PENDING, never proof', () => {
  const result = assessFieldWindow({ baselineAt: BASELINE, nowMs: NOW })
  assert.equal(result.status, 'pending')
  assert.equal('claimable' in result, false)
})
