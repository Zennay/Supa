import assert from 'node:assert/strict'
import test from 'node:test'

import { observationRetailerCopy } from '../src/features/observation/observationPresentation.ts'

test('observation retailer copy pins the canonical PLUS baseline', () => {
  assert.deepEqual(observationRetailerCopy('baseline'), {
    eyebrow: 'Baseline · PLUS',
    expectedRetailer: 'PLUS',
    emptyStoreLabel: 'PLUS nog niet ingevuld',
    storePlaceholder: 'Bijv. PLUS Leiden',
    storeIdPlaceholder: 'plus-leiden-...',
    guidance:
      'Voor deze M3-meting hoort de baseline bij PLUS. Een andere supermarkt wordt door de preflight geweigerd.',
  })
})

test('observation retailer copy pins the canonical DekaMarkt comparison side', () => {
  assert.deepEqual(observationRetailerCopy('candidate'), {
    eyebrow: 'Vergelijking · DekaMarkt',
    expectedRetailer: 'DekaMarkt',
    emptyStoreLabel: 'DekaMarkt nog niet ingevuld',
    storePlaceholder: 'Bijv. DekaMarkt Leiden',
    storeIdPlaceholder: 'dekamarkt-leiden-...',
    guidance:
      'Voor deze M3-meting hoort de vergelijking bij DekaMarkt. Een andere supermarkt wordt door de preflight geweigerd.',
  })
})

test('observation retailer copy rejects an unknown runtime side', () => {
  assert.throws(
    () => observationRetailerCopy('baseline-copy' ),
    /Unknown M3 observation side/,
  )
})
