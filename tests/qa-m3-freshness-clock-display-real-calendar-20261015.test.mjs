import assert from 'node:assert/strict'
import test from 'node:test'
import { renderPrivateComparison } from '../scripts/retailer-show-private-comparison.mjs'

// Independent QA 2/2. Human source freshness must never present a
// syntactically ISO-looking yet impossible clock as a verified capture date.
// These are direct renderer boundary cases, not unauthorized retailer data.
const valid = '2026-10-15T09:00:00Z'
function noMoneyReport(clocks) {
  return {
    format: 'supa-local-snapshot-comparison-v1',
    captureSummary: [
      { supermarket: 'plus', parsedProducts: 0, capturedAt: clocks[0] },
      { supermarket: 'dekamarkt', parsedProducts: 0, capturedAt: clocks[1] },
    ],
    comparison: {
      provenance: 'offline-snapshot-preview', claimable: false,
      comparable: false, cheaperStore: null, savingsCents: null,
      stores: {
        plus: { complete: false, subtotalCents: null },
        dekamarkt: { complete: false, subtotalCents: null },
      },
      lines: [],
    },
  }
}
for (const [name, invalid] of [
  ['nonexistent February 30', '2026-02-30T10:00:00Z'],
  ['invalid UTC offset +23:59', '2026-10-15T10:00:00+23:59'],
  ['invalid UTC offset +14:01', '2026-10-15T10:00:00+14:01'],
  ['invalid 25th hour', '2026-10-15T25:00:00Z'],
  ['invalid 60th minute', '2026-10-15T10:60:00Z'],
  ['invalid 60th second', '2026-10-15T10:00:60Z'],
]) {
  for (const [side, clocks] of [
    ['PLUS', [invalid, valid]],
    ['DekaMarkt', [valid, invalid]],
  ]) {
    test('QA M3 recorded source clock suppresses ' + name + ' on ' + side, () => {
      const input = noMoneyReport(clocks)
      const before = JSON.stringify(input)
      const out = renderPrivateComparison(input)
      assert.doesNotMatch(out, new RegExp(invalid.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
        'impossible provenance must not be presented as a recorded timestamp')
      assert.match(out, /registratietijd onbekend|onbetrouwbare registratietijd|ongeldige registratietijd/i)
      assert.match(out, /GEEN LIVE PRIJZEN/)
      assert.doesNotMatch(out, /ALLEEN OFFLINE MANDVERSCHIL/)
      assert.equal(JSON.stringify(input), before)
    })
  }
}
for (const timestamp of [
  valid,
  '2026-10-15T11:00:00+02:00',
  '2026-10-15T04:00:00-05:00',
  '2026-10-15T09:00:00.123456789Z',
]) {
  test('QA M3 exact real absolute source clock remains visible: ' + timestamp, () => {
    const report = noMoneyReport([timestamp, valid])
    const out = renderPrivateComparison(report)
    assert.ok(out.includes('vastgelegd ' + timestamp))
    assert.match(out, /GEEN VOLLEDIGE MANDVERGELIJKING/)
    assert.doesNotMatch(out, /ALLEEN OFFLINE MANDVERSCHIL/)
  })
}
test('QA M3 absent capture timestamp remains explicitly unknown', () => {
  const out = renderPrivateComparison(noMoneyReport([null, valid]))
  assert.match(out, /PLUS: 0 productobservaties · vastgelegd registratietijd onbekend/)
  assert.match(out, /DekaMarkt: 0 productobservaties · vastgelegd /)
})
