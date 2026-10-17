import assert from 'node:assert/strict'
import test from 'node:test'
import { createHash } from 'node:crypto'
import { once } from 'node:events'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createFileSyncStore } from '../server/sync-store.mjs'
import { createRecipeServer } from '../server/app.mjs'
import { validateSyncEntries } from '../server/sync-validation.mjs'

// Independent QA lane 1/2: genuine private disk + loopback API only.
// Complements #3809/#3823's poisoned-read probes by testing the WRITE path.
// An invalid persisted revision must never be silently overwritten and
// laundered into an acknowledged new revision. No real device or retailer.
const KEY = 'Y'.repeat(43)
const PLAN = 'supa:planner-preferences:v2'
const LIB = 'supa.recipe-library.v1'
const SHOP = 'supa:shopping-list-progress:v1'
const ORIGIN = 'http://supa-qa.local.invalid'
const oldPlan = JSON.stringify({ budget: 35, activeDays: ['Ma'], recipeByDay: {} })
const newPlan = JSON.stringify({ budget: 47, activeDays: ['Di'], recipeByDay: {} })
const updatedAt = '2026-10-17T00:00:00.000Z'
const valid = plan => ({ [PLAN]: plan, [LIB]: null, [SHOP]: null })

async function fixture(t, entries) {
  const root = await mkdtemp(join(tmpdir(), 'supa-qa-disk-write-boundary-'))
  const dir = join(root, 'sync')
  await mkdir(dir, { mode: 0o700 })
  const file = join(dir, createHash('sha256').update(KEY).digest('hex') + '.json')
  const original = JSON.stringify({ revision: 1, updatedAt, entries })
  await writeFile(file, original, { mode: 0o600 })
  t.after(() => rm(root, { recursive: true, force: true }))
  return { root, file, original, store: createFileSyncStore({ dir }) }
}

async function startServer(t, root, store) {
  const server = createRecipeServer({ root, origin: ORIGIN, syncStore: store })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  t.after(async () => {
    server.closeAllConnections()
    await new Promise(resolve => server.close(resolve))
  })
  return 'http://127.0.0.1:' + server.address().port + '/api/sync'
}

async function put(url, entries) {
  return fetch(url, {
    method: 'PUT',
    headers: {
      Authorization: 'Bearer ' + KEY,
      Origin: ORIGIN,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ baseRevision: 1, entries }),
  })
}

test('positive: valid private revision 1 still advances to revision 2 with a canonical update', async t => {
  const fixtureData = valid(oldPlan)
  const replacement = valid(newPlan)
  assert.equal(validateSyncEntries(fixtureData).error, undefined)
  assert.equal(validateSyncEntries(replacement).error, undefined)
  const { store } = await fixture(t, fixtureData)
  const saved = await store.write(KEY, 1, replacement)
  assert.equal(saved.conflict, false)
  assert.equal(saved.record.revision, 2)
  assert.deepEqual((await store.read(KEY)).entries, replacement)
})

test('P2 #3809: a corrupt persisted planner must not be silently overwritten by a direct valid CAS write', async t => {
  const poison = valid('{"budget":')
  assert.ok(validateSyncEntries(poison).error, 'poison must violate canonical app-record admission')
  const { store, file, original } = await fixture(t, poison)
  await assert.rejects(() => store.write(KEY, 1, valid(newPlan)),
    'writing revision 2 must reject a prior revision with invalid planner bytes')
  assert.equal(await readFile(file, 'utf8'), original,
    'an invalid prior revision must remain byte-for-byte untouched for explicit recovery')
})

test('P2 #3809: HTTP PUT may not acknowledge a replacement over corrupted private disk state', async t => {
  const poison = valid(JSON.stringify({ budget: -500, activeDays: ['Ma'], recipeByDay: {} }))
  assert.ok(validateSyncEntries(poison).error, 'semantic-invalid planner must be rejected by PUT validator')
  const replacement = valid(newPlan)
  assert.equal(validateSyncEntries(replacement).error, undefined)
  const { root, store, file, original } = await fixture(t, poison)
  const url = await startServer(t, root, store)
  const response = await put(url, replacement)
  assert.equal(response.status, 500,
    'the API must not acknowledge 200 for a new revision over an invalid on-disk predecessor')
  assert.deepEqual(await response.json(), { error: 'Je gegevens konden niet worden bewaard.' })
  assert.equal(await readFile(file, 'utf8'), original,
    'rejecting a corrupt prior revision must not erase its original private bytes')
})

test('positive: canonical HTTP PUT over a valid private revision still returns the next revision', async t => {
  const { root, store } = await fixture(t, valid(oldPlan))
  const url = await startServer(t, root, store)
  const response = await put(url, valid(newPlan))
  assert.equal(response.status, 200)
  const body = await response.json()
  assert.equal(body.revision, 2)
  assert.deepEqual((await store.read(KEY)).entries, valid(newPlan))
})
