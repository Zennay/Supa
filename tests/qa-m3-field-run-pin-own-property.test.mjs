import assert from 'node:assert/strict'
import test from 'node:test'

import {
  requireM3FieldRunCommitSha,
  m3FieldRunRevisionForReport,
} from '../src/domain/m3FieldRunRevision.ts'

const pinned = 'a9'.repeat(20)
const safeError = /^Error: M3 field-run code revision missing or invalid$/

test('QA M3 revision: only a supplied OWN data field is accepted, not an inherited pin', () => {
  const inherited = Object.create({ fieldRunCommitSha: pinned })
  const own = Object.create(null)
  own.fieldRunCommitSha = pinned
  assert.equal(Object.hasOwn(inherited, 'fieldRunCommitSha'), false)

  assert.throws(() => requireM3FieldRunCommitSha(inherited), safeError)
  assert.throws(() => m3FieldRunRevisionForReport(inherited), safeError)

  assert.equal(requireM3FieldRunCommitSha(own), pinned)
  assert.deepEqual(m3FieldRunRevisionForReport(own), { fieldRunCommitSha: pinned })
  assert.equal(Object.getPrototypeOf(own), null)
})

test('QA M3 revision: accessor-backed values cannot impersonate an explicit evidence pin', () => {
  let accessed = 0
  const spoofed = Object.create(null)
  Object.defineProperty(spoofed, 'fieldRunCommitSha', {
    enumerable: true,
    get() {
      accessed += 1
      return pinned
    },
  })
  assert.throws(() => requireM3FieldRunCommitSha(spoofed), safeError)
  assert.throws(() => m3FieldRunRevisionForReport(spoofed), safeError)
  assert.equal(accessed, 0, 'the provenance parser must not execute an accessor')
})

test('QA M3 revision: unexpected getter errors must not leak private details into diagnostics', () => {
  const tainted = Object.create(null)
  Object.defineProperty(tainted, 'fieldRunCommitSha', {
    get() { throw new Error('synthetic-private-participant-and-cart-token') },
  })
  for (const fn of [requireM3FieldRunCommitSha, m3FieldRunRevisionForReport]) {
    assert.throws(() => fn(tainted), safeError)
  }
})

test('QA M3 revision: normal immutable own field keeps a privacy-safe one-key report', () => {
  const study = Object.freeze({
    fieldRunCommitSha: pinned,
    participantKey: 'synthetic-sensitive-participant',
    sourceUrl: 'https://example.invalid/cart?token=synthetic',
    baseline: Object.freeze({ observedPriceCents: 1234 }),
  })
  const report = m3FieldRunRevisionForReport(study)
  assert.deepEqual(report, { fieldRunCommitSha: pinned })
  assert.deepEqual(Object.keys(report), ['fieldRunCommitSha'])
  assert.doesNotMatch(JSON.stringify(report), /participant|token|baseline|observedPrice/)
  assert.equal(requireM3FieldRunCommitSha(study), pinned)
})
