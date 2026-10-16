import test from 'node:test'
import assert from 'node:assert/strict'
import { recipeUrl, fetchRecipeHtml } from '../server/recipe-fetch.mjs'

const host = 'https://recipes.example.org/recept'
const blockedQueries = [
  '?oauth_code=FICTIONAL_SECRET', '?Auth-Code=FICTIONAL_SECRET',
  '?code_verifier=FICTIONAL_SECRET', '?CoDe%5fVeRiFiEr=FICTIONAL_SECRET',
  '?SAMLResponse=FICTIONAL_SECRET', '?access_token=FICTIONAL_SECRET',
  '?refresh_token=FICTIONAL_SECRET', '?id_token=FICTIONAL_SECRET',
  '?api_key=FICTIONAL_SECRET', '?client_secret=FICTIONAL_SECRET',
  '?authorization=FICTIONAL_SECRET', '?sessionId=FICTIONAL_SECRET',
  '?state=FICTIONAL_SECRET', '?pkce_verifier=FICTIONAL_SECRET',
  '?%2563ode=FICTIONAL_SECRET', '?code%255Fverifier=FICTIONAL_SECRET',
  '?%25252563ode=FICTIONAL_SECRET',
  '?%25252553AMLResponse=FICTIONAL_SECRET',
  '?%25252570kce_verifier=FICTIONAL_SECRET',
  '?%25252541uth%2525252dCode=FICTIONAL_SECRET',
  '?%252525252563ode=FICTIONAL_SECRET',
]

test('server import URL preflight refuses credentialed HTTPS query keys without echoing secret', () => {
  for (const query of blockedQueries) {
    assert.throws(() => recipeUrl(host + query), error => {
      assert.match(error.message, /openbare receptlink zonder inloggegevens/)
      assert.equal(error.message.includes('FICTIONAL_SECRET'), false)
      assert.equal(error.message.includes(query), false)
      return true
    }, query)
  }
})

test('server still admits harmless article, language and search page parameters', () => {
  for (const query of [
    '?pagina=2', '?recept=quiche&bron=app', '?barcode=12345678',
    '?taal=nl-NL&print=true', '?recipeVersion=3',
    '?%25252563ategory=vegetables',
  ]) {
    const parsed = recipeUrl(host + query + '#ingredienten')
    assert.equal(parsed.search, query)
    assert.equal(parsed.hash, '')
    assert.equal(parsed.protocol, 'https:')
  }
})

test('malicious import URLs are denied before DNS or HTTP transport is used', async () => {
  for (const query of blockedQueries) {
    let resolveCalls = 0
    let requestCalls = 0
    await assert.rejects(fetchRecipeHtml(host + query, {
      resolve: async () => { resolveCalls++; throw new Error('MUST NEVER DO DNS') },
      request: () => { requestCalls++; throw new Error('MUST NEVER REQUEST') },
      timeout: 500,
    }), /openbare receptlink zonder inloggegevens/, query)
    assert.equal(resolveCalls, 0, query)
    assert.equal(requestCalls, 0, query)
  }
})

test('credentialed URL errors do not leak the user-supplied fragment, token, or query', () => {
  assert.throws(() => recipeUrl(host + '?oauth_code=do-not-print#private'), error => {
    assert.equal(error.message.includes('do-not-print'), false)
    assert.equal(error.message.includes('private'), false)
    assert.equal(error.message.includes('oauth_code'), false)
    return true
  })
})
