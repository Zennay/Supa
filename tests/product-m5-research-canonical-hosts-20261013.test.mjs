import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { assessRetailerResearch } from '../scripts/m5-assess-retailer-research.mjs'

const discovery = JSON.parse(await readFile(new URL('../docs/m5-retailer-discovery.v1.json', import.meta.url), 'utf8'))
function input(url) {
  return { version: 1, purpose: 'manual-research-only',
    reviews: [{
      retailerId: 'plus', reviewedAt: '2026-10-13',
      sourceKind: 'official-feed', sourceUrl: url,
      termsUrl: null, robotsUrl: null, rightsState: 'unknown',
      rightsEvidenceUrl: null, regionScope: 'unknown',
      assortmentScope: 'unknown', termsReview: 'unreviewed',
      robotsReview: 'unreviewed', ownerContactStatus: 'unassessed',
      freshnessPlan: 'unassessed', priority: 'unprioritized',
    }] }
}
test('fictional public-style HTTPS citations remain unverified only', () => {
  for (const value of ['https://example.invalid/feed', 'https://feed.example.invalid/list?v=1']) {
    const report = assessRetailerResearch(structuredClone(discovery), input(value))
    assert.equal(report.reviewedCount, 1)
    assert.equal(report.m5Eligible, false)
    assert.equal(report.productionReady, false)
    assert.equal(report.retailers.find(x => x.id === 'plus').rightsVerified, false)
    assert.doesNotMatch(JSON.stringify(report), /https:\/\//)
  }
})
test('literal public/private IPv4 and IPv6 and local host aliases cannot become retailer evidence', () => {
  for (const url of [
    'https://127.0.0.1/', 'https://10.1.2.3/', 'https://172.16.2.3/',
    'https://192.168.0.1/', 'https://169.254.169.254/',
    'https://8.8.8.8/', 'https://[::1]/', 'https://[fe80::1]/',
    'https://[::ffff:127.0.0.1]/',
    'https://localhost./', 'https://internal.localhost/',
    'https://2130706433/', 'https://0x7f000001/',
  ]) {
    const source = input(url)
    const frozen = JSON.stringify(source)
    assert.throws(() => assessRetailerResearch(structuredClone(discovery), source),
      /Invalid HTTPS evidence location/, url)
    assert.equal(JSON.stringify(source), frozen)
  }
})
