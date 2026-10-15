import test from 'node:test'
import assert from 'node:assert/strict'
import { createPrivateM3StudyCodePin } from '../scripts/m3-field-code-pin.mjs'
import { preflightPrivateM3Week } from '../scripts/m3-verify-private-week-preflight.mjs'
import { buildObservationSheet } from '../src/domain/m3ObservationSheet.ts'

// Separate independent QA of frozen owner #2848. All data is fictional/offline.
// Conflicting duplicate JSON keys must never silently replace field evidence.
const SHA = '1234567890abcdef1234567890abcdef12345678'
const fixture = buildObservationSheet()
function lines() {
  return fixture.requirements.map((row) => ({
    id: row.id,
    ingredientLabel: row.label,
    requirement: { amount: row.amount, unit: row.unit },
    status: 'unresolved',
    reasons: ['synthetic product quantity unknown'],
    matchScore: null,
  }))
}
function side(id, name, time) {
  return {
    evidenceId: 'qa-private-' + id,
    observedAt: time,
    source: 'manual-cart',
    provenanceNote: 'synthetic only',
    basket: {
      store: { id, name },
      selectedMealCount: fixture.selectedMealCount,
      lines: lines(),
      totalCents: 0,
      matchedLineCount: 0,
      unresolvedLineCount: fixture.requirements.length,
    },
  }
}
function studyJson() {
  return JSON.stringify({
    schemaVersion: 1,
    studyId: 'qa-fictional-study',
    participantKey: 'qa-fictional-participant',
    population: 'synthetic students',
    region: 'fictional region',
    weekStart: '2026-10-12',
    priceContext: 'in-store',
    baseline: side('plus-local', 'PLUS', '2026-10-14T11:00:00Z'),
    candidate: side('deka-local', 'DekaMarkt', '2026-10-14T12:00:00Z'),
  })
}
function verifyRaw(raw) {
  const bytes = Buffer.from(raw, 'utf8')
  const sidecar = Buffer.from(JSON.stringify(createPrivateM3StudyCodePin(bytes, SHA)))
  return preflightPrivateM3Week(bytes, sidecar)
}
function conflicting(original, replacement, claim) {
  const raw = studyJson()
  assert.equal(raw.includes(original), true, 'fixture changed: ' + claim)
  const forged = raw.replace(original, replacement)
  assert.notEqual(forged, raw)
  return forged
}

test('private week preflight accepts canonical fictional study with its exact byte-bound sidecar', () => {
  const outcome = verifyRaw(studyJson())
  assert.equal(outcome.privateStudyBytesMatch, true)
  assert.equal(outcome.canonicalDemandLineCount, 11)
  assert.equal(outcome.publicSavingsClaimEligible, false)
  assert.equal(outcome.sourceCommitShaAuthenticated, false)
  assert.equal(outcome.retailerPermissionVerified, false)
})

test('raw study rejects contradictory duplicate baseline observedAt rather than hide a >24h gap', () => {
  const forged = conflicting(
    '"observedAt":"2026-10-14T11:00:00Z"',
    '"observedAt":"2026-10-01T11:00:00Z","observedAt":"2026-10-14T11:00:00Z"',
    'baseline observation clock',
  )
  assert.throws(() => verifyRaw(forged), /preflight refused/,
    'valid sidecar checksum does not make contradictory on-disk observation clocks unambiguous')
})

test('raw study rejects contradictory duplicate store identity even if last value is canonical', () => {
  const forged = conflicting(
    '"id":"plus-local","name":"PLUS"',
    '"id":"deka-local","id":"plus-local","name":"PLUS"',
    'baseline supermarket identity',
  )
  assert.throws(() => verifyRaw(forged), /preflight refused/,
    'a contradictory PLUS/Deka source ID must not be silently discarded by JSON.parse')
})

test('raw study rejects contradictory duplicate priceContext even when final value is allowed', () => {
  const forged = conflicting(
    '"priceContext":"in-store"',
    '"priceContext":"unverified-mixed-market","priceContext":"in-store"',
    'same-context evidence',
  )
  assert.throws(() => verifyRaw(forged), /preflight refused/,
    'ambiguous price context must not be blessed by a matching byte digest')
})
