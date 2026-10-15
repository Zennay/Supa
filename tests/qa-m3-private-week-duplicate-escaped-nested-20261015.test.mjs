import test from 'node:test'
import assert from 'node:assert/strict'
import { createPrivateM3StudyCodePin } from '../scripts/m3-field-code-pin.mjs'
import { preflightPrivateM3Week } from '../scripts/m3-verify-private-week-preflight.mjs'
import { buildObservationSheet } from '../src/domain/m3ObservationSheet.ts'

// QA-only extension: JSON key spelling aliases and nested demand ambiguity.
// No real prices, retailer traffic, human participation or release claims.
const fixture = buildObservationSheet()
const SHA = '1234567890abcdef1234567890abcdef12345678'
function basket(id, name) {
  return {
    store: { id, name },
    selectedMealCount: fixture.selectedMealCount,
    lines: fixture.requirements.map(r => ({
      id: r.id,
      ingredientLabel: r.label,
      requirement: { amount: r.amount, unit: r.unit },
      status: 'unresolved',
      reasons: ['private invented evidence'],
      matchScore: null,
    })),
    totalCents: 0,
    matchedLineCount: 0,
    unresolvedLineCount: fixture.requirements.length,
  }
}
function source() {
  return JSON.stringify({
    schemaVersion: 1,
    studyId: 'qa-duplicate-json-extension',
    participantKey: 'private-fictional-participant',
    population: 'synthetic students',
    region: 'fictional region',
    weekStart: '2026-10-12',
    priceContext: 'in-store',
    baseline: {
      evidenceId: 'fictional-plus',
      observedAt: '2026-10-14T11:00:00Z',
      source: 'manual-cart',
      provenanceNote: 'synthetic',
      basket: basket('plus-local', 'PLUS'),
    },
    candidate: {
      evidenceId: 'fictional-deka',
      observedAt: '2026-10-14T12:00:00Z',
      source: 'manual-cart',
      provenanceNote: 'synthetic',
      basket: basket('deka-local', 'DekaMarkt'),
    },
  })
}
function preflight(raw) {
  const bytes = Buffer.from(raw)
  const manifest = Buffer.from(JSON.stringify(createPrivateM3StudyCodePin(bytes, SHA)))
  return preflightPrivateM3Week(bytes, manifest)
}
function altered(find, replacement) {
  const original = source()
  assert.equal(original.includes(find), true)
  const changed = original.replace(find, replacement)
  assert.notEqual(changed, original)
  return changed
}

test('M3 raw study refuses escaped-key alias for baseline observedAt', () => {
  const regular = '"observedAt":"2026-10-14T11:00:00Z"'
  const alteredJson = altered(regular,
    '"observed\\u0041t":"2026-10-01T11:00:00Z",' + regular)
  // Both spellings decode to observedAt; JSON.parse silently keeps the latter.
  assert.throws(() => preflight(alteredJson), /preflight refused/)
})

test('M3 raw study refuses hidden contradictory duplicate canonical demand quantity', () => {
  const count = fixture.requirements[0].amount
  const regular = '"amount":' + count + ',"unit":'
  const alteredJson = altered(regular, '"amount":1000000,' + regular)
  // Correct last value alone must not conceal contrary raw pack demand.
  assert.throws(() => preflight(alteredJson), /preflight refused/)
})
