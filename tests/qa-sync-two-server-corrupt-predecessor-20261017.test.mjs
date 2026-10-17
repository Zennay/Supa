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

// Independent QA1/2. Real HTTP traffic to TWO separate loopback server
// instances using a shared private 0700 disk directory. Both servers have
// their own store and in-process queues: only the shared filesystem lock
// prevents false CAS acknowledgements. All keys, data and URLs are synthetic.
const KEY = 'V'.repeat(43)
const ORIGIN = 'http://qa-two-local-supa.invalid'
const PLAN = 'supa:planner-preferences:v2'
const LIB = 'supa.recipe-library.v1'
const SHOP = 'supa:shopping-list-progress:v1'
const plan = budget => JSON.stringify({ budget, activeDays: ['Ma'], recipeByDay: {} })
const valid = { [PLAN]: plan(35), [LIB]: null, [SHOP]: null }
const newer = { [PLAN]: plan(47), [LIB]: null, [SHOP]: null }
const stamp = '2026-10-17T00:00:00.000Z'

async function fixture(t, entries) {
  assert.equal(validateSyncEntries(newer, { complete: true }).error, undefined)
  const root = await mkdtemp(join(tmpdir(), 'supa-qa-two-server-semantic-'))
  const dir = join(root, 'sync')
  await mkdir(dir, { mode: 0o700 })
  const file = join(dir, createHash('sha256').update(KEY).digest('hex') + '.json')
  const original = JSON.stringify({ revision: 1, updatedAt: stamp, entries })
  await writeFile(file, original, { mode: 0o600 })
  t.after(() => rm(root, { recursive: true, force: true }))
  return { root, dir, file, original }
}

async function start(t, root, dir) {
  const server = createRecipeServer({
    root,
    origin: ORIGIN,
    syncStore: createFileSyncStore({ dir }),
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  t.after(async () => {
    server.closeAllConnections()
    await new Promise(resolve => server.close(resolve))
  })
  return 'http://127.0.0.1:' + server.address().port + '/api/sync'
}

function update(url) {
  return fetch(url, {
    method: 'PUT',
    headers: {
      Authorization: 'Bearer ' + KEY,
      Origin: ORIGIN,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ baseRevision: 1, entries: newer }),
  })
}

test('positive: two independent servers serialize valid same-revision CAS as exactly one 200 and one 409', async t => {
  const { root, dir, file } = await fixture(t, valid)
  assert.equal(validateSyncEntries(valid, { complete: true }).error, undefined)
  const a = await start(t, root, dir)
  const b = await start(t, root, dir)
  const responses = await Promise.all([update(a), update(b)])
  assert.deepEqual(responses.map(r => r.status).sort(), [200, 409])
  const bodies = await Promise.all(responses.map(r => r.json()))
  const winner = bodies.find((_, i) => responses[i].status === 200)
  const loser = bodies.find((_, i) => responses[i].status === 409)
  assert.equal(winner.revision, 2)
  assert.equal(loser.revision, 2)
  assert.deepEqual(loser.entries, newer)
  const saved = JSON.parse(await readFile(file, 'utf8'))
  assert.equal(saved.revision, 2)
  assert.deepEqual(saved.entries, newer)
})

for (const [label, entries] of [
  ['unsupported recipe library version', { ...valid, [LIB]: '{"version":999,"recipes":[]}' }],
  ['missing persisted shopping field', { [PLAN]: plan(35), [LIB]: null }],
  ['duplicate checked line identifiers', {
    ...valid,
    [SHOP]: JSON.stringify({ schemaVersion: 1, basketKey: 'synthetic', doneLineIds: ['x', 'x'] }),
  }],
]) {
  test('P2 #3809: two independent HTTP writers both reject ' + label + ' without corrupting original disk', async t => {
    assert.ok(validateSyncEntries(entries, { complete: true }).error,
      'the persisted poison must genuinely violate canonical complete validation')
    const { root, dir, file, original } = await fixture(t, entries)
    const a = await start(t, root, dir)
    const b = await start(t, root, dir)
    const responses = await Promise.all([update(a), update(b)])
    assert.deepEqual(responses.map(r => r.status), [500, 500],
      'neither server may acknowledge a new or conflicting state over invalid disk history')
    for (const response of responses) {
      assert.deepEqual(await response.json(), { error: 'Je gegevens konden niet worden bewaard.' },
        'a refused sync must never expose the poison through HTTP')
    }
    assert.equal(await readFile(file, 'utf8'), original,
      'recovery requires the original invalid state to remain byte-for-byte intact')
  })
}
