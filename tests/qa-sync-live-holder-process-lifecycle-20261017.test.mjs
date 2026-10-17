import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { once } from 'node:events'
import { mkdtemp, readdir, rm, stat, utimes } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { createFileSyncStore } from '../server/sync-store.mjs'

// QA control with a genuine event-loop-live OS child holding an open inode.
// All keys, directories and values are synthetic; no VPS/customer input.
const KEY = 'H'.repeat(43)
const NAME = createHash('sha256').update(KEY).digest('hex')
const ENTRIES = { 'supa:planner-preferences:v2': '{"fixture":"synthetic-not-real-observation"}' }

const holderScript = `
import { open, mkdir } from 'node:fs/promises'
const [dir, lock] = process.argv.slice(1)
await mkdir(dir, { recursive: true, mode: 0o700 })
const handle = await open(lock, 'wx', 0o600)
globalThis.heldHandle = handle
setInterval(() => {}, 1000)
process.stdout.write('HELD\\n')
`

async function sandbox(t) {
  const root = await mkdtemp(join(tmpdir(), 'supa-qa-live-holder-lifecycle-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  return join(root, 'sync')
}

async function launchHolder(dir, lock) {
  const child = spawn(process.execPath, ['--input-type=module', '-e', holderScript, dir, lock], {
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  // Keep the exit listener attached from process creation. Do not await a
  // second 'exit' event after the child has already left the event loop.
  let observedExit = false
  child.once('exit', () => { observedExit = true })
  let stdout = ''
  let stderr = ''
  child.stderr.setEncoding('utf8')
  child.stderr.on('data', chunk => { stderr += chunk })
  const ready = new Promise((resolve, reject) => {
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', chunk => {
      stdout += chunk
      if (stdout.includes('HELD\n')) resolve()
    })
    child.once('error', reject)
    child.once('exit', (code, signal) => reject(new Error(`holder exited before ready: ${code}/${signal}; ${stderr.slice(0, 200)}`)))
  })
  const startupTimeout = setTimeout(() => child.kill('SIGKILL'), 5000)
  try { await ready } finally { clearTimeout(startupTimeout) }
  assert.equal(observedExit, false)
  assert.equal(child.exitCode, null)
  assert.equal(child.signalCode, null)
  return child
}

async function stopHolder(child) {
  if (child.exitCode !== null || child.signalCode !== null) return
  const exitEvent = once(child, 'exit')
  child.kill('SIGKILL')
  await exitEvent
}

test('positive: an uncontended private sync store creates one revision', async t => {
  const dir = await sandbox(t)
  const store = createFileSyncStore({ dir })
  assert.equal((await store.write(KEY, 0, ENTRIES)).conflict, false)
  assert.equal((await store.read(KEY)).revision, 1)
  assert.deepEqual(await readdir(dir), [NAME + '.json'])
})

test('P1: living OS lock holder survives mtime aging; writer refuses, then recovers only after the holder dies', async t => {
  const dir = await sandbox(t)
  const lock = join(dir, NAME + '.lock')
  let child
  try {
    child = await launchHolder(dir, lock)
    const original = await stat(lock)
    assert.equal(original.isFile(), true)
    const old = new Date(Date.now() - 60_000)
    await utimes(lock, old, old)
    assert.ok(Date.now() - (await stat(lock)).mtimeMs >= 45_000)

    const store = createFileSyncStore({ dir })
    await assert.rejects(store.write(KEY, 0, ENTRIES), /busy|lock/i)
    assert.equal(child.exitCode, null, 'the owner must actually stay alive throughout exclusion')
    assert.equal(child.signalCode, null)
    const currentLock = await stat(lock)
    assert.equal(currentLock.ino, original.ino, 'the live owner lock must not be replaced')
    assert.equal((await store.read(KEY)).revision, 0, 'no write may be acknowledged while owner is live')

    await stopHolder(child)
    const recovered = await store.write(KEY, 0, ENTRIES)
    assert.equal(recovered.conflict, false)
    assert.equal(recovered.record.revision, 1)
    assert.deepEqual((await store.read(KEY)).entries, ENTRIES)
    assert.deepEqual(await readdir(dir), [NAME + '.json'], 'crash recovery leaves no orphan lock or temp file')
  } finally {
    if (child) await stopHolder(child)
  }
})
