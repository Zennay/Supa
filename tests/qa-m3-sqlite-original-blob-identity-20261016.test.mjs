/**
 * QA-only executable immutability attestation on fixed product #3235.
 * Original expected-RED tests were authored and hosted on separate QA #3242.
 * This file cannot make them easier: it fails the entire hosted acceptance if
 * either original test source changed by even a single byte before replay.
 *
 * No retailer calls, price/stock collection, customer data, permission or
 * public savings publication. This verifies tests, not source licenses.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'

const ORIGINALS = Object.freeze([
  [
    './qa-m3-sqlite-destination-domain-boundary-20261016.test.mjs',
    'cedb657be9a6aa62245dac76592de5ae0aaade95',
  ],
  [
    './qa-m3-full-basket-two-retailer-oracle-20261016.test.mjs',
    'f7cf99befda6c9a316b77fd12ef843da4096f141',
  ],
])

test('original two independently hosted SQLite and 11x2 QA suites retain exact Git blob identities', async () => {
  for (const [path, expected] of ORIGINALS) {
    const bytes = await readFile(new URL(path, import.meta.url))
    // Git's native blob identity: sha1('blob ' + binary-size + NUL + bytes)
    const actual = createHash('sha1')
      .update('blob ' + bytes.length + '\0')
      .update(bytes)
      .digest('hex')
    assert.equal(actual, expected, 'original independent QA assertions must be byte-identical')
  }
})
