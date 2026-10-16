/**
 * Independent SUPA M3 QA composition — native Git blob identity enforcement.
 * Fixed product owner #3235 SHA 0d3273efd1c06ca7b8f36e34b678a6a26ea58ac6.
 *
 * Original independent QA files were authored, committed, and actually run
 * as separate evidence before this integration. This guard fails if ANY
 * source assertions change between original RED/positive and combined replay.
 * No source rights, live retailer data, customer information or publication.
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'

const expected = Object.freeze([
  ['qa-m3-sqlite-destination-domain-boundary-20261016.test.mjs',
    'cedb657be9a6aa62245dac76592de5ae0aaade95'],
  ['qa-m3-full-basket-two-retailer-oracle-20261016.test.mjs',
    'f7cf99befda6c9a316b77fd12ef843da4096f141'],
  ['qa-m3-sqlite-relational-source-rights-20261016.test.mjs',
    'f4e4eb0de289d3f6b5077f6c59ec11cf6ce553c2'],
])

test('all three unchanged independently hosted M3 QA source blobs remain byte-identical', async () => {
  for (const [name, sha] of expected) {
    const contents = await readFile(new URL('./' + name, import.meta.url))
    const verified = createHash('sha1')
      .update('blob ' + contents.byteLength + '\0')
      .update(contents)
      .digest('hex')
    assert.equal(verified, sha, 'frozen independent test source changed: ' + name)
  }
})
