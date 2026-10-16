import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { Readable } from 'node:stream'
import { fetchRecipeHtml } from '../server/recipe-fetch.mjs'

// Synthetic, memory-only QA. No real DNS lookup, HTTPS request, user tokens,
// retailer rights, prices, checkout claims or external login URLs.
const source = 'https://recipes.example.org/vegetarische-curry'
const secretRedirects = [
  'https://recipes.example.org/private?oauth_code=FICTIONAL_ONLY',
  'https://different-recipes.example.org/private?SAMLResponse=FICTIONAL_ONLY',
  'https://recipes.example.org/private?%25252563ode=FICTIONAL_ONLY',
  'https://recipes.example.org/private?code_verifier=FICTIONAL_ONLY',
]

function fakeTransport(redirectLocation, captures) {
  return (_url, _options, callback) => {
    captures.requests++
    const request = new EventEmitter()
    request.end = () => queueMicrotask(() => {
      const redirect = captures.requests === 1
      const response = Readable.from(redirect ? [] : [Buffer.from('<html>safe recipe</html>')])
      response.statusCode = redirect ? 302 : 200
      response.headers = redirect
        ? { location: redirectLocation }
        : { 'content-type': 'text/html' }
      callback(response)
    })
    return request
  }
}

test('credentials on first redirect hop are denied before new DNS and HTTP', async () => {
  for (const target of secretRedirects) {
    const captures = { requests: 0, dns: 0 }
    await assert.rejects(fetchRecipeHtml(source, {
      resolve: async () => {
        captures.dns++
        return [{ address: '93.184.216.34', family: 4 }]
      },
      request: fakeTransport(target, captures),
      timeout: 1_000,
    }), error => {
      assert.match(error.message, /openbare receptlink zonder inloggegevens/)
      assert.doesNotMatch(error.message, /FICTIONAL_ONLY|SAMLResponse|oauth_code|code_verifier/)
      return true
    }, 'redirect to credential-bearing URL must be refused: ' + target.split('?')[0])
    assert.equal(captures.dns, 1, 'do not resolve second origin')
    assert.equal(captures.requests, 1, 'do not open second HTTPS transport')
  }
})

test('relative benign redirect can still complete with pinned public DNS', async () => {
  const captures = { requests: 0, dns: 0 }
  const output = await fetchRecipeHtml(source, {
    resolve: async () => {
      captures.dns++
      return [{ address: '93.184.216.34', family: 4 }]
    },
    request: fakeTransport('/ander-recept?pagina=2#stappen', captures),
    timeout: 1_000,
  })
  assert.equal(captures.dns, 2)
  assert.equal(captures.requests, 2)
  assert.equal(output.sourceUrl, 'https://recipes.example.org/ander-recept?pagina=2')
  assert.equal(output.html, '<html>safe recipe</html>')
})
