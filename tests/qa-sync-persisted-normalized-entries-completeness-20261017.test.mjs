import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { once } from 'node:events'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { createFileSyncStore } from '../server/sync-store.mjs'
import { createRecipeServer } from '../server/app.mjs'

// Independent add-only QA on current owner DRAFT #3777 (9fc153).
// Persisted revisions >= 1 must reflect canonical complete writes, not a
// partial JSON object ambiguously interpreted as intentional null deletion.
// No real device, browser profile, retailer, VPS or human field evidence.
const DEVICE = 'C'.repeat(43)
const ORIGIN = 'https://synthetic-internal-only.example.test'
const PLAN = 'supa:planner-preferences:v2'
const RECIPE = 'supa.recipe-library.v1'
const SHOP = 'supa:shopping-list-progress:v1'
const goodPlan = JSON.stringify({ budget: 35, activeDays: ['Ma'], recipeByDay: {} })
const good = () => ({ [PLAN]: goodPlan, [RECIPE]: null, [SHOP]: null })

async function fixture(t, entries) {
  const root = await mkdtemp(join(tmpdir(), 'supa-qa-sync-incomplete-restore-'))
  const dir = join(root, 'sync')
  t.after(() => rm(root, { recursive: true, force: true }))
  await mkdir(dir, { mode: 0o700 })
  const file = join(dir, createHash('sha256').update(DEVICE).digest('hex') + '.json')
  await writeFile(file, JSON.stringify({
    revision: 1, updatedAt: '2026-10-17T00:00:00.000Z', entries,
  }), { mode: 0o600 })
  return { root, store: createFileSyncStore({ dir }) }
}

test('positive: three canonical sync keys are preserved, including deliberate null deletes', async t => {
  const entries = good()
  const { store } = await fixture(t, entries)
  assert.deepEqual((await store.read(DEVICE)).entries, entries)
})

test('P2: a nonempty revision with zero persisted keys must be refused, not mistaken for three deletes', async t => {
  const { store } = await fixture(t, {})
  await assert.rejects(() => store.read(DEVICE),
    'a real post-write revision can never omit all normalized keys')
})

test('P2: a post-write revision missing exactly one canonical key must fail closed', async t => {
  const incomplete = { [PLAN]: goodPlan, [RECIPE]: null }
  const { store } = await fixture(t, incomplete)
  await assert.rejects(() => store.read(DEVICE),
    'a missing shopping key is not equivalent to an explicit null from a user')
})

test('P2: sync GET must not expose an incomplete persisted revision as valid server state', async t => {
  const { root, store } = await fixture(t, { [PLAN]: goodPlan })
  const server = createRecipeServer({ root, syncStore: store, origin: ORIGIN })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  t.after(async () => {
    server.closeAllConnections()
    await new Promise(resolve => server.close(resolve))
  })
  const response = await fetch('http://127.0.0.1:' + server.address().port + '/api/sync', {
    headers: { Authorization: 'Bearer ' + DEVICE },
  })
  assert.equal(response.status, 500,
    'an incomplete stored record with a plausible revision must not be returned as successful sync')
  assert.deepEqual(await response.json(), { error: 'Je gegevens konden niet worden bewaard.' })
})
