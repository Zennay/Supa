import test from 'node:test'
import assert from 'node:assert/strict'
import { assessRecipeSourceUrl } from '../src/domain/userRecipeSourceUrl.ts'

const allowed = (value) => assessRecipeSourceUrl(value).accepted

test('ordinary public HTTPS recipe URLs are normalized but never automatically fetch-ready', () => {
  const result = assessRecipeSourceUrl('https://www.lekkereten.nl/recept/soep?pagina=2#instructies')
  assert.deepEqual(result, {
    accepted: true,
    normalizedUrl: 'https://www.lekkereten.nl/recept/soep?pagina=2',
    fetchReady: false,
  })
})

test('HTTP, javascript, ftp, spaces, controls and backslash tricks are refused', () => {
  for (const value of ['http://www.example.org/a', 'javascript:alert(1)', 'ftp://www.example.org/x',
    ' https://www.ok.nl/a', 'https://www.ok.nl/a\n', 'https:\\www.ok.nl', 'https://www.ok.nl\\@localhost']) {
    assert.equal(allowed(value), false, value)
  }
})

test('loopback, link-local, cloud metadata, literal IPv4/IPv6 and integer encoded IPs are refused', () => {
  for (const value of ['https://localhost/a', 'https://foo.local/a', 'https://169.254.169.254/latest/meta-data',
    'https://127.0.0.1/', 'https://[::1]/', 'https://0x7f000001/', 'https://2130706433/',
    'https://192.168.1.12/', 'https://a.home.arpa/', 'https://service.internal/']) {
    assert.equal(allowed(value), false, value)
  }
})

test('userinfo, credential-looking query parameters and percent encoded names are refused', () => {
  for (const value of [
    'https://user:pw@www.ok.nl/recept', 'https://www.ok.nl?access_token=abc',
    'https://www.ok.nl?Client-Secret=abc', 'https://www.ok.nl?%74oken=abc',
    'https://www.ok.nl?SESSION_id=abc', 'https://www.ok.nl?%2574oken=abc',
    'https://%6Cocalhost/recept',
  ]) assert.equal(allowed(value), false, value)
})

test('unusual authority ports, malformed public domains and reserved domains are refused', () => {
  for (const value of [
    'https://www.ok.nl:8443/recept', 'https://no-dot-domain/recept',
    'https://.com/recept', 'https://sub.example/recept', 'https://c.test/recept',
    'https://-bad.host.nl/recept', 'https://www.ok.nl./recept',
  ]) assert.equal(allowed(value), false, value)
})

test('input limits and non-string sources fail closed', () => {
  for (const value of [null, undefined, {}, 123, '', 'https://www.ok.nl/' + 'x'.repeat(2100)]) {
    assert.equal(allowed(value), false)
  }
})

test('internationalized and digit-leading public domains are only preview-approved', () => {
  const digit = assessRecipeSourceUrl('https://123recepten.nl/bowl')
  assert.equal(digit.accepted, true)
  assert.equal(digit.fetchReady, false)
  const result = assessRecipeSourceUrl('https://www.bäcker.de/recept?term=k%C3%A4se')
  assert.equal(result.accepted, true)
  assert.equal(result.fetchReady, false)
})
