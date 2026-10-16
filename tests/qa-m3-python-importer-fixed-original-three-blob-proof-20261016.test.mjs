/**
 * Independent QA 2/2 — original pre-fix source identity on product #3254.
 * The real original three importer QA suites were authored and executed RED
 * on the pre-fix owner; this cannot weaken their assertions retroactively.
 * They are on the corrected product branch already, so only add a guard here.
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

test('three original Python importer RED suites have identical Git blob bytes on fixed owner', async () => {
  for (const [name, expected] of ORIGINAL) {
    const bytes = await readFile(new URL('./' + name, import.meta.url))
    const actual = createHash('sha1')
      .update('blob ' + bytes.byteLength + '\0')
      .update(bytes)
      .digest('hex')
    assert.equal(actual, expected, 'original hosted RED assertions were altered: ' + name)
  }
})
