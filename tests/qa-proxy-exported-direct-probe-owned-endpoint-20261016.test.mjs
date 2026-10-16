/**
 * Independently bounded in-process proxy probe trust-boundary acceptance.
 *
 * The module-level exported probe helper must never issue CONNECT for an
 * endpoint which the normal owner-controlled service itself would refuse.
 * HTTP request is mocked BEFORE calling the helper: zero sockets/network,
 * DNS requests, proxy dial, metadata access or retailer requests.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { validatedOwnedEndpoint, probeViaOwnedHttps } from '../scripts/retailer-proxy-health-service.mjs'
import { parseProxyCandidates } from '../scripts/retailer-proxy-pool.mjs'

const candidate = 'http://8.8.8.8:3128'
const canonicalOwned = 'https://probe.my-owned-domain.nl/health'

test('QA positive control: owned service admits an exact DNS HTTPS identity, without probing', () => {
  assert.equal(parseProxyCandidates('8.8.8.8:3128').length, 1,
    'fixture must be a real admitted candidate, not a test bypass')
  const result = validatedOwnedEndpoint(canonicalOwned, 'probe.my-owned-domain.nl')
  assert.equal(result.hostname, 'probe.my-owned-domain.nl')
  assert.equal(result.protocol, 'https:')
})

for (const [kind, url] of [
  ['link-local cloud metadata address', 'https://169.254.169.254/latest/meta-data/'],
  ['loopback address', 'https://127.0.0.1/health'],
  ['unowned public numeric address', 'https://8.8.8.8/health'],
]) {
  test('QA EXPECTED RED: exported probe must reject ' + kind + ' before CONNECT or DNS', async t => {
    const endpoint = new URL(url)
    assert.throws(() => validatedOwnedEndpoint(url, endpoint.hostname),
      /Owned endpoint must be exact public HTTPS hostname/)
    let attemptedRequests = 0
    t.mock.method(http, 'request', () => {
      attemptedRequests++
      throw new Error('QA MOCK: outbound CONNECT attempted; no real I/O was allowed')
    })
    await assert.rejects(
      () => probeViaOwnedHttps(candidate, endpoint, { timeoutMs: 100 }),
      /Owned endpoint must be exact public HTTPS hostname|Invalid owned HTTPS endpoint/,
      'the directly exported API must enforce the same preflight as runCycle',
    )
    assert.equal(attemptedRequests, 0,
      'an untrusted endpoint may never reach the mocked HTTP request')
  })
}
