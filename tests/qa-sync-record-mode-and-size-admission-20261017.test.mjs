import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { createFileSyncStore } from '../server/sync-store.mjs'
import { MAX_SNAPSHOT_BYTES } from '../server/sync-validation.mjs'

// Independent add-only QA on product owner's frozen DRAFT #3777 at c26018c.
// Each fixture lives in a disposable 0700 local directory. No real device,
// retailer, network, account, or VPS data is accessed.
const key = 'R'.repeat(43)
const hashedName = createHash('sha256').update(key).digest('hex') + '.json'
const plannerKey = 'supa:planner-preferences:v2'
const entries = { [plannerKey]: '{"fixture":"local-synthetic-only"}' }

async function fixture(t, options = {}) {
  const root = await mkdtemp(join(tmpdir(), 'supa-qa-sync-record-admission-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const dir = join(root, 'sync')
  await mkdir(dir, { mode: 0o700 })
  const file = join(dir, hashedName)
  const payload = JSON.stringify({
    revision: 1,
    updatedAt: '2026-10-17T00:00:00.000Z',
    entries: options.entries ?? entries,
  })
  await writeFile(file, payload, { mode: 0o600 })
  if (options.mode !== undefined) await chmod(file, options.mode)
  return { store: createFileSyncStore({ dir }), file, payload }
}

test('positive: private 0600 single-link bounded record remains readable', async t => {
  const { store } = await fixture(t)
  const saved = await store.read(key)
  assert.equal(saved.revision, 1)
  assert.deepEqual(saved.entries, entries)
})

for (const [mode, label] of [[0o640, 'group-readable'], [0o644, 'world-readable']]) {
  test(`P2: existing ${label} sync record must not be admitted as private state`, async t => {
    const { store } = await fixture(t, { mode })
    await assert.rejects(() => store.read(key),
      'a record accessible to other local identities must not be trusted as a private device snapshot')
  })
}

test('P2: oversized on-disk record must fail closed before trusting its JSON content', async t => {
  // This syntactically valid snapshot is intentionally over the server-side
  // maximum even though its backing file is private and single-linked.
  const oversized = { [plannerKey]: 'x'.repeat(MAX_SNAPSHOT_BYTES + 4096) }
  const { store, payload } = await fixture(t, { entries: oversized })
  assert.ok(Buffer.byteLength(payload, 'utf8') > MAX_SNAPSHOT_BYTES)
  await assert.rejects(() => store.read(key),
    'untrusted disk restores must use a bounded read, not an unbounded readFile')
})
