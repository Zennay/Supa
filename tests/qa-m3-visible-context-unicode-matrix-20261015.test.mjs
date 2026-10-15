import test from 'node:test'
import assert from 'node:assert/strict'
import { buildObservationSheet } from '../src/domain/m3ObservationSheet.ts'
import { createPrivateM3StudyCodePin } from '../scripts/m3-field-code-pin.mjs'
import { preflightPrivateM3Week } from '../scripts/m3-verify-private-week-preflight.mjs'

// Independent QA: a private, fabricated 11 PLUS / 11 DekaMarkt basket.
// It cannot establish retailer rights, a real field observation, or savings.
const REVISION = '1234567890abcdef1234567890abcdef12345678'
const requirements = buildObservationSheet()

function observation(side) {
  return {
    evidenceId: 'synthetic-' + side,
    observedAt: side === 'baseline'
      ? '2026-10-14T11:00:00Z'
      : '2026-10-14T12:00:00Z',
    source: 'manual-cart',
    provenanceNote: 'synthetic unavailable observations; not retailer evidence',
    basket: {
      store: side === 'baseline'
        ? { id: 'plus-private', name: 'PLUS' }
        : { id: 'deka-private', name: 'DekaMarkt' },
      selectedMealCount: requirements.selectedMealCount,
      lines: requirements.requirements.map(item => ({
        id: item.id,
        ingredientLabel: item.label,
        requirement: { amount: item.amount, unit: item.unit },
        status: 'unresolved',
        reasons: ['synthetic no product match'],
        matchScore: null,
      })),
      totalCents: 0,
      matchedLineCount: 0,
      unresolvedLineCount: requirements.requirements.length,
    },
  }
}

function canonical() {
  return {
    schemaVersion: 1,
    studyId: 'qa-only-visible-source',
    participantKey: 'fictional-key',
    population: 'synthetic students',
    region: 'synthetic region',
    weekStart: '2026-10-12',
    priceContext: 'in-store',
    baseline: observation('baseline'),
    candidate: observation('candidate'),
  }
}

function verify(value) {
  const studyBytes = Buffer.from(JSON.stringify(value))
  const manifestBytes = Buffer.from(JSON.stringify(
    createPrivateM3StudyCodePin(studyBytes, REVISION),
  ))
  return preflightPrivateM3Week(studyBytes, manifestBytes, REVISION)
}

function contextTarget(value, field) {
  if (field.startsWith('baseline.')) return value.baseline
  if (field.startsWith('candidate.')) return value.candidate
  return value
}
function setContext(value, field, content) {
  contextTarget(value, field)[field.split('.').at(-1)] = content
}

// All examples contain non-whitespace code points. Merely calling trim()
// (which was the product's earlier bug) must not treat these as source proof.
const hidden = Object.freeze({
  'zero-width-space': '\u200B',
  'word-joiner': '\u2060',
  'zero-width-joiner': '\u200D',
  'bidirectional-format': '\u202E',
  'combining-only': '\u0301',
  'variation-selector': '\uFE0F',
  'braille-blank': '\u2800',
  'hangul-choseong-filler': '\u115F',
  'hangul-jungseong-filler': '\u1160',
  'hangul-compat-filler': '\u3164',
  'halfwidth-hangul-filler': '\uFFA0',
  'mixed-hidden-controls': '\u200B \u0301\t\u2060',
})
const fields = [
  'population', 'region',
  'baseline.provenanceNote', 'candidate.provenanceNote',
]

test('M3 canonical synthetic unresolved basket remains private and accepted', () => {
  const result = verify(canonical())
  assert.equal(result.status, 'private-review-only')
  assert.equal(result.privateStudyBytesMatch, true)
  assert.equal(result.sameDemandLineCount, 11)
  assert.equal(result.observationWindowWithin24Hours, true)
  for (const key of [
    'sourceCommitShaAuthenticated', 'codeRevisionVerified',
    'retailerPermissionVerified', 'publicSavingsClaimEligible',
  ]) assert.equal(result[key], false, key)
  assert.equal(Object.isFrozen(result), true)
})

for (const field of fields) {
  for (const [kind, characters] of Object.entries(hidden)) {
    test('M3 private pinned metadata rejects ' + kind + ' in ' + field, () => {
      assert.ok(characters.trim().length > 0,
        'the legacy trim-only check would have considered this supplied')
      const forged = canonical()
      setContext(forged, field, characters)
      assert.throws(
        () => verify(forged),
        (error) => error instanceof Error &&
          error.message === 'M3 private study provenance preflight refused',
      )
    })
  }
}

test('M3 private pinned metadata admits readable text despite adjacent formatting characters', () => {
  const original = canonical()
  setContext(original, 'population', '\u200BStudenten\u200D')
  setContext(original, 'region', '\u0301Leiden\u2060')
  setContext(original, 'baseline.provenanceNote', '\u2800Human review pending')
  setContext(original, 'candidate.provenanceNote', 'Review pending\uFE0F')
  const result = verify(original)
  assert.equal(result.status, 'private-review-only')
  assert.equal(result.canonicalDemandLineCount, 11)
  assert.equal(result.publicSavingsClaimEligible, false)
  assert.equal(result.retailerPermissionVerified, false)
})
