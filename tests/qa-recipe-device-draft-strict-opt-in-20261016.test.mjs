/**
 * Independent SUPA QA on frozen product-owned recipe integration #3285
 * c94ca4dde4bbb8dabcac870d9538c31dc29ef239.
 * Opt-in local browser device storage requires the literal boolean true,
 * never coercion of URL/form/storage-originated truthy values.
 * All drafts/records are fictional, in-memory only, no browser or network.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { emptyUserRecipeDraft, updateEditorIngredient } from
  '../src/features/user-recipes/userRecipeDraftEditor.ts'
import { saveLocalRecipeReviewDraft } from
  '../src/features/user-recipes/recipeDraftFlow.ts'

const ID = '3399ee88-1122-4acc-8abb-334455667788'
function storage() {
  const records = new Map()
  const counts = { reads: 0, writes: 0, deletes: 0 }
  return {
    records, counts,
    getItem(key) { counts.reads++; return records.get(key) ?? null },
    setItem(key, value) { counts.writes++; records.set(key, value) },
    removeItem(key) { counts.deletes++; records.delete(key) },
  }
}
function draft() {
  const source = emptyUserRecipeDraft()
  return updateEditorIngredient(
    { ...source, title: 'Fictief lokaal recept', servings: 2 },
    0, { label: 'Fictieve rijst', amount: 250, unit: 'g' },
  )
}
test('explicit literal true consents to first local draft save, no cloud approval', () => {
  const memory = storage()
  const item = draft()
  const outcome = saveLocalRecipeReviewDraft(memory, ID, item, null, true)
  assert.equal(outcome.status, 'saved')
  assert.equal(memory.counts.writes, 1)
  assert.equal(memory.records.size, 1)
  assert.equal(outcome.record.draft.status, 'needs_review')
  assert.equal('estimatedCost' in outcome.record.draft, false)
})

test('explicit boolean false prevents any storage adapter read or write', () => {
  const memory = storage()
  const outcome = saveLocalRecipeReviewDraft(memory, ID, draft(), null, false)
  assert.deepEqual(outcome, { status: 'consent_required' })
  assert.equal(memory.counts.reads, 0)
  assert.equal(memory.counts.writes, 0)
})

for (const [label, nonConsent] of [
  ['string from a URL/form saying false', 'false'],
  ['numeric form setting 1', 1],
  ['object representing consent setting', { enabled: false }],
  ['boxed boolean false', new Boolean(false)],
]) {
  test('local recipe storage refuses non-boolean alleged consent: ' + label + ' [EXPECTED RED]', () => {
    const memory = storage()
    const outcome = saveLocalRecipeReviewDraft(memory, ID, draft(), null, nonConsent)
    assert.deepEqual(outcome, { status: 'consent_required' },
      'only explicit primitive true can authorize unencrypted device writes')
    assert.equal(memory.counts.reads, 0)
    assert.equal(memory.counts.writes, 0)
    assert.equal(memory.records.size, 0)
  })
}
