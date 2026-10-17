import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { once } from 'node:events'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { createRecipeServer } from '../server/app.mjs'
import { createFileSyncStore } from '../server/sync-store.mjs'

// QA-only synthetic localhost HTTP proof, based on owner DRAFT #3777.
// A fictional local tampered 0600 record is not production incident evidence.
// Never use real participant or retailer data.
const KEY = 'T'.repeat(43)
const ORIGIN = 'https://supa.example.test'
const PLANNER = 'supa:planner-preferences:v2'
const PRIVATE_M3 = 'supa:m3-observation-draft:v1'
const SECRET_MARKER = 'PRIVATE_M3_LOCAL_ONLY_FAKE_MARKER_20261017'
const ENTRIES = {
  [PLANNER]: JSON.stringify({ budget: 35, activeDays: ['Ma'], recipeByDay: { Ma: 'supa-thai' } }),
  'supa.recipe-library.v1': null,
  'supa:shopping-list-progress:v1': null,
}

async function setup(t, entries = ENTRIES) {
  const root = await mkdtemp(join(tmpdir(), 'supa-qa-sync-http-disk-boundary-'))
  const dir = join(root, 'sync')
  await mkdir(dir, { mode: 0o700 })
  const hashed = createHash('sha256').update(KEY).digest('hex') + '.json'
  await writeFile(join(dir, hashed), JSON.stringify({
    revision: 1,
    updatedAt: '2026-10-17T00:00:00.000Z',
    entries,
  }), { mode: 0o600 })
  const server = createRecipeServer({
    root: join(root, 'fake-static-root'),
    origin: ORIGIN,
    syncStore: createFileSyncStore({ dir }),
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const base = `http://127.0.0.1:${server.address().port}`
  t.after(async () => {
    server.closeAllConnections()
    await new Promise(resolve => server.close(resolve))
    await rm(root, { recursive: true, force: true })
  })
  const headers = { Authorization: `Bearer ${KEY}` }
  return { base, headers }
}

test('positive: existing private valid on-disk sync snapshot GET is exactly allowed keys', async t => {
  const { base, headers } = await setup(t)
  const response = await fetch(`${base}/api/sync`, { headers })
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('cache-control'), 'no-store')
  const body = await response.json()
  assert.equal(body.revision, 1)
  assert.deepEqual(body.entries, ENTRIES)
})

test('P2: GET never echoes a private M3 observation injected into a syntactically valid disk snapshot', async t => {
  const injected = { ...ENTRIES, [PRIVATE_M3]: SECRET_MARKER }
  const { base, headers } = await setup(t, injected)
  const response = await fetch(`${base}/api/sync`, { headers })
  assert.equal(response.status, 500, 'untrusted persisted data must fail closed before being returned')
  const body = await response.text()
  assert.ok(!body.includes(SECRET_MARKER), 'private local observation content must never leave the server')
  assert.ok(!body.includes(PRIVATE_M3), 'private observation storage key must never leave the server')
  assert.deepEqual(JSON.parse(body), { error: 'Je gegevens konden niet worden bewaard.' })
})

test('P2: PUT revision conflict must not echo injected M3 evidence from old disk state', async t => {
  const injected = { ...ENTRIES, [PRIVATE_M3]: SECRET_MARKER }
  const { base, headers } = await setup(t, injected)
  const response = await fetch(`${base}/api/sync`, {
    method: 'PUT',
    headers: { ...headers, Origin: ORIGIN, 'Content-Type': 'application/json' },
    body: JSON.stringify({ baseRevision: 0, entries: ENTRIES }),
  })
  assert.equal(response.status, 500, '409 conflict body must not expose unvalidated disk state')
  const body = await response.text()
  assert.ok(!body.includes(SECRET_MARKER), '409 payload must not expose private draft contents')
  assert.ok(!body.includes(PRIVATE_M3), '409 payload must not expose private draft key')
  assert.deepEqual(JSON.parse(body), { error: 'Je gegevens konden niet worden bewaard.' })
})
