import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createFileSyncStore } from '../server/sync-store.mjs'

// The newer device-sync feature is a DRAFT product branch. This independent
// QA file uses only synthetic local records. It does not touch any person's
// real data, M3 retailer artifacts, HTTP, permission register or network.
const KEY = 'Q'.repeat(43)
const A = { 'supa:planner-preferences:v2': '{"fixture":"tab-a"}' }
const B = { 'supa:planner-preferences:v2': '{"fixture":"tab-b"}' }

async function disposable(t) {
  const root = await mkdtemp(join(tmpdir(), 'supa-sync-optimistic-qa-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  return join(root, 'sync')
}

test('positive control: serial writes with one store instance preserve 409 conflict semantics', async t => {
  const dir = await disposable(t)
  const store = createFileSyncStore({ dir })
  const first = await store.write(KEY, 0, A)
  assert.equal(first.conflict, false)
  assert.equal(first.record.revision, 1)
  const stale = await store.write(KEY, 0, B)
  assert.equal(stale.conflict, true)
  assert.equal(stale.record.revision, 1)
  assert.deepEqual((await store.read(KEY)).entries, A)
})

test('P1 sync: separate server/store instances sharing one data directory must not both accept baseRevision=0', async t => {
  const dir = await disposable(t)
  // Two independent Node request handlers or processes have distinct in-memory
  // queues even when they share exactly the same on-disk sync directory.
  const a = createFileSyncStore({ dir })
  const b = createFileSyncStore({ dir })
  const [fromA, fromB] = await Promise.all([
    a.write(KEY, 0, A),
    b.write(KEY, 0, B),
  ])
  const winning = [fromA, fromB].filter(result => !result.conflict)
  const rejected = [fromA, fromB].filter(result => result.conflict)
  assert.equal(winning.length, 1,
    'only one tab/process may win an optimistic baseRevision=0 CAS; two successes silently lose one valid edit')
  assert.equal(rejected.length, 1,
    'the stale writer must receive conflict, never a second acknowledged revision=1')
  assert.equal(winning[0].record.revision, 1)
  const persisted = await a.read(KEY)
  assert.equal(persisted.revision, 1)
  assert.deepEqual(persisted.entries, winning[0].record.entries,
    'persisted state must exactly match the one acknowledged winning edit')
})

test('P1 sync: independent stores at revision 1 must still implement one global compare-and-swap', async t => {
  const dir = await disposable(t)
  const a = createFileSyncStore({ dir })
  const b = createFileSyncStore({ dir })
  const initial = await a.write(KEY, 0, A)
  assert.equal(initial.conflict, false)
  assert.equal(initial.record.revision, 1)

  const newerA = { 'supa:planner-preferences:v2': '{"fixture":"revision2-A"}' }
  const newerB = { 'supa:planner-preferences:v2': '{"fixture":"revision2-B"}' }
  const [fromA, fromB] = await Promise.all([
    a.write(KEY, 1, newerA),
    b.write(KEY, 1, newerB),
  ])
  const winning = [fromA, fromB].filter(result => !result.conflict)
  assert.equal(winning.length, 1,
    'independent sync instances must not both acknowledge revision=2 and discard one user edit')
  const state = await b.read(KEY)
  assert.equal(state.revision, 2)
  assert.deepEqual(state.entries, winning[0].record.entries)
})
