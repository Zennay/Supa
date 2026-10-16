import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

// SUPA independent QA: prevent any original expected-RED assertion from being
// edited or weakened during its RED -> GREEN handoff. Actual Git blob SHA
// includes the canonical byte length and exact file bytes. No network, source
// replay, retailer data or production writing is performed by this test.
const immutableOriginals = Object.freeze({
  'qa-retailer-operator-civil-archive-trust-20261016.test.mjs':
    'f15d32f1b1a3251eb703c1dfc47981e271b98b6f',
  'qa-retailer-operator-cli-inert-argv-20261016.test.mjs':
    '71b130b38e3150afb6e429fd15393c8b57b6f8c6',
})

function gitBlobSha(bytes) {
  return createHash('sha1')
    .update(Buffer.from('blob ' + bytes.length + '\0', 'utf8'))
    .update(bytes)
    .digest('hex')
}

test('original eight real hosted RED operator assertions remain byte-identical on owner fix', async () => {
  const entries = Object.entries(immutableOriginals)
  assert.equal(entries.length, 2)
  for (const [basename, exactOriginal] of entries) {
    assert.match(basename, /^qa-retailer-operator-[a-z0-9-]+\.test\.mjs$/)
    assert.match(exactOriginal, /^[a-f0-9]{40}$/)
    const bytes = await readFile(new URL('./' + basename, import.meta.url))
    assert.ok(bytes.length > 200, 'original QA source must be substantial')
    assert.equal(gitBlobSha(bytes), exactOriginal,
      basename + ' source changed: no original RED-to-GREEN acceptance')
  }
})
