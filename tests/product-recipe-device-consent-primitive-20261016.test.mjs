/**
 * Independent product-owned checks for explicit local-storage consent #3294.
 * Fictional in-memory records only; no browser disk/network/account.
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { emptyUserRecipeDraft, updateEditorIngredient } from
  '../src/features/user-recipes/userRecipeDraftEditor.ts'
import { saveLocalRecipeReviewDraft } from
  '../src/features/user-recipes/recipeDraftFlow.ts'

const id = '3399ee88-1122-4acc-8abb-334455667788'
function storage() {
  const records = new Map()
  const counters = { reads: 0, writes: 0, deletes: 0 }
  return {
    records, counters,
    getItem(key) { counters.reads++; return records.get(key) ?? null },
    setItem(key, value) { counters.writes++; records.set(key, value) },
    removeItem(key) { counters.deletes++; records.delete(key) },
  }
}
function draft() {
  const raw = emptyUserRecipeDraft()
  return updateEditorIngredient(
    { ...raw, title: 'Fictieve maaltijd', servings: 2 },
    0, { label: 'Fictieve rijst', amount: 250, unit: 'g' },
  )
}

for (const [name, untrusted] of [
  ['primitive false', false],
  ['string false', 'false'],
  ['string true', 'true'],
  ['numeric 1', 1],
  ['numeric 0', 0],
  ['truthy object', { enabled: true }],
  ['false object', { enabled: false }],
  ['boxed true', new Boolean(true)],
  ['boxed false', new Boolean(false)],
  ['empty object', {}],
  ['empty array', []],
  ['null', null],
  ['undefined', undefined],
]) {
  test('device draft refuses unverified storage consent: ' + name, () => {
    const local = storage()
    // Deliberately simulate runtime JS values bypassing TS annotations.
    const outcome = saveLocalRecipeReviewDraft(local, id, draft(), null, untrusted)
    assert.deepEqual(outcome, { status: 'consent_required' })
    assert.deepEqual(local.counters, { reads: 0, writes: 0, deletes: 0 })
    assert.equal(local.records.size, 0)
  })
}

test('the only valid consent is primitive true and draft stays review-only', () => {
  const local = storage()
  const saved = saveLocalRecipeReviewDraft(local, id, draft(), null, true)
  assert.equal(saved.status, 'saved')
  assert.ok(local.counters.reads >= 1)
  assert.equal(local.counters.writes, 1)
  assert.equal(local.records.size, 1)
  assert.equal(saved.record.draft.status, 'needs_review')
  assert.equal(saved.record.draft.sourceUrl, null)
  assert.equal('estimatedCost' in saved.record.draft, false)
  assert.equal('cloudSaved' in saved.record, false)
})

test('invalid id still never writes even with explicit true consent', () => {
  const local = storage()
  const result = saveLocalRecipeReviewDraft(local, '../external', draft(), null, true)
  assert.equal(result.status, 'invalid')
  assert.deepEqual(local.counters, { reads: 0, writes: 0, deletes: 0 })
})
