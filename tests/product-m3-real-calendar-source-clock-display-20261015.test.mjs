import test from 'node:test'
import assert from 'node:assert/strict'
import { renderPrivateComparison } from '../scripts/retailer-show-private-comparison.mjs'

const at = '2026-10-15T09:00:00Z'
function fixture(left, right = at) {
  return { format: 'supa-local-snapshot-comparison-v1',
    captureSummary: [{supermarket:'plus',parsedProducts:0,capturedAt:left},
      {supermarket:'dekamarkt',parsedProducts:0,capturedAt:right}],
    comparison: { provenance:'offline-snapshot-preview',claimable:false,
      comparable:false,cheaperStore:null,savingsCents:null,
      stores:{plus:{subtotalCents:null,complete:false},
        dekamarkt:{subtotalCents:null,complete:false}},
      lines:[{ingredient:'fictieve melk', plus:{status:'unknown'},
        dekamarkt:{status:'unknown'}, differenceCents:null}],
    },
  }
}
for(const bad of [
  '2026-02-30T10:00:00Z','2026-10-15T10:00:00+23:59',
  '2026-10-15T10:00:00+14:01','2026-10-15T25:00:00Z',
  '2026-10-15T10:60:00Z','2026-10-15T10:00:60Z',
  '2025-02-29T10:00:00Z','2026-04-31T10:00:00Z',
  '2026-10-15T10:00:00','2026-10-15',
]) {
  for(const location of ['plus','deka']) {
    test('M3 operator rejects impossible true-calendar instant '+bad+' on '+location,()=>{
      const report=location==='plus'?fixture(bad):fixture(at,bad)
      const before=JSON.stringify(report)
      const view=renderPrivateComparison(report)
      assert.ok(view.includes('registratietijd onbekend'))
      const affectedShop = location === 'plus' ? 'PLUS:' : 'DekaMarkt:'
      const affectedLine = view.split(String.fromCharCode(10)).find(x => x.includes(affectedShop))
      assert.ok(affectedLine?.includes('vastgelegd registratietijd onbekend'))
      assert.equal(affectedLine?.includes(bad), false)
      assert.equal(JSON.stringify(report),before)
      assert.equal(view.includes('ALLEEN OFFLINE MANDVERSCHIL'),false)
    })
  }
}
for(const good of [at,'2026-02-28T23:59:59Z','2024-02-29T10:00:00Z',
  '2026-10-15T11:00:00+02:00','2026-10-15T04:00:00-05:00',
  '2026-10-15T09:00:00.123456789Z','2026-10-15T09:00:00+14:00']) {
  test('M3 operator preserves genuine absolute source instant '+good,()=>{
    assert.ok(renderPrivateComparison(fixture(good)).includes('vastgelegd '+good))
  })
}
