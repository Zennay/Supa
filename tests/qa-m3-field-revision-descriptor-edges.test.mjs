import assert from 'node:assert/strict'
import test from 'node:test'
import {
  requireM3FieldRunCommitSha,
  m3FieldRunRevisionForReport,
} from '../src/domain/m3FieldRunRevision.ts'

// New test-only acceptance on issue #1143. Revision values are fictional.
const PIN = '0f'.repeat(20)
const SAFE_ERROR = /^Error: M3 field-run code revision missing or invalid$/

function failsClosed(study) {
  for (const check of [requireM3FieldRunCommitSha, m3FieldRunRevisionForReport]) {
    assert.throws(() => check(study), SAFE_ERROR)
  }
}

test('non-enumerable immutable OWN field is still a valid explicit field-run pin', () => {
  const record = { participantKey: 'fictional-private-marker' }
  Object.defineProperty(record, 'fieldRunCommitSha', {
    value: PIN, enumerable: false, writable: false, configurable: false,
  })
  Object.freeze(record)
  assert.equal(requireM3FieldRunCommitSha(record), PIN)
  assert.deepEqual(m3FieldRunRevisionForReport(record), { fieldRunCommitSha: PIN })
})

test('frozen null-prototype record with an OWN data field is accepted', () => {
  const record = Object.freeze(Object.assign(Object.create(null), {
    fieldRunCommitSha: PIN,
    observedBasket: { secret: 'fictional-private-marker' },
  }))
  const summary = m3FieldRunRevisionForReport(record)
  assert.deepEqual(summary, { fieldRunCommitSha: PIN })
  assert.equal(Object.getPrototypeOf(record), null)
})

test('inherited accessor pin is not run or accepted', () => {
  let calls = 0
  const prototype = Object.create(null)
  Object.defineProperty(prototype, 'fieldRunCommitSha', {
    get() { calls++; throw new Error('fictional-private-marker') },
  })
  const study = Object.create(prototype)
  failsClosed(study)
  assert.equal(calls, 0)
})

test('own setter-only accessor is never executed or accepted', () => {
  let calls = 0
  const record = {}
  Object.defineProperty(record, 'fieldRunCommitSha', {
    set(_value) { calls++ },
    configurable: false,
  })
  failsClosed(record)
  assert.equal(calls, 0)
})

test('a Proxy property read trap is never invoked for an existing data pin', () => {
  let reads = 0
  const record = new Proxy({ fieldRunCommitSha: PIN }, {
    get() {
      reads++
      throw new Error('fictional-private-marker')
    },
  })
  assert.equal(requireM3FieldRunCommitSha(record), PIN)
  assert.deepEqual(m3FieldRunRevisionForReport(record), { fieldRunCommitSha: PIN })
  assert.equal(reads, 0)
})

test('a Proxy descriptor trap failure becomes one generic error', () => {
  const record = new Proxy({ fieldRunCommitSha: PIN }, {
    getOwnPropertyDescriptor() {
      throw new Error('fictional-private-marker')
    },
  })
  failsClosed(record)
})

test('a revoked Proxy cannot expose a revision or private error text', () => {
  const { proxy, revoke } = Proxy.revocable({ fieldRunCommitSha: PIN }, {})
  revoke()
  failsClosed(proxy)
})

test('coercible descriptor VALUE objects never execute toString or valueOf', () => {
  let coerces = 0
  const sneaky = {
    toString() { coerces++; throw new Error('fictional-private-marker') },
    valueOf() { coerces++; throw new Error('fictional-private-marker') },
  }
  failsClosed({ fieldRunCommitSha: sneaky })
  assert.equal(coerces, 0)
})
