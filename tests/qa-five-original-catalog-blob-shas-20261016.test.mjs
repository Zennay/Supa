import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

// Permanent, executable provenance contract for five independent original
// SUPA QA test suites. The Git blob identity includes byte length and exact
// file bytes. Any changed assertion, inserted skip, or rewritten test fails
// the acceptance run instead of masquerading as immutable RED->GREEN proof.
//
// These are historic/offline and synthetic negative test suites. This checker
// reads only local repository QA source files: never retailer URLs, prices,
// credentials, network, customers or shared state.
const ORIGINAL_QA_BLOBS = Object.freeze({
  'qa-catalog-raw-offer-physical-window-20261016.test.mjs':
    'f1ae782d95eec0034196b42689dc9c7f6aea74bf',
  'qa-universal-catalog-semantic-event-dedup-20261016.test.mjs':
    'ae1eb7f971faec1d4f48cf14a80909389ed67996',
  'qa-catalog-source-query-credential-case-20261016.test.mjs':
    '3f3f93db2acef1277a52e13e1cdcdd295b52cb62',
  'qa-universal-catalog-direct-caller-trust-boundary-20261016.test.mjs':
    'ee153b7442a1a975290d08d5f40234184df6d1f6',
  'qa-six-source-catalog-offer-conflict-matrix-20261016.test.mjs':
    '9ab7364950d90154a13ceef4c32639ed4c1c8f96',
})

function gitBlobSha(bytes) {
  const h = createHash('sha1')
  h.update(Buffer.from('blob ' + bytes.length + '\0', 'utf8'))
  h.update(bytes)
  return h.digest('hex')
}

test('five original independent M3 QA acceptance sources stay byte-identical', async () => {
  let checked = 0
  const entries = Object.entries(ORIGINAL_QA_BLOBS)
  assert.equal(entries.length, 5, 'the original QA coverage ledger must be complete')
  for (const [filename, expectedSha] of entries) {
    assert.match(filename, /^qa-[a-z0-9-]+\.test\.mjs$/)
    assert.match(expectedSha, /^[a-f0-9]{40}$/)
    const bytes = await readFile(new URL('./' + filename, import.meta.url))
    assert.ok(bytes.length > 100, filename + ' must be a substantive test source')
    assert.equal(gitBlobSha(bytes), expectedSha,
      filename + ': independent original QA source was changed, diluted or replaced')
    checked++
  }
  assert.equal(checked, 5)
})
