import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { once } from 'node:events'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { createRecipeServer } from '../server/app.mjs'
import { createFileSyncStore } from '../server/sync-store.mjs'
import { validateSyncEntries } from '../server/sync-validation.mjs'

// Independent, add-only QA on product-owner #3777 exact source 9fc1532.
// A synthetic local tamper must not silently promote unreadable per-key app
// bytes merely because the outer JSON envelope has three allowlisted keys.
// No retailer/live customer data, no external network, no real VPS changes.
const DEVICE = 'S'.repeat(43)
const PLAN = 'supa:planner-preferences:v2'
const LIBRARY = 'supa.recipe-library.v1'
const SHOP = 'supa:shopping-list-progress:v1'
const ORIGIN = 'https://synthetic-only.supa.example.test'
const validPlanner = JSON.stringify({ budget: 35, activeDays: ['Ma'], recipeByDay: {} })
const validShopping = JSON.stringify({ schemaVersion: 1, basketKey: 'fictional-basket', doneLineIds: ['fictional-one'] })
const good = () => ({ [PLAN]: validPlanner, [LIBRARY]: null, [SHOP]: validShopping })
const poisoned = key => {
  const entries = good()
  if (key === PLAN) entries[PLAN] = '{"budget":'
  if (key === LIBRARY) entries[LIBRARY] = '{"version":999,"recipes":[]}'
  if (key === SHOP) entries[SHOP] = JSON.stringify({
    schemaVersion: 1, basketKey: 'fictional-basket', doneLineIds: ['duplicate', 'duplicate'],
  })
  return entries
}

async function fixture(t, entries) {
  const root = await mkdtemp(join(tmpdir(), 'supa-qa-semantic-sync-read-'))
  const dir = join(root, 'sync')
  await mkdir(dir, { mode: 0o700 })
  const file = join(dir, createHash('sha256').update(DEVICE).digest('hex') + '.json')
  await writeFile(file, JSON.stringify({
    revision: 1, updatedAt: '2026-10-17T00:00:00.000Z', entries,
  }), { mode: 0o600 })
  t.after(() => rm(root, { recursive: true, force: true }))
  return { root, dir, store: createFileSyncStore({ dir }) }
}

test('positive: a private single-link on-disk snapshot with valid browser records remains readable', async t => {
  const entries = good()
  assert.equal(validateSyncEntries(entries).error, undefined,
    'fixture must be semantically valid under canonical PUT-side validation')
  const { store } = await fixture(t, entries)
  const restored = await store.read(DEVICE)
  assert.deepEqual(restored.entries, entries)
  assert.equal(restored.revision, 1)
})

for (const [key, label] of [
  [PLAN, 'malformed planner'],
  [LIBRARY, 'unsupported own-recipe library'],
  [SHOP, 'duplicate shopping-progress identifiers'],
]) {
  test(`P2: stored ${label} must fail the same semantic admission gate as sync PUT`, async t => {
    const entries = poisoned(key)
    assert.ok(validateSyncEntries(entries).error,
      'the production-facing validator must recognize the poisoned synthetic entry')
    const { store } = await fixture(t, entries)
    await assert.rejects(() => store.read(DEVICE),
      'valid outer JSON and trusted mode are insufficient for invalid application records')
  })
}

test('P2: a browser GET cannot receive a private persisted record with invalid planner JSON', async t => {
  const entries = poisoned(PLAN)
  const { root, store } = await fixture(t, entries)
  const server = createRecipeServer({ root, origin: ORIGIN, syncStore: store })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  t.after(async () => {
    server.closeAllConnections()
    await new Promise(resolve => server.close(resolve))
  })
  const url = 'http://127.0.0.1:' + server.address().port + '/api/sync'
  const response = await fetch(url, { headers: { Authorization: 'Bearer ' + DEVICE } })
  assert.equal(response.status, 500,
    'corrupt local app records must fail closed before being serialized in the sync API')
  assert.deepEqual(await response.json(), { error: 'Je gegevens konden niet worden bewaard.' })
})
