/**
 * Independent immutable QA composition for the direct Python SQLite importer.
 * The THREE test sources were each written and hosted first on two separate
 * QA branches. This machine check fails if any assertion changes by one byte.
 * Frozen product owner #3235 at 0d3273efd1c06ca7b8f36e34b678a6a26ea58ac6.
 * No local retailer traffic, source permissions, customer data or live prices.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'

const ORIGINAL = Object.freeze([
  ['qa-m3-direct-python-importer-source-query-20261016.test.mjs',
    '814259a18aabef7e52cabb58b6b892a4a3934715'],
  ['qa-m3-direct-python-importer-nanosecond-offers-20261016.test.mjs',
    'a18b35327b2b3a36a9f5f0df50dfd64341817604'],
  ['qa-m3-direct-python-importer-ancestor-symlink-20261016.test.mjs',
    '4419818728ae7473269956fc08dbbfd37cf75bb4'],
])

test('all three original independently hosted Python SQLite importer QA sources are byte-identical', async () => {
  for (const [name, originalSha] of ORIGINAL) {
    const bytes = await readFile(new URL('./' + name, import.meta.url))
    const actualSha = createHash('sha1')
      .update('blob ' + bytes.byteLength + '\0')
      .update(bytes)
      .digest('hex')
    assert.equal(actualSha, originalSha, 'independent frozen QA test changed: ' + name)
  }
})
