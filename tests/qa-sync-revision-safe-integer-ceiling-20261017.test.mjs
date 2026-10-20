import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { once } from 'node:events'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { createFileSyncStore } from '../server/sync-store.mjs'
import { createRecipeServer } from '../server/app.mjs'
import { validateSyncEntries } from '../server/sync-validation.mjs'

// Independent QA1; all data is synthetic in disposable private temp dirs.
// A restored valid safe-integer revision must never advance into an unsafe
// integer and produce an unreadable record / an HTTP 200 false save ACK.
const DEVICE = 'R'.repeat(43)
const ORIGIN = 'https://synthetic-revision-ceiling.example.test'
const PLAN = 'supa:planner-preferences:v2'
const LIBRARY = 'supa.recipe-library.v1'
const SHOP = 'supa:shopping-list-progress:v1'
const entries = () => ({
  [PLAN]: JSON.stringify({ budget: 35, activeDays: ['Ma'], recipeByDay: {} }),
  [LIBRARY]: null,
  [SHOP]: null,
})
const fileName = createHash('sha256').update(DEVICE).digest('hex') + '.json'

async function fixture(t, revision) {
  const root = await mkdtemp(join(tmpdir(), 'supa-qa-revision-ceiling-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const dir = join(root, 'sync')
  await mkdir(dir, { mode: 0o700 })
  const file = join(dir, fileName)
  const value = { revision, updatedAt: '2026-10-17T00:00:00.000Z', entries: entries() }
  await writeFile(file, JSON.stringify(value), { mode: 0o600 })
  const store = createFileSyncStore({ dir })
  return { root, dir, file, store }
}

async function serverFor(t, root, store) {
  const server = createRecipeServer({ root, origin: ORIGIN, syncStore: store })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  t.after(async () => {
    server.closeAllConnections()
    await new Promise(resolve => server.close(resolve))
  })
  return 'http://127.0.0.1:' + server.address().port + '/api/sync'
}

test('positive: a full private record at the penultimate safe revision remains readable', async t => {
  const { store } = await fixture(t, Number.MAX_SAFE_INTEGER - 1)
  assert.equal(validateSyncEntries(entries(), { complete: true }).error, undefined)
  assert.equal((await store.read(DEVICE)).revision, Number.MAX_SAFE_INTEGER - 1)
})

test('positive: the penultimate safe revision can be committed to the final safe revision exactly', async t => {
  const { file, store } = await fixture(t, Number.MAX_SAFE_INTEGER - 1)
  const result = await store.write(DEVICE, Number.MAX_SAFE_INTEGER - 1, entries())
  assert.equal(result.conflict, false)
  assert.equal(result.record.revision, Number.MAX_SAFE_INTEGER)
  assert.equal((await store.read(DEVICE)).revision, Number.MAX_SAFE_INTEGER)
  assert.equal(JSON.parse(await readFile(file, 'utf8')).revision, Number.MAX_SAFE_INTEGER)
})

test('P2: a full valid record at MAX_SAFE_INTEGER refuses overflow without modifying its bytes', async t => {
  const { file, dir, store } = await fixture(t, Number.MAX_SAFE_INTEGER)
  const original = await readFile(file)
  await assert.rejects(
    store.write(DEVICE, Number.MAX_SAFE_INTEGER, entries()),
    /revision|safe|limit|overflow|exhaust/i,
    'the final valid safe revision must not be incremented past Number.MAX_SAFE_INTEGER',
  )
  assert.deepEqual(await readFile(file), original)
  assert.equal((await store.read(DEVICE)).revision, Number.MAX_SAFE_INTEGER)
  assert.deepEqual(await readdir(dir), [fileName], 'failed write cannot strand a lock or temporary file')
})

test('P2: sync PUT at MAX_SAFE_INTEGER must not HTTP-200 acknowledge an unsafe persisted revision', async t => {
  const { root, file, store } = await fixture(t, Number.MAX_SAFE_INTEGER)
  const before = await readFile(file)
  const url = await serverFor(t, root, store)
  const response = await fetch(url, {
    method: 'PUT',
    headers: {
      Authorization: 'Bearer ' + DEVICE,
      Origin: ORIGIN,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ baseRevision: Number.MAX_SAFE_INTEGER, entries: entries() }),
  })
  assert.notEqual(response.status, 200, 'unsafe revision must never be acknowledged as saved')
  assert.deepEqual(await readFile(file), before,
    'server must preserve the existing valid last-safe-revision record')
  const restored = await fetch(url, { headers: { Authorization: 'Bearer ' + DEVICE } })
  assert.equal(restored.status, 200)
  assert.equal((await restored.json()).revision, Number.MAX_SAFE_INTEGER)
})

test('positive: malformed persisted revision greater than MAX_SAFE_INTEGER is already refused', async t => {
  const { store } = await fixture(t, Number.MAX_SAFE_INTEGER + 1)
  await assert.rejects(store.read(DEVICE), /corrupt sync record/,
    'the existing stored-record type gate must reject unsafe restored revisions')
})
