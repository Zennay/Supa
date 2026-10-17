import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { once } from 'node:events'
import { readdir, readFile, stat, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { createRecipeServer } from '../server/app.mjs'
import { createFileSyncStore } from '../server/sync-store.mjs'

// INDEPENDENT QA on frozen product PR #3777. All device keys, shopping
// progress and planning values are fictional. HTTP is loopback-only.
const ORIGIN = 'https://supa-local-qa.invalid'
const PLAN = 'supa:planner-preferences:v2'
const M3_PRIVATE = 'supa:m3-observation-draft:v1'
const A = 'A'.repeat(43)
const B = 'B'.repeat(43)
const plan = (budget) => JSON.stringify({ budget, activeDays: ['Ma'], recipeByDay: {} })

async function setup(t) {
  const root = await mkdtemp(join(tmpdir(), 'supa-isolation-qa-'))
  const dir = join(root, 'sync')
  t.after(() => rm(root, { recursive: true, force: true }))
  async function start() {
    const server = createRecipeServer({
      root, origin: ORIGIN, syncStore: createFileSyncStore({ dir }),
    })
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    const base = 'http://127.0.0.1:' + server.address().port
    return {
      base,
      async stop() {
        server.closeAllConnections()
        await new Promise(resolve => server.close(resolve))
      },
    }
  }
  return { dir, start }
}

async function get(base, key) {
  const response = await fetch(base + '/api/sync', {
    headers: { Authorization: 'Bearer ' + key },
  })
  return { response, body: await response.json() }
}

async function put(base, key, revision, entries) {
  const response = await fetch(base + '/api/sync', {
    method: 'PUT',
    headers: {
      Authorization: 'Bearer ' + key,
      Origin: ORIGIN,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ baseRevision: revision, entries }),
  })
  return { response, body: await response.json() }
}

test('two independent anonymous device keys never reveal one another’s plan, revisions or secret', async t => {
  const { start } = await setup(t)
  const server = await start()
  try {
    const first = await put(server.base, A, 0, { [PLAN]: plan(35) })
    assert.equal(first.response.status, 200)
    assert.equal(first.body.revision, 1)

    const unknown = await get(server.base, B)
    assert.equal(unknown.response.status, 200)
    assert.deepEqual(unknown.body, { revision: 0, updatedAt: null, entries: {} })
    assert.equal(unknown.response.headers.get('cache-control'), 'no-store')

    const second = await put(server.base, B, 0, { [PLAN]: plan(48) })
    assert.equal(second.response.status, 200)
    assert.equal(second.body.revision, 1)

    const a = await get(server.base, A)
    const b = await get(server.base, B)
    assert.equal(a.body.revision, 1)
    assert.equal(b.body.revision, 1)
    assert.equal(a.body.entries[PLAN], plan(35))
    assert.equal(b.body.entries[PLAN], plan(48))
    for (const text of [JSON.stringify(a.body), JSON.stringify(b.body)]) {
      assert.ok(!text.includes(A), 'bearer token A is not echoed')
      assert.ok(!text.includes(B), 'bearer token B is not echoed')
      assert.ok(!text.includes(M3_PRIVATE), 'private M3 collector is absent from sync transport')
    }
  } finally { await server.stop() }
})

test('a rejected private M3 collector key cannot persist even beside valid plan content', async t => {
  const { start, dir } = await setup(t)
  const server = await start()
  const canary = 'FICTIONAL-PRIVATE-M3-DRAFT-CANARY'
  try {
    const rejected = await put(server.base, A, 0, {
      [PLAN]: plan(35),
      [M3_PRIVATE]: JSON.stringify({ participantKey: canary }),
    })
    assert.equal(rejected.response.status, 422, 'unknown sensitive key must fail the entire atomic write')
    const after = await get(server.base, A)
    assert.deepEqual(after.body, { revision: 0, updatedAt: null, entries: {} })
    const names = await readdir(dir).catch(error => {
      if (error.code === 'ENOENT') return []
      throw error
    })
    assert.deepEqual(names, [], 'rejected private draft leaves no device file')
    assert.ok(!JSON.stringify(rejected.body).includes(canary), 'refusal must not echo private draft')
  } finally { await server.stop() }
})

test('a restarted singleton retains only the hashed 0600 disk records, never bearer keys', async t => {
  const { start, dir } = await setup(t)
  let server = await start()
  try {
    const first = await put(server.base, A, 0, { [PLAN]: plan(35) })
    assert.equal(first.response.status, 200)
    assert.equal(first.body.revision, 1)
  } finally { await server.stop() }

  const files = (await readdir(dir)).sort()
  const expected = createHash('sha256').update(A).digest('hex') + '.json'
  assert.deepEqual(files, [expected])
  const filePath = join(dir, expected)
  const before = await readFile(filePath, 'utf8')
  assert.ok(!before.includes(A), 'disk must not store plaintext bearer credentials')
  assert.equal((await stat(dir)).mode & 0o077, 0, 'sync folder must not allow group/other access')
  assert.equal((await stat(filePath)).mode & 0o077, 0, 'stored record must be owner-only')

  server = await start()
  try {
    const restored = await get(server.base, A)
    assert.equal(restored.response.status, 200)
    assert.equal(restored.body.revision, 1)
    assert.equal(restored.body.entries[PLAN], plan(35))
    const another = await put(server.base, A, 1, { [PLAN]: plan(36) })
    assert.equal(another.response.status, 200)
    assert.equal(another.body.revision, 2)
    assert.deepEqual(await readdir(dir), [expected], 'overwrite must be atomic with no orphan temp files')
  } finally { await server.stop() }
})

test('other device keys cannot force a revision-conflict response or wipe the owner’s data', async t => {
  const { start } = await setup(t)
  const server = await start()
  try {
    assert.equal((await put(server.base, A, 0, { [PLAN]: plan(35) })).response.status, 200)
    assert.equal((await put(server.base, B, 19, { [PLAN]: plan(99) })).response.status, 409)
    assert.equal((await put(server.base, B, 0, {})).response.status, 200)
    const a = await get(server.base, A)
    assert.equal(a.body.entries[PLAN], plan(35))
    assert.equal(a.body.revision, 1)
  } finally { await server.stop() }
})
