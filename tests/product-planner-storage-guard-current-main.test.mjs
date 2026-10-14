import assert from 'node:assert/strict'
import test from 'node:test'
import { canReplacePlannerRecord, persistPlannerRecord } from '../src/features/planner/plannerStorageGuard.ts'

const days = ['Ma', 'Di']
const ids = ['tikka', 'pasta']
const valid = JSON.stringify({ budget: 27.5, activeDays: ['Ma'], recipeByDay: { Ma: 'tikka', Di: 'pasta' } })
const next = JSON.stringify({ budget: 35, activeDays: ['Ma', 'Di'], recipeByDay: { Ma: 'pasta', Di: 'tikka' } })

function disk(initial = valid) {
  let raw = initial
  const writes = []
  let denyRead = false
  let denyWrite = false
  return {
    writes,
    get raw() { return raw },
    set raw(v) { raw = v },
    set denyRead(v) { denyRead = v },
    set denyWrite(v) { denyWrite = v },
    read() { if (denyRead) throw Error('private read'); return raw },
    write(v) { if (denyWrite) throw Error('private write'); writes.push(v); raw = v },
  }
}
function save(d, expectedRaw, nextRaw = next) {
  return persistPlannerRecord({
    read: () => d.read(), write: (raw) => d.write(raw),
    expectedRaw, nextRaw, validDays: days, validRecipeIds: ids,
  })
}

test('supported v2 money/day/catalog records pass; unknown future or malformed records never admit replacement', () => {
  assert.equal(canReplacePlannerRecord(valid, days, ids), true)
  assert.equal(canReplacePlannerRecord(null, days, ids), true)
  for (const raw of [
    '', '{}', 'null', '[]', '{', '{"version":3}', '{"budget":null,"activeDays":[],"recipeByDay":{}}',
    JSON.stringify({ budget: 1.005, activeDays: ['Ma'], recipeByDay: {} }),
    JSON.stringify({ budget: 1001, activeDays: ['Ma'], recipeByDay: {} }),
    JSON.stringify({ budget: 35, activeDays: ['Ma', 'Ma'], recipeByDay: {} }),
    JSON.stringify({ budget: 35, activeDays: ['Zo'], recipeByDay: {} }),
    JSON.stringify({ budget: 35, activeDays: ['Ma'], recipeByDay: { Ma: 'future' } }),
    JSON.stringify({ budget: 35, activeDays: ['Ma'], recipeByDay: {}, version: 3 }),
  ]) assert.equal(canReplacePlannerRecord(raw, days, ids), false, String(raw))
})

test('same stored bytes are not re-written; explicit valid changes persist', () => {
  const d = disk()
  assert.deepEqual(save(d, valid, valid), { status: 'saved', raw: valid })
  assert.equal(d.writes.length, 0)
  assert.deepEqual(save(d, valid), { status: 'saved', raw: next })
  assert.deepEqual(d.writes, [next])
})

test('read denial, write denial and new concurrent bytes fail closed without overwriting', () => {
  const d = disk()
  d.denyRead = true
  assert.equal(save(d, valid).status, 'unavailable')
  assert.equal(d.writes.length, 0)
  d.denyRead = false
  d.denyWrite = true
  assert.equal(save(d, valid).status, 'unavailable')
  assert.equal(d.raw, valid)
  d.denyWrite = false
  d.raw = '{"schemaVersion":3,"future":"preserve exactly"}'
  assert.equal(save(d, valid).status, 'protected')
  assert.equal(d.raw, '{"schemaVersion":3,"future":"preserve exactly"}')
  assert.equal(d.writes.length, 0)
})

test('initial no-record state can be saved but may not clobber unseen values', () => {
  const d = disk(null)
  assert.equal(save(d, null).status, 'saved')
  assert.equal(d.raw, next)
  const other = disk(valid)
  assert.equal(save(other, null).status, 'protected')
  assert.equal(other.raw, valid)
  assert.equal(other.writes.length, 0)
})
