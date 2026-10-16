/**
 * Product #3277: ownership input must never authorize a raw numeric HTTP
 * CONNECT target, even if the caller repeats that IP as ownedHost.
 * Pure string/URL validation only: no DNS, proxy, feed or retailer traffic.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { validatedOwnedEndpoint } from '../scripts/retailer-proxy-health-service.mjs'

for (const host of [
  'probe.my-owned-domain.nl',
  'probe.project.example.net',
  'xn--bcher-kva.example.org',
  'a-b.c-d.example.co.uk',
]) {
  test('owned HTTPS echo accepts exact canonical DNS hostname ' + host, () => {
    const value = validatedOwnedEndpoint('https://' + host + '/health', host)
    assert.equal(value.hostname, host)
    assert.equal(value.protocol, 'https:')
  })
}
for (const target of [
  '127.0.0.1', '192.168.1.10', '169.254.169.254', '8.8.8.8',
  '10.0.0.1', '172.16.0.1', '100.64.0.1', '0.0.0.0', '255.255.255.255',
  '[::1]', '[fe80::1]', '[2001:4860:4860::8888]',
  '127.1', '0177.0.0.1', '0x7f000001', '2130706433',
  '8.8.8.8.', '1.1.1.1.',
]) {
  test('refuses owned endpoint IP literal or numeric alias ' + target, () => {
    const address = 'https://' + target + '/health'
    const canonicalHost = new URL(address).hostname
    for (const claimedOwner of [target, canonicalHost]) {
      assert.throws(() => validatedOwnedEndpoint(address, claimedOwner),
        /Owned endpoint must be exact public HTTPS hostname|Invalid owned HTTPS endpoint/)
    }
  })
}
for (const host of [
  'probe..example.nl', '.example.nl', 'probe.example.nl.',
  '-probe.example.nl', 'probe-.example.nl', 'probe_example.nl',
  'localhost', 'echo.local', 'echo.internal', 'echo.test',
  'example.com', 'probe.example.com.test',
]) {
  test('refuses noncanonical or reserved owner hostname ' + host, () => {
    assert.throws(() => validatedOwnedEndpoint('https://' + host + '/health', host))
  })
}
test('DNS-looking host does not allow secret query, downgrade or owner mismatch', () => {
  const host = 'probe.my-owned-domain.nl'
  assert.throws(() => validatedOwnedEndpoint('https://' + host + '/health?token=abc', host))
  assert.throws(() => validatedOwnedEndpoint('http://' + host + '/health', host))
  assert.throws(() => validatedOwnedEndpoint('https://' + host + '/health', 'different.example.nl'))
})
