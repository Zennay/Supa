import assert from 'node:assert/strict'
import test from 'node:test'
import { createHash } from 'node:crypto'
import { once } from 'node:events'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createRecipeServer } from '../server/app.mjs'
import { createFileSyncStore } from '../server/sync-store.mjs'
import { validateSyncEntries } from '../server/sync-validation.mjs'

// QA lane 1/2: two independent device keys share a real local file store.
// One tampered on-disk snapshot must not let either an invalid ACK rewrite
// its own forensic bytes or block an unrelated healthy device's progress.
// Fictional 0600 records and 127.0.0.1 only; NO retailer or customer data.
const KEY_BAD = 'M'.repeat(43)
const KEY_GOOD = 'N'.repeat(43)
const PLAN = 'supa:planner-preferences:v2'
const LIB = 'supa.recipe-library.v1'
const SHOP = 'supa:shopping-list-progress:v1'
const ORIGIN = 'http://supa-qa-device-isolation.invalid'
const planner = budget => JSON.stringify({ budget, activeDays: ['Ma'], recipeByDay: {} })
const entries = budget => ({ [PLAN]: planner(budget), [LIB]: null, [SHOP]: null })
const valid = entries(35)
const updated = entries(44)
const invalid = { ...valid, [SHOP]: JSON.stringify({
  schemaVersion: 1, basketKey: 'synthetic', doneLineIds: ['repeat', 'repeat'],
}) }
const timestamp = '2026-10-17T00:00:00.000Z'

async function setup(t) {
  assert.equal(validateSyncEntries(valid, { complete: true }).error, undefined)
  assert.equal(validateSyncEntries(updated, { complete: true }).error, undefined)
  assert.ok(validateSyncEntries(invalid, { complete: true }).error)
  const root = await mkdtemp(join(tmpdir(), 'supa-qa-device-corrupt-isolation-'))
  const dir = join(root, 'sync')
  await mkdir(dir, { mode: 0o700 })
  const fileFor = key => join(dir, createHash('sha256').update(key).digest('hex') + '.json')
  const body = (values) => JSON.stringify({ revision: 1, updatedAt: timestamp, entries: values })
  const originalBad = body(invalid)
  const originalGood = body(valid)
  await writeFile(fileFor(KEY_BAD), originalBad, { mode: 0o600 })
  await writeFile(fileFor(KEY_GOOD), originalGood, { mode: 0o600 })
  const server = createRecipeServer({
    root, origin: ORIGIN, syncStore: createFileSyncStore({ dir }),
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  t.after(async () => {
    server.closeAllConnections()
    await new Promise(resolve => server.close(resolve))
    await rm(root, { recursive: true, force: true })
  })
  return {
    url: 'http://127.0.0.1:' + server.address().port + '/api/sync',
    bad: fileFor(KEY_BAD), good: fileFor(KEY_GOOD), originalBad, originalGood,
  }
}

async function read(url, key) {
  return fetch(url, { headers: { Authorization: 'Bearer ' + key } })
}

async function write(url, key, baseRevision = 1) {
  return fetch(url, {
    method: 'PUT',
    headers: {
      Authorization: 'Bearer ' + key,
      Origin: ORIGIN,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ baseRevision, entries: updated }),
  })
}

test('positive: poisoned device GET fails privately while unrelated healthy device reads and advances', async t => {
  const x = await setup(t)
  const [bad, good] = await Promise.all([read(x.url, KEY_BAD), read(x.url, KEY_GOOD)])
  assert.equal(bad.status, 500)
  assert.deepEqual(await bad.json(), { error: 'Je gegevens konden niet worden bewaard.' })
  assert.equal(good.status, 200)
  const goodSnapshot = await good.json()
  assert.equal(goodSnapshot.revision, 1)
  assert.deepEqual(goodSnapshot.entries, valid)

  const saved = await write(x.url, KEY_GOOD)
  assert.equal(saved.status, 200)
  assert.equal((await saved.json()).revision, 2)
  assert.equal(JSON.parse(await readFile(x.good, 'utf8')).revision, 2)
  assert.equal(await readFile(x.bad, 'utf8'), x.originalBad,
    'the healthy neighbor must never alter or echo poisoned device evidence')
})

test('P2 #3809: simultaneous poisoned and healthy PUTs must isolate bad predecessor without losing healthy progress', async t => {
  const x = await setup(t)
  const [bad, good] = await Promise.all([
    write(x.url, KEY_BAD),
    write(x.url, KEY_GOOD),
  ])
  assert.equal(bad.status, 500,
    'invalid old app data must be refused even while another key makes progress')
  assert.deepEqual(await bad.json(), { error: 'Je gegevens konden niet worden bewaard.' })
  assert.equal(good.status, 200)
  assert.equal((await good.json()).revision, 2)
  assert.equal(await readFile(x.bad, 'utf8'), x.originalBad,
    'refusing a poison must preserve original disk bytes for explicit recovery')
  const healthy = JSON.parse(await readFile(x.good, 'utf8'))
  assert.equal(healthy.revision, 2)
  assert.deepEqual(healthy.entries, updated)
})

test('positive: zero-base CAS conflict never leaks an invalid persisted revision', async t => {
  const x = await setup(t)
  const resp = await write(x.url, KEY_BAD, 0)
  assert.equal(resp.status, 500)
  assert.deepEqual(await resp.json(), { error: 'Je gegevens konden niet worden bewaard.' })
  assert.equal(await readFile(x.bad, 'utf8'), x.originalBad)
  assert.equal(await readFile(x.good, 'utf8'), x.originalGood)
})
