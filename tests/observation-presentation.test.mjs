import assert from 'node:assert/strict'
import test from 'node:test'

import { observationRetailerCopy } from '../src/features/observation/observationPresentation.ts'

test('observation retailer copy explains the PLUS first-store step in plain language', () => {
  assert.deepEqual(observationRetailerCopy('baseline'), {
    eyebrow: 'Eerste winkel · PLUS',
    expectedRetailer: 'PLUS',
    emptyStoreLabel: 'PLUS nog niet ingevuld',
    storePlaceholder: 'Bijv. PLUS Leiden',
    storeIdPlaceholder: 'plus-leiden-...',
    guidance:
      'Meet deze mand eerst bij PLUS. Gebruik hier geen andere supermarkt, anders kan SUPA de winkels niet betrouwbaar vergelijken.',
  })
})

test('observation retailer copy explains the DekaMarkt comparison step in plain language', () => {
  assert.deepEqual(observationRetailerCopy('candidate'), {
    eyebrow: 'Vergelijkwinkel · DekaMarkt',
    expectedRetailer: 'DekaMarkt',
    emptyStoreLabel: 'DekaMarkt nog niet ingevuld',
    storePlaceholder: 'Bijv. DekaMarkt Leiden',
    storeIdPlaceholder: 'dekamarkt-leiden-...',
    guidance:
      'Meet daarna dezelfde mand bij DekaMarkt. Gebruik hier geen andere supermarkt, anders kan SUPA de winkels niet betrouwbaar vergelijken.',
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
