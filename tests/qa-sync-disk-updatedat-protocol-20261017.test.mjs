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

// QA 1/2: independent, add-only persisted sync-clock integrity checks.
// A server writes canonical Date#toISOString timestamps. Disk data must not
// launder an arbitrary string into trusted revision metadata on GET or PUT.
// Synthetic private tmpdir and optional 127.0.0.1 ONLY; no real user/retailer.
const KEY = 'W'.repeat(43)
const ORIGIN = 'http://supa-qa.local.invalid'
const CANONICAL = '2026-10-17T00:00:00.000Z'
const entries = {
  'supa:planner-preferences:v2': JSON.stringify({ budget: 35, activeDays: ['Ma'], recipeByDay: {} }),
  'supa.recipe-library.v1': null,
  'supa:shopping-list-progress:v1': null,
}

async function fixture(t, updatedAt = CANONICAL) {
  assert.equal(validateSyncEntries(entries, { complete: true }).error, undefined,
    'the fixture must contain independently valid app entries')
  const root = await mkdtemp(join(tmpdir(), 'supa-qa-sync-disk-clock-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const dir = join(root, 'sync')
  await mkdir(dir, { mode: 0o700 })
  const file = join(dir, createHash('sha256').update(KEY).digest('hex') + '.json')
  const original = JSON.stringify({ revision: 1, updatedAt, entries })
  await writeFile(file, original, { mode: 0o600 })
  return { root, file, original, store: createFileSyncStore({ dir }) }
}

async function http(t, root, store) {
  const server = createRecipeServer({ root, origin: ORIGIN, syncStore: store })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  t.after(async () => {
    server.closeAllConnections()
    await new Promise(resolve => server.close(resolve))
  })
  return 'http://127.0.0.1:' + server.address().port + '/api/sync'
}

test('positive: a valid UTC millisecond timestamp remains a readable private revision', async t => {
  const { store } = await fixture(t)
  const record = await store.read(KEY)
  assert.equal(record.updatedAt, CANONICAL)
  assert.equal(record.revision, 1)
  assert.deepEqual(record.entries, entries)
})

test('positive: a canonical private record remains servable over genuine local HTTP', async t => {
  const { root, store } = await fixture(t)
  const url = await http(t, root, store)
  const response = await fetch(url, { headers: { Authorization: 'Bearer ' + KEY } })
  assert.equal(response.status, 200)
  const body = await response.json()
  assert.equal(body.updatedAt, CANONICAL)
  assert.deepEqual(body.entries, entries)
})

for (const [label, timestamp] of [
  ['arbitrary non-date text', 'not-a-timestamp'],
  ['impossible Gregorian day', '2026-02-30T00:00:00.000Z'],
  ['timezone-offset alias', '2026-10-17T01:00:00.000+01:00'],
  ['missing timezone suffix', '2026-10-17T00:00:00.000'],
]) {
  test('P2 disk metadata: refuse ' + label + ' in persisted updatedAt', async t => {
    const { store, file, original } = await fixture(t, timestamp)
    await assert.rejects(() => store.read(KEY),
      'a record not emitted by the canonical Date#toISOString writer must not be trusted')
    assert.equal(await readFile(file, 'utf8'), original,
      'refusing untrusted clock metadata must not erase evidence')
  })
}

test('P2 real HTTP GET must not publish malformed persisted updatedAt as verified device metadata', async t => {
  const { root, store } = await fixture(t, 'synthetic-not-a-date')
  const url = await http(t, root, store)
  const response = await fetch(url, { headers: { Authorization: 'Bearer ' + KEY } })
  assert.equal(response.status, 500,
    'invalid private disk metadata must fail closed before reaching the response')
  assert.deepEqual(await response.json(), { error: 'Je gegevens konden niet worden bewaard.' })
})

test('P2 real HTTP PUT must not erase invalid timestamp history with an acknowledged CAS revision', async t => {
  const { root, store, file, original } = await fixture(t, '2026-02-30T00:00:00.000Z')
  const url = await http(t, root, store)
  const response = await fetch(url, {
    method: 'PUT',
    headers: {
      Authorization: 'Bearer ' + KEY,
      Origin: ORIGIN,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ baseRevision: 1, entries }),
  })
  assert.equal(response.status, 500,
    'a client must not be told malformed predecessor metadata was a valid CAS revision')
  assert.deepEqual(await response.json(), { error: 'Je gegevens konden niet worden bewaard.' })
  assert.equal(await readFile(file, 'utf8'), original,
    'untrusted original bytes must remain intact for explicit recovery')
})
