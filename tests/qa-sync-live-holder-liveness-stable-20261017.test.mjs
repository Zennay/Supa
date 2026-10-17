import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { constants } from 'node:fs'
import { mkdir, mkdtemp, open, readdir, rm, stat, utimes } from 'node:fs/promises'
import { hostname, tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { createFileSyncStore } from '../server/sync-store.mjs'

// QA1-only stable replay of old P1 #3799. Historical immutable fail-first
// file is preserved in PR #3798; this file has explicit process readiness,
// a kept-alive child, and an exit promise registered BEFORE signaling.
// No real customer records, VPS, retailer calls or third-party resources.
const KEY = 'L'.repeat(43)
const PLAN = 'supa:planner-preferences:v2'
const PAYLOAD = { [PLAN]: '{"private":"synthetic-only"}' }
const HASH = createHash('sha256').update(KEY).digest('hex')

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'supa-qa-live-lock-stable-'))
  const dir = join(root, 'sync')
  await mkdir(dir, { mode: 0o700 })
  t.after(() => rm(root, { recursive: true, force: true }))
  return { dir, lock: join(dir, HASH + '.lock') }
}

async function age(lock) {
  const old = new Date(Date.now() - 60_000)
  await utimes(lock, old, old)
  assert.ok(Date.now() - (await stat(lock)).mtimeMs > 30_000)
}

async function assertActiveLockRefused(dir, lock) {
  const store = createFileSyncStore({ dir })
  await assert.rejects(store.write(KEY, 0, PAYLOAD), /sync record is busy/,
    'a living holder must never be evicted due to old mtime alone')
  assert.equal((await store.read(KEY)).revision, 0)
  assert.deepEqual(await readdir(dir), [HASH + '.lock'],
    'the still-held file must remain the only lock')
}

test('positive: uncontended store creates a private record and preserves its revision', async t => {
  const { dir } = await fixture(t)
  const store = createFileSyncStore({ dir })
  const saved = await store.write(KEY, 0, PAYLOAD)
  assert.equal(saved.conflict, false)
  assert.equal(saved.record.revision, 1)
  assert.deepEqual((await store.read(KEY)).entries, PAYLOAD)
  assert.deepEqual(await readdir(dir), [HASH + '.json'])
})

test('P1 #3799: aged lock with an open descriptor in this process cannot be stolen', async t => {
  const { dir, lock } = await fixture(t)
  const held = await open(lock, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600)
  try {
    await held.writeFile(JSON.stringify({ pid: process.pid, host: hostname(), token: 'fixture-only' }))
    await age(lock)
    await assertActiveLockRefused(dir, lock)
  } finally { await held.close() }
})

const holderProgram = [
  "import { open } from 'node:fs/promises'",
  "import { hostname } from 'node:os'",
  "const fd = await open(process.argv[1], 'wx', 0o600)",
  "await fd.writeFile(JSON.stringify({pid:process.pid,host:hostname(),token:'synthetic-holder'}))",
  "process.stdout.write('LOCK_HELD\\n')",
  "setInterval(() => {}, 1000)",
].join('\n')

async function startPhysicalHolder(lock) {
  const child = spawn(process.execPath,
    ['--input-type=module', '-e', holderProgram, lock],
    { stdio: ['ignore', 'pipe', 'pipe'] })
  let resolveExit
  const exited = new Promise(resolve => { resolveExit = resolve })
  let errorMessage = ''
  child.once('exit', (code, signal) => resolveExit({ code, signal }))
  child.once('error', error => resolveExit({ error }))
  child.stderr.setEncoding('utf8')
  child.stderr.on('data', chunk => { errorMessage += chunk })
  child.stdout.setEncoding('utf8')
  let readyResolve, readyReject
  const ready = new Promise((resolve, reject) => { readyResolve = resolve; readyReject = reject })
  let message = ''
  child.stdout.on('data', chunk => {
    message += chunk
    if (message.includes('LOCK_HELD\n')) readyResolve()
  })
  const timeout = setTimeout(() => readyReject(new Error('fixture holder readiness timeout: ' + errorMessage)), 5000)
  try {
    await Promise.race([ready, exited.then(info => { throw new Error('holder exited before ready: ' + JSON.stringify(info) + ' ' + errorMessage) })])
  } catch (error) {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
    await exited
    throw error
  } finally { clearTimeout(timeout) }
  return {
    child,
    exited,
    async stop() {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
      await exited // registered before kill; never miss exit event
    },
  }
}

test('P1 #3799: a separate living physical holder survives artificial stale mtime', async t => {
  const { dir, lock } = await fixture(t)
  const holder = await startPhysicalHolder(lock)
  try {
    assert.equal(holder.child.exitCode, null)
    await age(lock)
    assert.equal(holder.child.exitCode, null)
    await assertActiveLockRefused(dir, lock)
    assert.equal(holder.child.exitCode, null)
  } finally { await holder.stop() }
})
