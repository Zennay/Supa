/**
 * Direct exported proxy probe must never CONNECT to unowned/private targets.
 * Node's http.request is monkeypatched for all cases BEFORE invocation:
 * no socket, DNS, proxy or external traffic can occur in this test.
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import http from 'node:http'
import { validatedOwnedEndpoint, probeViaOwnedHttps } from
  '../scripts/retailer-proxy-health-service.mjs'

const candidate = 'http://8.8.8.8:3128'
const good = 'https://probe.my-owned-domain.nl/health'
test('owned DNS name passes exact preflight without invoking any network', () => {
  const valid = validatedOwnedEndpoint(good, 'probe.my-owned-domain.nl')
  assert.equal(valid.hostname, 'probe.my-owned-domain.nl')
})
for (const target of [
  'https://127.0.0.1/health', 'https://169.254.169.254/latest/meta-data/',
  'https://192.168.0.1/health', 'https://8.8.8.8/health',
  'https://[::1]/health', 'https://[fe80::1]/health',
  'http://probe.my-owned-domain.nl/health',
  'https://probe.my-owned-domain.nl:8443/health',
  'https://probe.my-owned-domain.nl/health?token=secret',
]) {
  test('direct probe rejects untrusted endpoint before HTTP: ' + target, async t => {
    let requests = 0
    t.mock.method(http, 'request', () => {
      requests++
      throw new Error('BLOCKED by test mock; no outbound request permitted')
    })
    await assert.rejects(
      () => probeViaOwnedHttps(candidate, new URL(target), { timeoutMs: 100 }),
      /Owned endpoint must be exact public HTTPS hostname/,
    )
    assert.equal(requests, 0, 'must never attempt CONNECT')
  })
}
for (const endpoint of [
  { hostname: 'probe.my-owned-domain.nl', pathname: '/health', href: good },
  new Proxy(new URL(good), {}),
  null,
  good,
]) {
  test('direct probe refuses non-native URL endpoint without network', async t => {
    let requests = 0
    t.mock.method(http, 'request', () => { requests++; throw new Error('NO NETWORK') })
    await assert.rejects(
      () => probeViaOwnedHttps(candidate, endpoint, { timeoutMs: 100 }),
      /Owned endpoint must be exact public HTTPS hostname/,
    )
    assert.equal(requests, 0)
  })
}
test('direct probe rejects malformed candidate without initiating HTTP', async t => {
  const endpoint = validatedOwnedEndpoint(good, 'probe.my-owned-domain.nl')
  let requests = 0
  t.mock.method(http, 'request', () => { requests++; throw new Error('NO NETWORK') })
  const result = await probeViaOwnedHttps('http://127.0.0.1:3128', endpoint, { timeoutMs: 100 })
  assert.deepEqual(result, { ok: false, ownedEndpoint: false })
  assert.equal(requests, 0)
})
