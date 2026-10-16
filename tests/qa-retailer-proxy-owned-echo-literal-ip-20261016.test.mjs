/**
 * Independent SUPA QA 2/2, frozen product proxy owner #3269:
 * 93e8ce54d90c915634deb55dd56b072174a5b51b.
 *
 * A purported operator-owned public HTTPS ECHO must not be a naked IP
 * literal, private/loopback/link-local origin or cloud metadata address.
 * This tests only URL normalization. ZERO network, DNS, proxies or retailers.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { validatedOwnedEndpoint } from '../scripts/retailer-proxy-health-service.mjs'

test('ordinary explicit owned HTTPS DNS hostname remains accepted for local preflight only', () => {
  const u = validatedOwnedEndpoint(
    'https://probe.my-owned-domain.nl/health', 'probe.my-owned-domain.nl')
  assert.equal(u.protocol, 'https:')
  assert.equal(u.hostname, 'probe.my-owned-domain.nl')
  assert.equal(u.pathname, '/health')
})

for (const [label, address] of [
  ['local loopback address', '127.0.0.1'],
  ['RFC1918 private address', '192.168.1.10'],
  ['cloud-metadata/link-local address', '169.254.169.254'],
  ['public literal IP without operator-owned DNS identity', '8.8.8.8'],
]) {
  test('operator-owned proxy echo URL must reject ' + label + ' before any probe [EXPECTED RED]', () => {
    assert.throws(
      () => validatedOwnedEndpoint('https://' + address + '/health', address),
      /owned|hostname|HTTPS|public|IP/i,
      'an owned host config string alone does not turn an IP literal into an owned DNS echo service',
    )
  })
}
