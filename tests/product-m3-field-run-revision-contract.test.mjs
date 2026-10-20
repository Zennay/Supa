import test from 'node:test'
import assert from 'node:assert/strict'
import {
  M3_FIELD_RUN_REVISION_KEY,
  parseM3FieldRunCommitSha,
  requireM3FieldRunCommitSha,
  m3FieldRunRevisionForReport,
} from '../src/domain/m3FieldRunRevision.ts'

const pinnedCommit = 'a3'.repeat(20)

test('accepts a supplied 40-character lowercase hex revision without mutation', () => {
  const study = Object.freeze({
    [M3_FIELD_RUN_REVISION_KEY]: pinnedCommit,
    participantKey: 'synthetic-private-participant',
    evidenceId: 'synthetic-private-evidence',
  })
  assert.equal(parseM3FieldRunCommitSha(pinnedCommit), pinnedCommit)
  assert.equal(requireM3FieldRunCommitSha(study), pinnedCommit)
  assert.deepEqual(m3FieldRunRevisionForReport(study), {
    fieldRunCommitSha: pinnedCommit,
  })
  assert.equal(study.fieldRunCommitSha, pinnedCommit)
  assert.deepEqual(Object.keys(m3FieldRunRevisionForReport(study)), [
    'fieldRunCommitSha',
  ])
})

test('rejects missing or malformed revision pins before conversion or reporting', () => {
  for (const bad of [
    null, undefined, '', 123, false, [],
    {}, { fieldRunCommitSha: null },
    { fieldRunCommitSha: undefined },
    { fieldRunCommitSha: pinnedCommit.toUpperCase() },
    { fieldRunCommitSha: pinnedCommit.toUpperCase().toLowerCase().slice(0, 39) },
    { fieldRunCommitSha: pinnedCommit + '0' },
    { fieldRunCommitSha: ' ' + pinnedCommit },
    { fieldRunCommitSha: pinnedCommit + ' ' },
    { fieldRunCommitSha: 'g'.repeat(40) },
    { fieldRunCommitSha: ['a'.repeat(40)] },
    { fieldRunCommitSha: { sha: pinnedCommit } },
    [{ fieldRunCommitSha: pinnedCommit }],
    { workflowRunId: 12345 },
    { commitSha: pinnedCommit },
  ]) {
    assert.throws(
      () => requireM3FieldRunCommitSha(bad),
      /^Error: M3 field-run code revision missing or invalid$/,
    )
    assert.throws(
      () => m3FieldRunRevisionForReport(bad),
      /^Error: M3 field-run code revision missing or invalid$/,
    )
  }
})

test('accepts all lowercase hex digits, rejects precision/coercion tricks', () => {
  assert.equal(parseM3FieldRunCommitSha('0123456789abcdef'.repeat(2) + '01234567'), '0123456789abcdef'.repeat(2) + '01234567')
  for (const value of [
    'Z'.repeat(40), 'f'.repeat(39), 'f'.repeat(41),
    new String(pinnedCommit), 0, Number.NaN, 1n, false,
    { toString: () => pinnedCommit }, '0x' + pinnedCommit,
  ]) {
    assert.equal(parseM3FieldRunCommitSha(value), null)
  }
})

test('report summary is minimal and never copies sensitive study fields', () => {
  const sensitive = {
    fieldRunCommitSha: pinnedCommit,
    participantKey: 'synthetic-identifier-not-for-reports',
    sourceUrl: 'https://example.invalid/private-cart?token=synthetic',
    observedPriceCents: 123456,
    baseline: { notes: 'synthetic-hidden-source-note' },
  }
  const before = structuredClone(sensitive)
  const report = m3FieldRunRevisionForReport(sensitive)
  assert.deepEqual(report, { fieldRunCommitSha: pinnedCommit })
  assert.doesNotMatch(JSON.stringify(report), /private|token|observedPrice|baseline/)
  assert.deepEqual(sensitive, before)
})

test('missing evidence never silently resolves to the current checkout or environment', () => {
  assert.throws(() => requireM3FieldRunCommitSha({}), /revision missing or invalid/)
  assert.throws(
    () => requireM3FieldRunCommitSha({ fieldRunCommitSha: 'main' }),
    /revision missing or invalid/,
  )
})
