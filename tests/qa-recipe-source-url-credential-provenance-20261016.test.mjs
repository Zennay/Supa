/**
 * Independent Supa QA against product-owned pure URL preflight #3270 frozen
 * HEAD 565e617a3149b52d94eea3bb73c5957370edde18.
 * Authorization code / PKCE verifier / SAML assertion query strings are
 * secrets even without "token" or "password" as a substring.
 *
 * No HTTP requests, DNS lookups, user data, API keys or server fetch.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { assessRecipeSourceUrl } from '../src/domain/userRecipeSourceUrl.ts'

test('benign recipe page query remains preview-eligible but never fetch-ready', () => {
  const result = assessRecipeSourceUrl('https://www.fictionalrecipes.nl/soep?pagina=2#ingredienten')
  assert.deepEqual(result, {
    accepted: true,
    normalizedUrl: 'https://www.fictionalrecipes.nl/soep?pagina=2',
    fetchReady: false,
  })
})

for (const [label, key] of [
  ['OAuth authorization-code query', 'oauth_code'],
  ['hyphenated OAuth authorization code', 'Auth-Code'],
  ['PKCE code verifier in query', 'code_verifier'],
  ['mixed-case encoded PKCE verifier query', 'CoDe%5fVeRiFiEr'],
  ['SAML SSO response assertion query', 'SAMLResponse'],
]) {
  test('recipe URL preview must refuse confidential ' + label + ' [EXPECTED RED]', () => {
    const result = assessRecipeSourceUrl(
      'https://www.fictionalrecipes.nl/soep?' + key + '=FICTIONAL_PRIVATE_VALUE')
    assert.deepEqual(result, {
      accepted: false,
      reason: 'credentialed_url',
    }, 'credential-bearing query must not become an approved normalized URL')
    assert.equal('normalizedUrl' in result, false)
    assert.equal('fetchReady' in result, false)
    assert.doesNotMatch(JSON.stringify(result), /FICTIONAL_PRIVATE_VALUE|https?:\/\//)
  })
}
