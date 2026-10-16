import test from 'node:test'
import assert from 'node:assert/strict'
import { publicAddress, fetchRecipeHtml } from '../server/recipe-fetch.mjs'

// Independent offline security QA on frozen M3 feature PR. TEST-NET-2
// 198.51.100.0/24 is IANA documentation-only, NOT publicly routable;
// no DNS is actually resolved and no HTTP/TLS connection is ever opened.
const host = 'https://recipes.example.org/recept-voorbeeld'

test('IANA TEST-NET-2 is not a globally routable server address', () => {
  for (const address of [
    '198.51.100.1', '198.51.100.42', '198.51.100.254',
  ]) {
    assert.equal(publicAddress(address), false,
      'documentation-only TEST-NET-2 DNS answer must not pass public-address policy: ' + address)
  }
})

test('a TEST-NET-2 DNS answer cannot reach even an injected HTTP transport', async () => {
  let dnsCalls = 0
  let httpCalls = 0
  await assert.rejects(fetchRecipeHtml(host, {
    resolve: async () => {
      dnsCalls++
      return [{ address: '198.51.100.42', family: 4 }]
    },
    request: () => {
      httpCalls++
      throw Error('QA_HTTP_MUST_NOT_BE_INVOKED')
    },
    timeout: 500,
  }), /publiek bereikbaar/)
  assert.equal(dnsCalls, 1)
  assert.equal(httpCalls, 0, 'all reserved DNS answers must be rejected before transport')
})

test('mixed valid public plus reserved DNS answers must fail closed pre-request', async () => {
  let transportCalls = 0
  await assert.rejects(fetchRecipeHtml(host, {
    resolve: async () => [
      { address: '93.184.216.34', family: 4 },
      { address: '198.51.100.5', family: 4 },
    ],
    request: () => {
      transportCalls++
      throw Error('QA_HTTP_MUST_NOT_BE_INVOKED')
    },
    timeout: 500,
  }), /publiek bereikbaar/)
  assert.equal(transportCalls, 0)
})

test('ordinary public unicast IPv4 remains approved by the narrow address predicate', () => {
  assert.equal(publicAddress('93.184.216.34'), true)
  assert.equal(publicAddress('127.0.0.1'), false)
  assert.equal(publicAddress('203.0.113.42'), false)
})
