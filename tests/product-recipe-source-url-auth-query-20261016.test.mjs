/**
 * Product #3276: authentication/SSO secrets in a pasted recipe link must not
 * be admitted into a normalized preview URL, even after percent decoding.
 * Pure URL code; zero DNS, network requests, accounts or production data.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { assessRecipeSourceUrl } from '../src/domain/userRecipeSourceUrl.ts'

for (const key of [
  'oauth_code', 'Auth-Code', 'CoDe%5fVeRiFiEr',
  'code_verifier', 'code-verifier', 'authorization_code',
  'OAuthState', 'code_challenge', 'PKCE_verifier',
  'SAMLResponse', 'SAMLRequest', 'saml_assertion',
  'x-auth-code', 'meta_OAuth%5FCode', 'x_saml_response',
]) {
  test('refuses confidential query key ' + key + ' without leaking the URL', () => {
    const result = assessRecipeSourceUrl(
      'https://www.fictionalrecipes.nl/soep?' + key + '=FICTIONAL_PRIVATE_VALUE')
    assert.deepEqual(result, { accepted: false, reason: 'credentialed_url' })
    assert.equal(Object.hasOwn(result, 'normalizedUrl'), false)
    assert.equal(Object.hasOwn(result, 'fetchReady'), false)
    assert.doesNotMatch(JSON.stringify(result), /FICTIONAL_PRIVATE_VALUE|https?:\/\//)
  })
}
for (const input of [
  'https://www.fictionalrecipes.nl/soep?pagina=2#ingredienten',
  'https://www.fictionalrecipes.nl/soep?postcode=2311',
  'https://www.fictionalrecipes.nl/soep?productcode=A123',
  'https://www.fictionalrecipes.nl/soep?cookingcode=veggie',
]) {
  test('benign URL query remains preview-only ' + input, () => {
    const result = assessRecipeSourceUrl(input)
    assert.equal(result.accepted, true)
    assert.equal(result.fetchReady, false)
    assert.equal(result.normalizedUrl?.includes('#'), false)
  })
}
