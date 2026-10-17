import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { spawn, spawnSync } from 'node:child_process'
import { chmod, mkdir, mkdtemp, rm, unlink, writeFile } from 'node:fs/promises'
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
const entries = { [plannerKey]: JSON.stringify({ budget: 35, activeDays: ['Ma'], recipeByDay: { Ma: 'supa-thai' } }) }

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

test('P2: a pre-existing FIFO record must fail closed without hanging a sync read', { skip: process.platform !== 'linux' }, async t => {
  const { file } = await fixture(t)
  await unlink(file)
  const created = spawnSync('mkfifo', [file], { encoding: 'utf8', timeout: 5000 })
  assert.equal(created.status, 0, 'test runner must prepare a disposable named pipe')

  // Isolate a potentially blocking open() in a child, so this regression
  // never hangs the main suite. Correct code should open O_NONBLOCK, inspect
  // the pinned descriptor with fstat and reject the non-regular record.
  const moduleUrl = new URL('../server/sync-store.mjs', import.meta.url).href
  const script = `
    import { createFileSyncStore } from ${JSON.stringify(moduleUrl)}
    const [dir, key] = process.argv.slice(1)
    try {
      await createFileSyncStore({ dir }).read(key)
      process.exitCode = 2
    } catch {
      process.stdout.write('REFUSED\\n')
    }
  `
  const child = spawn(process.execPath, ['--input-type=module', '-e', script, file.slice(0, -hashedName.length), key], {
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  t.after(() => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL') })
  let output = ''
  child.stdout.on('data', chunk => { output += chunk.toString() })
  const result = await new Promise(resolve => {
    const timeout = setTimeout(() => { child.kill('SIGKILL'); resolve({ timedOut: true }) }, 1500)
    child.once('exit', (code, signal) => { clearTimeout(timeout); resolve({ code, signal }) })
    child.once('error', error => { clearTimeout(timeout); resolve({ error: error.message }) })
  })
  assert.deepEqual(result, { code: 0, signal: null },
    'a FIFO record may never block indefinitely waiting for an external writer')
  assert.match(output, /REFUSED/, 'special file must be explicitly refused')
})
