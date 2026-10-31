import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { ingestReviewedEvidence } from '../scripts/retailer-reviewed-ingest-engine.mjs'

// Six authentic, already-reviewed historical PLUS/DekaMarkt sources; no
// network, fabricated prices, permission changes or field collection.
// Keep absolute physical capture time identical when changing only its offset.
const files = [
  'plus-rendered-product-halfvolle-melk.v1.json',
  'plus-rendered-catalog.v1.json',
  'plus-rendered-offers.v1.json',
  'dekamarkt-product-halfvolle-melk.v1.json',
  'dekamarkt-catalog-melk.v1.json',
  'dekamarkt-offers.v1.json',
]

function sameInstantInOffset(original, minutes) {
  const shifted = new Date(Date.parse(original) + minutes * 60_000)
    .toISOString().replace(/Z$/, '')
  const sign = minutes < 0 ? '-' : '+'
  const magnitude = Math.abs(minutes)
  return shifted + sign + String(Math.floor(magnitude / 60)).padStart(2, '0') +
    ':' + String(magnitude % 60).padStart(2, '0')
}

for (const file of files) {
  test('product adapter UTC provenance: ' + file, async () => {
    const original = JSON.parse(await readFile(new URL('../fixtures/m1/' + file, import.meta.url), 'utf8'))
    const initial = ingestReviewedEvidence(original)
    assert.equal(initial.accepted, true, 'original reviewed historical fixture still accepted')

    for (const minutes of [0, 60, 330, 345, -300, -690, 840, -720]) {
      const candidate = structuredClone(original)
      candidate.source.capturedAt = sameInstantInOffset(original.source.capturedAt, minutes)
      const result = ingestReviewedEvidence(candidate)
      assert.equal(result.accepted, true,
        file + ': legitimate ' + candidate.source.capturedAt + ' preserves same absolute capture event')
      assert.equal(result.observations.every(row =>
        row.provenance.capturedAt === candidate.source.capturedAt), true)
    }

    for (const minutes of [841, -750, -840, -841, 900, -900, 1380, -1439]) {
      const candidate = structuredClone(original)
      candidate.source.capturedAt = sameInstantInOffset(original.source.capturedAt, minutes)
      const result = ingestReviewedEvidence(candidate)
      assert.equal(result.accepted, false,
        file + ': impossible UTC offset must never admit a historical product or price')
      assert.deepEqual(result.observations, [])
      assert.equal(result.reason, 'adapter-abstained')
    }
  })
}
