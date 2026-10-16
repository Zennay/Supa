import test from 'node:test'
import assert from 'node:assert/strict'
import { recipeUrl, fetchRecipeHtml } from '../server/recipe-fetch.mjs'

// Independent, test-only QA on the frozen green server recipe import owner.
// These URLs carry *invented* values, require no internet, and do not
// authorize or perform any real recipe-site or supermarket request.
const base = 'https://recipes.example.org/vegan-risotto'
const unsafe = [
  '?%25252563ode=FICTIONAL_AUTH_VALUE',
  '?%25252553AMLResponse=FICTIONAL_AUTH_VALUE',
  '?%25252570kce_verifier=FICTIONAL_AUTH_VALUE',
  '?%25252541uth%2525252dCode=FICTIONAL_AUTH_VALUE',
  '?%252525252563ode=FICTIONAL_AUTH_VALUE',
]

test('deeply escaped OAuth/PKCE/SAML query keys must not pass URL intake', () => {
  for (const query of unsafe) {
    assert.throws(() => recipeUrl(base + query + '#never-print'), error => {
      assert.match(error.message, /openbare receptlink zonder inloggegevens/,
        'same generic refusal expected for encoded authentication keys')
      assert.doesNotMatch(error.message, /FICTIONAL_AUTH_VALUE|never-print|code|SAMLResponse/i)
      return true
    }, 'credential query must be rejected: ' + query.split('=')[0])
  }
})

test('deeply escaped authentication keys must fail before even injected DNS / HTTP', async () => {
  for (const query of unsafe) {
    let dnsCalls = 0
    let requests = 0
    await assert.rejects(fetchRecipeHtml(base + query, {
      resolve: async () => {
        dnsCalls++
        throw new Error('QA_DNS_MUST_NOT_RUN')
      },
      request: () => {
        requests++
        throw new Error('QA_HTTP_MUST_NOT_RUN')
      },
      timeout: 200,
    }), /openbare receptlink zonder inloggegevens/)
    assert.equal(dnsCalls, 0, query)
    assert.equal(requests, 0, query)
  }
})

test('normal percent-encoded noncredential keys are still allowed privately', () => {
  for (const query of [
    '?%25252563ategory=vegetables',
    '?page=2&recipe=risotto',
    '?language=nl-NL',
  ]) {
    const result = recipeUrl(base + query + '#stappen')
    assert.equal(result.protocol, 'https:')
    assert.equal(result.hash, '')
    assert.equal(result.origin, 'https://recipes.example.org')
  }
})
