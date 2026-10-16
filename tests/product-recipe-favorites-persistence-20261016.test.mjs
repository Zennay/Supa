import test from 'node:test'
import assert from 'node:assert/strict'
import {
  RECIPE_FAVORITES_KEY, readRecipeFavorites, toggleRecipeFavorite, removeRecipeFavorite,
} from '../src/features/recipes/recipeFavorites.ts'

function storage(initial = null) {
  let raw = initial
  return {
    getItem: key => key === RECIPE_FAVORITES_KEY ? raw : null,
    setItem: (key, next) => { if (key !== RECIPE_FAVORITES_KEY) throw new Error('wrong key'); raw = next },
  }
}

test('Figma favorites survive browser reload and can be toggled off', () => {
  const local = storage()
  const a = toggleRecipeFavorite(local, 'supa-thai')
  assert.deepEqual(a.ids, ['supa-thai'])
  const b = toggleRecipeFavorite(local, 'own-4e64e650-ccf5-47ba-880c-118006b31509')
  assert.deepEqual(readRecipeFavorites(local).ids, ['supa-thai', 'own-4e64e650-ccf5-47ba-880c-118006b31509'])
  assert.deepEqual(toggleRecipeFavorite(local, 'supa-thai').ids, ['own-4e64e650-ccf5-47ba-880c-118006b31509'])
  assert.equal(JSON.parse(local.getItem(RECIPE_FAVORITES_KEY)).version, 1)
})

test('deleting a private recipe removes only its matching favorite', () => {
  const local = storage()
  toggleRecipeFavorite(local, 'supa-thai')
  toggleRecipeFavorite(local, 'own-123')
  assert.deepEqual(removeRecipeFavorite(local, 'own-123').ids, ['supa-thai'])
  assert.deepEqual(removeRecipeFavorite(local, 'own-123').ids, ['supa-thai'])
})

test('corrupted/future versions are protected from overwrite', () => {
  for (const raw of ['{', '{"version":2,"ids":["supa-thai"]}', '{"version":1,"ids":["supa-thai","supa-thai"]}', '{"version":1,"ids":[null]}']) {
    const local = storage(raw)
    assert.ok(readRecipeFavorites(local).error)
    assert.throws(() => toggleRecipeFavorite(local, 'supa-thai'), /Favorieten/)
    assert.equal(local.getItem(RECIPE_FAVORITES_KEY), raw)
  }
})

test('bad injected IDs and unsafe objects never become favorites', () => {
  const local = storage()
  for (const id of ['https://example.org/', 'other', 'own-<svg>', 'supa-', 'own-', 'supa-thai?token=private']) {
    assert.throws(() => toggleRecipeFavorite(local, id), /favoriet/)
  }
  assert.equal(local.getItem(RECIPE_FAVORITES_KEY), null)
})

test('read/write storage unavailability does not masquerade as a saved favorite', () => {
  const local = { getItem: () => null, setItem: () => { throw new Error('quota') } }
  assert.throws(() => toggleRecipeFavorite(local, 'supa-thai'), /quota/)
  const unreadable = { getItem: () => { throw new Error('denied') }, setItem: () => {} }
  assert.ok(readRecipeFavorites(unreadable).error)
  assert.throws(() => toggleRecipeFavorite(unreadable, 'supa-thai'), /Favorieten/)
})
