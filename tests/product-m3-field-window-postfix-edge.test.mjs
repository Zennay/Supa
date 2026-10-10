import assert from 'node:assert/strict'
import test from 'node:test'
import { assessFieldWindow } from '../scripts/m3-field-window-preflight.mjs'

// Fixture timestamps are synthetic; no retailer observations or savings proof.
const NOW = Date.parse('2026-10-10T23:00:00Z')
const BASELINE = '2026-10-10T10:00:00Z'
const CANDIDATE = '2026-10-10T11:00:00Z'
const VALID = { baselineAt: BASELINE, candidateAt: CANDIDATE, nowMs: NOW }

function failClosed(input) {
  let result
  assert.doesNotThrow(() => { result = assessFieldWindow(input) })
  assert.equal(result.status, 'invalid')
  assert.equal('elapsedMinutes' in result, false)
  assert.equal('remainingMinutes' in result, false)
  assert.equal('claimable' in result, false)
  assert.doesNotMatch(JSON.stringify(result), /2026|10:00:00|11:00:00|savings|\\u20ac/)
}

test('nonenumerable but own valid immutable clock fields remain readable', () => {
  const value = {}
  for (const [key, data] of Object.entries(VALID)) {
    Object.defineProperty(value, key, { value: data, writable: false, configurable: false })
  }
  Object.freeze(value)
  assert.deepEqual(assessFieldWindow(value), { status: 'within-window', elapsedMinutes: 60 })
})

test('own candidate accessors are not evaluated even when baseline is legitimate', () => {
  let called = false
  const value = { baselineAt: BASELINE, nowMs: NOW }
  Object.defineProperty(value, 'candidateAt', {
    get() { called = true; return CANDIDATE },
  })
  failClosed(value)
  assert.equal(called, false)
})

test('own nowMs accessors cannot substitute a fake clock', () => {
  let called = false
  const value = { baselineAt: BASELINE, candidateAt: CANDIDATE }
  Object.defineProperty(value, 'nowMs', {
    get() { called = true; return NOW },
  })
  failClosed(value)
  assert.equal(called, false)
})

test('setter-only fields never become accepted timestamp evidence', () => {
  const value = { candidateAt: CANDIDATE, nowMs: NOW }
  Object.defineProperty(value, 'baselineAt', { set(_) {} })
  failClosed(value)
})

test('inherited time cannot silently replace an explicitly absent own baseline', () => {
  const base = { baselineAt: BASELINE }
  const value = Object.assign(Object.create(base), { candidateAt: CANDIDATE, nowMs: NOW })
  failClosed(value)
})

test('a throwing getPrototypeOf proxy fails closed without leaking exception', () => {
  failClosed(new Proxy(VALID, { getPrototypeOf() { throw Error('secret root') } }))
})

test('a throwing ownKeys proxy fails closed without leaking exception', () => {
  failClosed(new Proxy(VALID, { ownKeys() { throw Error('secret keys') } }))
})

test('the input record and nested properties are never mutated', () => {
  const value = Object.freeze({ ...VALID })
  const snapshot = JSON.stringify(value)
  assert.equal(assessFieldWindow(value).status, 'within-window')
  assert.equal(JSON.stringify(value), snapshot)
})

test('valid missing candidate continues to be only PENDING', () => {
  const result = assessFieldWindow(Object.freeze({ baselineAt: BASELINE, nowMs: NOW }))
  assert.equal(result.status, 'pending')
  assert.equal('claimable' in result, false)
})

test('invalid absolute future-dated candidate remains invalid after root repair', () => {
  failClosed({ ...VALID, candidateAt: '2026-10-12T11:00:00Z' })
})

test('exactly-24h absolute offset boundary is WINDOW ONLY, not claimable', () => {
  const result = assessFieldWindow({
    baselineAt: '2026-10-08T12:00:00-05:00',
    candidateAt: '2026-10-09T17:00:00Z',
    nowMs: NOW,
  })
  assert.deepEqual(result, { status: 'within-window', elapsedMinutes: 1440 })
  assert.equal('claimable' in result, false)
})
