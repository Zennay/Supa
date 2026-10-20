// SUPA independent quality-validation 1/2.
// Exhaustive order-invariance proof over ALL 6! = 720 permutations of the
// repository's six REAL, reviewed, HISTORICAL retailer source shapes.
// No live retailers, DNS, HTTP, customer data, current price or public savings.
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import { assessPrivateM3RetailerIngestion } from '../scripts/retailer-private-m3-ingestion-preflight.mjs'
import { loadReviewedRepositoryFixtures } from '../scripts/retailer-reviewed-ingest-engine.mjs'

const AT = '2026-10-15T10:00:00.000Z'

function * permutations(rows, from = 0) {
  if (from === rows.length) {
    yield rows.slice()
    return
  }
  for (let i = from; i < rows.length; i++) {
    ;[rows[from], rows[i]] = [rows[i], rows[from]]
    yield * permutations(rows, from + 1)
    ;[rows[from], rows[i]] = [rows[i], rows[from]]
  }
}

test('exhaustive 720 input orders preserve the same private historical source report', {
  timeout: 120_000,
}, async () => {
  const rights = JSON.parse(await readFile(
    new URL('../evidence/m1/source-permission-gate.v1.json', import.meta.url), 'utf8'))
  const batch = await loadReviewedRepositoryFixtures()
  assert.equal(batch.results.length, 6, 'the scope is exactly six reviewed archived shapes')
  assert.equal(new Set(batch.results.map(x => x.key)).size, 6)

  const rightsBefore = JSON.stringify(rights)
  const batchBefore = JSON.stringify(batch)
  const original = assessPrivateM3RetailerIngestion(rights, batch, {
    referenceTime: AT,
  })
  const expected = JSON.stringify(original)
  assert.equal(original.releaseDecision, 'hold')
  assert.equal(original.publicSavingsClaimEligible, false)
  assert.equal(original.permissionVerified, false)
  assert.equal(original.productionEnabled, false)
  assert.equal(original.liveRequests, 0)

  let reviewed = 0
  const indexes = [0, 1, 2, 3, 4, 5]
  for (const perm of permutations(indexes)) {
    const scrambled = {
      ...batch,
      results: perm.map(index => batch.results[index]),
    }
    const inputBefore = JSON.stringify(scrambled)
    const actual = assessPrivateM3RetailerIngestion(rights, scrambled, {
      referenceTime: AT,
    })
    const observed = JSON.stringify(actual)
    assert.equal(observed, expected,
      `private historical report differs at input permutation ${perm.join(',')}`)
    assert.equal(JSON.stringify(scrambled), inputBefore,
      `source graph mutated at permutation ${perm.join(',')}`)
    reviewed++
  }
  assert.equal(reviewed, 720, '6! source orderings must all be checked')
  assert.equal(JSON.stringify(batch), batchBefore)
  assert.equal(JSON.stringify(rights), rightsBefore)
})
