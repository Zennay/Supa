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

// Independent QA1/2 after owner #3777 d155360: immutable P2 #3838
// Gregorian timestamp boundary and real HTTP 409 conflict admission.
// All disk bytes are fictional 0600 files in disposable 0700 directories.
// No retailer calls, production storage, accounts or customer information.
const KEY = 'Q'.repeat(43)
const ORIGIN = 'http://supa-qa.local.invalid'
const ENTRIES = {
  'supa:planner-preferences:v2': JSON.stringify({ budget: 35, activeDays: ['Ma'], recipeByDay: {} }),
  'supa.recipe-library.v1': null,
  'supa:shopping-list-progress:v1': null,
}

async function recordFixture(t, updatedAt) {
  assert.equal(validateSyncEntries(ENTRIES, { complete: true }).error, undefined,
    'all timestamp probes must use a fully application-valid complete record')
  const root = await mkdtemp(join(tmpdir(), 'supa-qa-timestamp-postfix-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const dir = join(root, 'sync')
  await mkdir(dir, { mode: 0o700 })
  const path = join(dir, createHash('sha256').update(KEY).digest('hex') + '.json')
  const original = JSON.stringify({ revision: 1, updatedAt, entries: ENTRIES })
  await writeFile(path, original, { mode: 0o600 })
  return { root, path, original, store: createFileSyncStore({ dir }) }
}

async function localApi(t, root, store) {
  const server = createRecipeServer({ root, origin: ORIGIN, syncStore: store })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  t.after(async () => {
    server.closeAllConnections()
    await new Promise(resolve => server.close(resolve))
  })
  return 'http://127.0.0.1:' + server.address().port + '/api/sync'
}

async function conflict(url) {
  return fetch(url, {
    method: 'PUT',
    headers: {
      Authorization: 'Bearer ' + KEY,
      Origin: ORIGIN,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ baseRevision: 0, entries: ENTRIES }),
  })
}

for (const valid of [
  '2000-02-29T23:59:59.999Z',
  '2024-02-29T00:00:00.000Z',
  '2026-10-17T00:00:00.000Z',
]) {
  test('positive: restore genuine canonical Gregorian UTC clock ' + valid, async t => {
    const { store } = await recordFixture(t, valid)
    const record = await store.read(KEY)
    assert.equal(record.revision, 1)
    assert.equal(record.updatedAt, valid)
    assert.deepEqual(record.entries, ENTRIES)
  })
}

for (const [description, invalid] of [
  ['nonleap century 1900-02-29', '1900-02-29T00:00:00.000Z'],
  ['nonleap century 2100-02-29', '2100-02-29T00:00:00.000Z'],
  ['31 April rollover', '2026-04-31T00:00:00.000Z'],
  ['24 hour rollover', '2026-10-17T24:00:00.000Z'],
  ['leap second 60', '2026-10-17T23:59:60.000Z'],
  ['six fractional places', '2026-10-17T00:00:00.000000Z'],
  ['lowercase UTC suffix', '2026-10-17T00:00:00.000z'],
  ['equivalent offset representation', '2026-10-17T01:00:00.000+01:00'],
  ['trailing whitespace', '2026-10-17T00:00:00.000Z '],
]) {
  test('P2 repaired boundary: reject ' + description + ' without rewriting original bytes', async t => {
    const { store, path, original } = await recordFixture(t, invalid)
    await assert.rejects(() => store.read(KEY), 'invalid disk-clock metadata must fail closed')
    assert.equal(await readFile(path, 'utf8'), original,
      'failure must preserve the original record for explicit recovery')
  })
}

test('positive: real HTTP 409 conflict may serve a complete canonical prior revision', async t => {
  const timestamp = '2024-02-29T23:59:59.999Z'
  const { root, store } = await recordFixture(t, timestamp)
  const url = await localApi(t, root, store)
  const response = await conflict(url)
  assert.equal(response.status, 409)
  assert.equal(response.headers.get('cache-control'), 'no-store')
  const body = await response.json()
  assert.equal(body.revision, 1)
  assert.equal(body.updatedAt, timestamp)
  assert.deepEqual(body.entries, ENTRIES)
})

test('P2 repaired boundary: real HTTP 409 cannot disclose malformed predecessor time', async t => {
  const { root, store, path, original } = await recordFixture(t, '2100-02-29T00:00:00.000Z')
  const url = await localApi(t, root, store)
  const response = await conflict(url)
  assert.equal(response.status, 500, 'invalid persisted conflict metadata must not be serialized')
  assert.deepEqual(await response.json(), { error: 'Je gegevens konden niet worden bewaard.' })
  assert.equal(await readFile(path, 'utf8'), original)
})
