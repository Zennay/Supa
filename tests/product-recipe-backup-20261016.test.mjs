import test from 'node:test'
import assert from 'node:assert/strict'
import { createManualRecipeDraft } from '../src/domain/userRecipeImport.ts'
import { readRecipeLibrary, saveRecipeLibrary } from '../src/features/recipes/recipeLibrary.ts'
import { exportRecipeBackup, parseRecipeBackup, restoreRecipeBackup } from '../src/features/recipes/recipeBackup.ts'

function memory(initial = null) {
  let raw = initial
  return { getItem: () => raw, setItem: (_, value) => { raw = value } }
}
const stamp = '2026-10-16T19:53:00.000Z'
const own = (id, title, lines = ['0,5 kg rijst', '1 cup bloem']) => ({
  ...createManualRecipeDraft({ title, ingredients: lines, servings: 2, minutes: 25, steps: ['Kook de rijst.'] }),
  id, savedAt: stamp,
})
function backup(...recipes) {
  const storage = memory()
  const state = saveRecipeLibrary(storage, readRecipeLibrary(storage), recipes)
  return exportRecipeBackup(state)
}

test('portable export omits IDs, retailer price evidence and full storage internals', () => {
  const serialized = backup(own('own-remote-secret-id', 'Mijn curry'))
  const payload = JSON.parse(serialized)
  assert.equal(payload.format, 'supa-private-recipes-backup')
  assert.equal(payload.version, 1)
  assert.equal(payload.recipes.length, 1)
  assert.equal(Object.hasOwn(payload.recipes[0], 'id'), false)
  assert.equal(Object.hasOwn(payload.recipes[0], 'savedAt'), false)
  assert.equal(Object.hasOwn(payload.recipes[0], 'estimatedCost'), false)
  assert.equal(JSON.stringify(payload).includes('own-remote-secret-id'), false)
  assert.deepEqual(payload.recipes[0].ingredients, ['0,5 kg rijst', '1 cup bloem'])
})

test('restore merges reviewed metric recipes with fresh IDs without altering existing recipes', () => {
  const portable = backup(own('own-a', 'Mijn curry'))
  const local = memory()
  const current = saveRecipeLibrary(local, readRecipeLibrary(local), [own('own-local', 'Bestaand')])
  const result = restoreRecipeBackup(local, current, portable, () => 'own-new-import', stamp)
  assert.deepEqual(result.recipes.map(x => x.id), ['own-new-import', 'own-local'])
  assert.equal(result.recipes[0].ingredients[0].amount, 500)
  assert.equal(result.recipes[0].ingredients[0].unit, 'g')
  assert.equal(result.recipes[0].ingredients[1].amount, null)
  assert.ok(result.recipes[0].warnings.length)
  assert.deepEqual(result.recipes[1], current.recipes[0])
  assert.deepEqual(readRecipeLibrary(local).recipes, result.recipes)
})

test('unknown backup format, malformed JSON, bad sources and malicious URL remain atomic', () => {
  const initial = backup(own('own-source', 'From file'))
  const base = JSON.parse(initial)
  const cases = [
    '{', '{}', JSON.stringify({ ...base, version: 99 }),
    JSON.stringify({ ...base, recipes: [null] }),
    JSON.stringify({ ...base, recipes: [{ ...base.recipes[0], source: 'url', sourceUrl: 'file:///etc/passwd' }] }),
    JSON.stringify({ ...base, recipes: [{ ...base.recipes[0], source: 'url', sourceUrl: 'https://localhost/item' }] }),
    JSON.stringify({ ...base, recipes: [{ ...base.recipes[0], source: 'url', sourceUrl: 'https://u:p@recipes.example.org/r' }] }),
    JSON.stringify({ ...base, recipes: [{ ...base.recipes[0], ingredients: [] }] }),
    JSON.stringify({ ...base, recipes: [{ ...base.recipes[0], steps: [] }] }),
    JSON.stringify({ ...base, recipes: [base.recipes[0], null] }),
  ]
  for (const text of cases) {
    const store = memory()
    const existing = saveRecipeLibrary(store, readRecipeLibrary(store), [own('own-old', 'Bestaand')])
    assert.throws(() => restoreRecipeBackup(store, existing, text, () => 'own-new-file', stamp), undefined, text)
    assert.equal(store.getItem(), existing.raw, 'must not partially write any invalid import')
  }
})

test('stale tab, duplicate IDs, 100-recipe ceiling and storage quota are protected', () => {
  const portable = backup(own('own-x', 'Kopie'))
  const store = memory()
  const snapshot = readRecipeLibrary(store)
  const updated = saveRecipeLibrary(store, snapshot, [own('own-present', 'Bestaand')])
  assert.throws(() => restoreRecipeBackup(store, snapshot, portable, () => 'own-other', stamp), /ander tabblad/)
  const two = backup(own('own-x', 'X'), own('own-y', 'Y'))
  assert.throws(() => restoreRecipeBackup(store, updated, two, () => 'own-duplicate', stamp), /Dubbel/)
  assert.equal(store.getItem(), updated.raw)
  const full = memory()
  const fullState = saveRecipeLibrary(full, readRecipeLibrary(full), Array.from({length:100}, (_, i) => own('own-item-' + i, 'Recipe ' + i)))
  assert.throws(() => restoreRecipeBackup(full, fullState, portable, () => 'own-overflow', stamp), /Maximaal 100/)
  assert.equal(full.getItem(), fullState.raw)
  const blocked = { getItem: () => null, setItem: () => { throw new Error('quota') } }
  assert.throws(() => restoreRecipeBackup(blocked, {recipes:[],raw:null,error:null}, portable, () => 'own-one-test', stamp), /quota/)
})

test('future corrupt library cannot be exported or overwritten by restore', () => {
  const store = memory('{"version":99,"recipes":[]}')
  const corrupt = readRecipeLibrary(store)
  assert.ok(corrupt.error)
  assert.throws(() => exportRecipeBackup(corrupt))
  assert.throws(() => restoreRecipeBackup(store, corrupt, backup(own('own-x','X')), () => 'own-y', stamp))
  assert.equal(store.getItem(), '{"version":99,"recipes":[]}')
})

test('empty valid backup is not a destructive reset and can be restored safely', () => {
  const store = memory()
  const current = saveRecipeLibrary(store, readRecipeLibrary(store), [own('own-current','Original')])
  const imported = restoreRecipeBackup(store, current, '{"format":"supa-private-recipes-backup","version":1,"recipes":[]}', () => { throw Error('should not mint') }, stamp)
  assert.deepEqual(imported.recipes, current.recipes)
  assert.deepEqual(parseRecipeBackup('{"format":"supa-private-recipes-backup","version":1,"recipes":[]}'), [])
})

test('portable export refuses authentication query secrets and drops unneeded URL fragments', () => {
  const source = { ...own('own-url', 'From safe URL'), source:'url', sourceUrl:'https://recipes.example.org/pasta?utm_source=supa#recipe' }
  const valid = JSON.parse(exportRecipeBackup({recipes:[source],raw:null,error:null}))
  assert.equal(valid.recipes[0].sourceUrl, 'https://recipes.example.org/pasta?utm_source=supa')
  for (const query of ['?access_token=private', '?code=oauth-secret', '?oauth_token=private', '?SAMLResponse=private', '?api_key=private', '?authorization=BearerPrivate']) {
    const compromised = { ...source, sourceUrl:'https://recipes.example.org/pasta'+query }
    assert.throws(() => exportRecipeBackup({recipes:[compromised],raw:null,error:null}), /geheime inloggegevens/, query)
    const payload = { format:'supa-private-recipes-backup', version:1, recipes:[{
      title:source.title, servings:source.servings, minutes:source.minutes, source:'url', sourceUrl:compromised.sourceUrl,
      ingredients:source.ingredients.map(i => i.original), steps:source.steps,
    }] }
    assert.throws(() => parseRecipeBackup(JSON.stringify(payload)), /geheime inloggegevens/, query)
  }
})

test('UTF-8 payload ceiling matches real file byte size, not code units (#3629)', () => {
  const heavyStep = 'é'.repeat(5000)
  const recipes = [1, 2, 3].map(index => ({
    ...own('own-utf8-' + index, 'Unicode recept ' + index),
    steps: Array.from({ length: 100 }, () => heavyStep),
  }))
  const storage = memory()
  const state = saveRecipeLibrary(storage, readRecipeLibrary(storage), recipes)
  assert.equal(state.error, null)
  const raw = JSON.stringify({
    format: 'supa-private-recipes-backup', version: 1,
    recipes: recipes.map(item => ({
      title: item.title, source: item.source, sourceUrl: item.sourceUrl,
      servings: item.servings, minutes: item.minutes,
      ingredients: item.ingredients.map(i => i.original), steps: item.steps,
    })),
  })
  assert.ok(raw.length < 2_000_000, 'valid JSON fits in UTF-16 character count')
  assert.ok(Buffer.byteLength(raw, 'utf8') > 2_000_000, 'UTF-8 file exceeds actual byte limit')
  assert.throws(() => parseRecipeBackup(raw), /Back-upbestand is te groot of ongeldig/)
  assert.throws(() => exportRecipeBackup(state), /te groot om te exporteren/)
})

test('ordinary accented Dutch recipe backs up and restores losslessly', () => {
  const source = own('own-accents', 'Citroën crème brûlée', ['100 g crème fraîche'])
  source.steps = ['Roer crème fraîche, voeg citroën toe.']
  const storage = memory()
  const state = saveRecipeLibrary(storage, readRecipeLibrary(storage), [source])
  const raw = exportRecipeBackup(state)
  assert.ok(Buffer.byteLength(raw, 'utf8') <= 2_000_000)
  const parsed = parseRecipeBackup(raw)
  assert.equal(parsed[0].title, 'Citroën crème brûlée')
  assert.equal(parsed[0].ingredients[0].original, '100 g crème fraîche')
  assert.deepEqual(parsed[0].steps, ['Roer crème fraîche, voeg citroën toe.'])
})
