import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { compareLocalRetailerSnapshots } from '../scripts/retailer-compare-local-snapshots.mjs'

// Entirely fictional, local bytes. No retailer HTTP, no customer observations.
// SHA-256 evidence must describe the exact received HTML FILE BYTES, not a
// lossy UTF-8 string after invalid byte sequences were replaced with U+FFFD.
const now = Date.parse('2026-10-15T11:00:00Z')
const when = '2026-10-15T10:00:00Z'
const sample = (name = 'Fictional milk') =>
  '<!doctype html><script type="application/ld+json">' +
  JSON.stringify({ '@type': 'Product', sku: 'fictional-milk',
    name, weight: { value: '1000 ml' },
    offers: { '@type': 'Offer', price: '1.29', priceCurrency: 'EUR',
      availability: 'https://schema.org/InStock' } }) +
  '</script>'

async function fixture(t, plusBytes, dekaBytes) {
  const dir = await mkdtemp(join(tmpdir(), 'supa-m3-byte-identity-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  await writeFile(join(dir, 'plus.html'), plusBytes)
  await writeFile(join(dir, 'deka.html'), dekaBytes)
  const manifest = join(dir, 'manifest.json')
  await writeFile(manifest, JSON.stringify({
    version: 1,
    requirements: [{ id: 'milk', query: 'Fictional milk', amount: 1000, unit: 'ml' }],
    snapshots: [
      { sourceId: 'plus-product-halfvolle-melk', htmlFile: 'plus.html', capturedAt: when },
      { sourceId: 'dekamarkt-product-halfvolle-melk', htmlFile: 'deka.html', capturedAt: when },
    ],
  }))
  return manifest
}
const valid = Buffer.from(sample(), 'utf8')
const validOther = Buffer.from('<html>Fictional, no product JSON-LD</html>', 'utf8')

// All these byte streams are impossible UTF-8. Node Buffer.toString()
// replaces them with U+FFFD instead of signaling that the source bytes were
// altered, and hashing the replacement string fingerprints the WRONG bytes.
const badSuffixes = [
  ['isolated FF', [0xff]],
  ['isolated FE', [0xfe]],
  ['orphan continuation', [0x80]],
  ['truncated three-byte sequence', [0xe2, 0x82]],
  ['overlong slash', [0xc0, 0xaf]],
  ['surrogate encoded in UTF-8', [0xed, 0xa0, 0x80]],
]
for (const [label, suffix] of badSuffixes) {
  for (const retailer of ['PLUS', 'DekaMarkt']) {
    test('QA M3 rejects invalid UTF-8 ' + label + ' in ' + retailer + ' HTML before source hashing', async t => {
      const invalid = Buffer.concat([valid, Buffer.from(suffix)])
      const manifest = await fixture(t,
        retailer === 'PLUS' ? invalid : validOther,
        retailer === 'DekaMarkt' ? invalid : validOther)
      await assert.rejects(
        compareLocalRetailerSnapshots(manifest, now),
        /UTF-8|UTF8|encoding|invalid.*snapshot/i,
        label + ': an invalid byte stream must not obtain a credible SHA-256 source fingerprint',
      )
    })
  }
}

test('QA M3 keeps byte-exact SHA-256 for a genuine valid multibyte UTF-8 snapshot', async t => {
  const multi = Buffer.from(sample('Fictional melk 🥛'), 'utf8')
  const manifest = await fixture(t, multi, validOther)
  const result = await compareLocalRetailerSnapshots(manifest, now)
  assert.equal(result.captureSummary[0].sha256,
    createHash('sha256').update(multi).digest('hex'))
  assert.equal(result.comparison.claimable, false)
  assert.equal(result.comparison.comparable, false)
  assert.equal(result.comparison.savingsCents, null)
})

test('QA M3 preserves exact ordinary ASCII capture digest and no-money abstention', async t => {
  const manifest = await fixture(t, valid, validOther)
  const result = await compareLocalRetailerSnapshots(manifest, now)
  assert.equal(result.captureSummary[0].sha256,
    createHash('sha256').update(valid).digest('hex'))
  assert.equal(result.captureSummary[1].sha256,
    createHash('sha256').update(validOther).digest('hex'))
  assert.equal(result.comparison.claimable, false)
  assert.equal(result.comparison.comparable, false)
  assert.equal(result.comparison.savingsCents, null)
})
