import test from 'node:test'
import assert from 'node:assert/strict'
import { exportRecipeBackup, parseRecipeBackup, restoreRecipeBackup } from '../src/features/recipes/recipeBackup.ts'

/**
 * Independent QA2: the fullwidth Unicode delimiter regression #3667 is not
 * the only NFKC compatibility family. SMALL FORM punctuation U+FE5x/U+FE6x
 * must fail closed too after canonicalization, and must never be stored.
 *
 * Only fictional local recipe links, no real credentials or network access.
 */
const origin = 'https://recipes.example.org/fictional-noodles'
function recipe(url) {
  return { title:'QA noodles',source:'url',sourceUrl:url,
    servings:2,minutes:12,ingredients:['250 g pasta'],steps:['Boil.'] }
}
function payload(url) {
  return JSON.stringify({format:'supa-private-recipes-backup',version:1,
    recipes:[recipe(url)]})
}
function exportOne(url) {
  return exportRecipeBackup({error:null,raw:null,
    recipes:[{...recipe(url),id:'own-small-compat-qa',
      savedAt:'2026-10-16T21:00:00Z',
      ingredients:[{original:'250 g pasta'}]}]})
}
for (const [label, key] of [
  ['SMALL AMPERSAND U+FE60', 'page﹠code'],
  ['SMALL EQUALS SIGN U+FE66', 'page﹦code'],
  ['SMALL QUESTION MARK U+FE56', 'page﹖auth'],
  ['SMALL NUMBER SIGN U+FE5F', 'page﹟token'],
  ['SMALL PERCENT SIGN U+FE6A', 'page﹪26code'],
]) {
  test('portable private backup refuses canonicalized ' + label, () => {
    const url = origin + '?' + key + '=FICTIONAL_AUTH'
    assert.throws(()=>exportOne(url),/onveilige receptlink|geheime inloggegevens/)
    assert.throws(()=>parseRecipeBackup(payload(url)),/onveilige receptlink|geheime inloggegevens/)
    let minted=0,writes=0
    const store={getItem:()=>null,setItem:()=>{writes++}}
    assert.throws(()=>restoreRecipeBackup(store,
      {error:null,raw:null,recipes:[]},payload(url),
      ()=>{minted++;return 'own-should-never-allocate'},
      '2026-10-16T21:15:00.000Z'),/onveilige receptlink|geheime inloggegevens/)
    assert.equal(minted,0)
    assert.equal(writes,0)
  })
}
test('Unicode accents and normal values stay legal and private',()=>{
  const url=origin+'?cafe%CC%81=rijst&category=groente'
  assert.equal(JSON.parse(exportOne(url)).recipes[0].sourceUrl,url)
  assert.equal(parseRecipeBackup(payload(url))[0].sourceUrl,url)
})
test('escaped separators inside harmless query VALUES remain legal',()=>{
  const url=origin+'?category=rijst%26pasta'
  assert.equal(JSON.parse(exportOne(url)).recipes[0].sourceUrl,url)
  assert.equal(parseRecipeBackup(payload(url))[0].sourceUrl,url)
})
