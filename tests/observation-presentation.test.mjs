import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import { M3_EXPECTED_RETAILERS } from '../src/domain/m3ObservationSheet.ts'
import { observationRetailerCopy } from '../src/features/observation/observationPresentation.ts'

test('observation retailer copy explains the PLUS first-store step in plain language', () => {
  assert.deepEqual(observationRetailerCopy('baseline'), {
    eyebrow: 'Eerste winkel · PLUS',
    expectedRetailer: M3_EXPECTED_RETAILERS.baseline,
    emptyStoreLabel: `${M3_EXPECTED_RETAILERS.baseline} nog niet ingevuld`,
    storePlaceholder: `Bijv. ${M3_EXPECTED_RETAILERS.baseline} Leiden`,
    storeIdPlaceholder: `${M3_EXPECTED_RETAILERS.baseline.toLowerCase()}-leiden-...`,
    guidance:
      `Meet deze mand eerst bij ${M3_EXPECTED_RETAILERS.baseline}. Gebruik hier geen andere supermarkt, anders kan SUPA de winkels niet betrouwbaar vergelijken.`,
  })
})

test('observation retailer copy explains the DekaMarkt comparison step in plain language', () => {
  assert.deepEqual(observationRetailerCopy('candidate'), {
    eyebrow: 'Vergelijkwinkel · DekaMarkt',
    expectedRetailer: M3_EXPECTED_RETAILERS.candidate,
    emptyStoreLabel: `${M3_EXPECTED_RETAILERS.candidate} nog niet ingevuld`,
    storePlaceholder: `Bijv. ${M3_EXPECTED_RETAILERS.candidate} Leiden`,
    storeIdPlaceholder: `${M3_EXPECTED_RETAILERS.candidate.toLowerCase()}-leiden-...`,
    guidance:
      `Meet daarna dezelfde mand bij ${M3_EXPECTED_RETAILERS.candidate}. Gebruik hier geen andere supermarkt, anders kan SUPA de winkels niet betrouwbaar vergelijken.`,
  })
})

test('observation retailer user-facing copy does not expose internal milestone jargon', () => {
  for (const side of ['baseline', 'candidate']) {
    const copy = observationRetailerCopy(side)
    const visibleCopy = [
      copy.eyebrow,
      copy.expectedRetailer,
      copy.emptyStoreLabel,
      copy.storePlaceholder,
      copy.guidance,
    ].join(' ')

    assert.doesNotMatch(visibleCopy, /\bM3\b|\bpreflight\b|\bbaseline\b/i)
  }
})

test('observation retailer copy rejects an unknown runtime side', () => {
  assert.throws(
    () => observationRetailerCopy('baseline-copy'),
    /Unknown M3 observation side/,
  )
})

test('observation presentation source does not duplicate canonical retailer brand names', async () => {
  const source = await readFile(
    new URL('../src/features/observation/observationPresentation.ts', import.meta.url),
    'utf8',
  )
  const normalizedSource = source.toLocaleLowerCase('nl-NL')

  for (const retailer of Object.values(M3_EXPECTED_RETAILERS)) {
    assert.equal(
      normalizedSource.includes(retailer.toLocaleLowerCase('nl-NL')),
      false,
      `retailer literal must come from M3_EXPECTED_RETAILERS: ${retailer}`,
    )
  }
})
