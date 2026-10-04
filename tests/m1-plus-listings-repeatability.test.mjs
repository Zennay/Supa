import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const evidenceUrl = new URL(
  '../evidence/m1/plus-listings-repeatability.v1.json',
  import.meta.url,
)
const evidence = JSON.parse(await readFile(evidenceUrl, 'utf8'))

test('PLUS listing repeatability evidence is bounded and independently captured', () => {
  assert.equal(evidence.schemaVersion, 1)
  assert.equal(evidence.milestone, 'M1 Data Feasibility')
  assert.equal(evidence.evidenceType, 'bounded-rendered-listings-repeatability')
  assert.equal(evidence.supermarket, 'plus')
  assert.equal(evidence.conclusion, 'bounded-repeatability-supported')
  assert.equal(evidence.attempts.length, 2)

  const [first, repeat] = evidence.attempts
  assert.notEqual(first.artifactId, repeat.artifactId)
  assert.notEqual(first.artifactDigest, repeat.artifactDigest)

  for (const attempt of evidence.attempts) {
    assert.match(attempt.artifactDigest, /^sha256:[a-f0-9]{64}$/)
    for (const page of Object.values(attempt.pages)) {
      assert.match(page.renderedHtmlSha256, /^[a-f0-9]{64}$/)
      assert.match(page.normalizedVisibleTextSha256, /^[a-f0-9]{64}$/)
      assert.match(page.firstProductLinksSha256, /^[a-f0-9]{64}$/)
      assert.equal(page.jsonLdCount, 0)
      assert.equal(page.applicationJsonCount, 0)
      assert.ok(page.productLinkCount > 0)
      assert.equal(page.productLinkCount, page.uniqueProductLinkCount)
    }
  }
})

test('PLUS catalog repeat preserves the bounded listing identity despite minor HTML drift', () => {
  const [first, repeat] = evidence.attempts
  const comparison = evidence.comparison.catalog

  assert.notEqual(
    first.pages.catalog.renderedHtmlSha256,
    repeat.pages.catalog.renderedHtmlSha256,
  )
  assert.equal(
    first.pages.catalog.productLinkCount,
    repeat.pages.catalog.productLinkCount,
  )
  assert.equal(
    first.pages.catalog.firstProductLinksSha256,
    repeat.pages.catalog.firstProductLinksSha256,
  )
  assert.equal(comparison.firstProductLinksExact, true)
  assert.equal(comparison.structuredDataCountsStable, true)
  assert.ok(comparison.normalizedVisibleTextSimilarity >= 0.999)
})

test('PLUS offers repeat preserves exact normalized visible listing content', () => {
  const [first, repeat] = evidence.attempts
  const comparison = evidence.comparison.offers

  assert.notEqual(
    first.pages.offers.renderedHtmlSha256,
    repeat.pages.offers.renderedHtmlSha256,
  )
  assert.equal(
    first.pages.offers.firstProductLinksSha256,
    repeat.pages.offers.firstProductLinksSha256,
  )
  assert.equal(
    first.pages.offers.normalizedVisibleTextSha256,
    repeat.pages.offers.normalizedVisibleTextSha256,
  )
  assert.equal(comparison.normalizedVisibleTextExact, true)
  assert.equal(comparison.normalizedVisibleTextSimilarity, 1)
})
