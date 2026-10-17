import assert from 'node:assert/strict'
import test from 'node:test'
import { once } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRecipeServer } from '../server/app.mjs'
import { createFileSyncStore } from '../server/sync-store.mjs'

// A separate HTTP-level positive/negative contract on the same frozen owner
// branch as QA PR #3788. All request data is synthetic and loopback-only.
const ORIGIN = 'https://supa-sync-qa.invalid'
const KEY = 'W'.repeat(43)
const PLANNER = 'supa:planner-preferences:v2'

function options(label) {
  return {
    baseRevision: 0,
    entries: { [PLANNER]: JSON.stringify({
      budget: 35, activeDays: ['Ma'], recipeByDay: { Ma: label },
    }) },
  }
}

async function makeServers(t) {
  const root = await mkdtemp(join(tmpdir(), 'supa-sync-two-http-instances-'))
  const syncDir = join(root, 'sync')
  const a = createRecipeServer({ root, origin: ORIGIN, syncStore: createFileSyncStore({ dir: syncDir }) })
  const b = createRecipeServer({ root, origin: ORIGIN, syncStore: createFileSyncStore({ dir: syncDir }) })
  await Promise.all([new Promise(resolve => a.listen(0,'127.0.0.1',resolve)), new Promise(resolve => b.listen(0,'127.0.0.1',resolve))])
  t.after(async () => {
    for (const server of [a,b]) {
      server.closeAllConnections()
      await new Promise(resolve => server.close(resolve))
    }
    await rm(root, { recursive:true, force:true })
  })
  return [a,b].map(s => 'http://127.0.0.1:'+s.address().port)
}

async function put(host, body) {
  const response = await fetch(host+'/api/sync', {
    method: 'PUT',
    headers: { Origin: ORIGIN, Authorization: 'Bearer '+KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return { status: response.status, data: await response.json() }
}

test('P1 sync API: two independently mounted servers must return 200/409 for competing revision 0 requests', async t => {
  const [first, second] = await makeServers(t)
  // Pin the clock only in this isolated Node test process to deterministically
  // exercise tempfile name collision if both instances race in one millisecond.
  const realNow = Date.now
  const frozenMs = realNow()
  let outcomes
  try {
    Date.now = () => frozenMs
    outcomes = await Promise.all([
      put(first, options('supa-thai')),
      put(second, options('supa-bolognese')),
    ])
  } finally {
    Date.now = realNow
  }

  assert.deepEqual(outcomes.map(x=>x.status).sort((a,b)=>a-b), [200,409],
    'the API must report a retryable 409 for stale writes, not 500 or two conflicting successes')
  const winner = outcomes.find(x=>x.status===200)
  assert.equal(winner.data.revision, 1)
  const saved = await fetch(first+'/api/sync',{headers:{Authorization:'Bearer '+KEY}})
  assert.equal(saved.status,200)
  const record = await saved.json()
  assert.equal(record.revision,1)
})
